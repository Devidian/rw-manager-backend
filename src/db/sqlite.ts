import Database from 'better-sqlite3';
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppConfig } from '../utils/app-config.js';
import { ServerConfig } from '../utils/server-config.js';
import type { DbPlayer } from '../interfaces/game-player.js';
import { defaultLogger } from '../utils/logger.js';
import {
  bufferToPosition,
} from '../utils/spawn-packet-decoder.js';

class RWSQLite {
  private playerDb: Database.Database | undefined = undefined;

  get rootPath(): string {
    return AppConfig.rootPath;
  }

  get worldName(): string {
    return ServerConfig.getWorldName(this.rootPath);
  }

  constructor() {}

  initialize() {
    const worldsPath = resolve(`${this.rootPath}/Worlds`);
    const worlds = readdirSync(worldsPath);
    const currentWorld = this.worldName;
    if (!worlds.includes(currentWorld)) {
      throw new Error(`World ${currentWorld} does not exist`);
    }
    const playerDbPath = resolve(
      `${this.rootPath}/Worlds/${currentWorld}/Player.db`,
    );
    this.playerDb = new Database(playerDbPath);
  }

  initializeIfAvailable(): boolean {
    try {
      const configPath = resolve(`${this.rootPath}/server.properties`);
      const worldsPath = resolve(`${this.rootPath}/Worlds`);
      if (!existsSync(configPath) || !existsSync(worldsPath)) return false;

      const currentWorld = this.worldName;
      const playerDbPath = resolve(
        `${this.rootPath}/Worlds/${currentWorld}/Player.db`,
      );
      if (!existsSync(playerDbPath)) return false;
      this.playerDb = new Database(playerDbPath, { readonly: true });
      return true;
    } catch (error) {
      defaultLogger.warn('Rising World player database unavailable:', error);
      return false;
    }
  }

  getPlayers() {
    if (!this.playerDb) {
      throw new Error('Player database not initialized');
    }
    const stmt = this.playerDb.prepare('SELECT * FROM player');
    return (stmt.all() as Array<DbPlayer & {
      clothes?: Buffer;
      primaryspawn?: Buffer;
      secondaryspawn?: Buffer;
      tertiaryspawn?: Buffer;
    }>).map((row) => ({
      ...row,
      platform: { 1: 'Standalone', 2: 'Steam' }[Number(row.platform)] ?? row.platform,
      clothes: row.clothes?.toString('hex'),
      primaryspawn: bufferToPosition(row.primaryspawn),
      secondaryspawn: bufferToPosition(row.secondaryspawn),
      tertiaryspawn: bufferToPosition(row.tertiaryspawn),
    }));
  }
}

export const db = new RWSQLite();
