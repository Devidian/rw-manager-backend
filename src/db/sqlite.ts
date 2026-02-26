import Database from 'better-sqlite3';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppConfig } from '../utils/app-config.js';
import { ServerConfig } from '../utils/server-config.js';
import {
  bufferToPosition,
  parseSpawnPacket,
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

  getPlayers() {
    if (!this.playerDb) {
      throw new Error('Player database not initialized');
    }
    const stmt = this.playerDb.prepare('SELECT * FROM player');
    return stmt.all().map((row: any) => ({
      ...row,
      platform:
        { 1: 'Standalone', 2: 'Steam' }[row.platform as number] ?? row.platform,
      clothes: row.clothes?.toString('hex'),
      primaryspawn: bufferToPosition(row.primaryspawn),
      secondaryspawn: bufferToPosition(row.secondaryspawn),
      tertiaryspawn: bufferToPosition(row.tertiaryspawn),
    }));
  }
}

export const db = new RWSQLite();
