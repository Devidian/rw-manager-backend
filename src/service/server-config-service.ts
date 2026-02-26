import { db } from '../db/sqlite.js';
import { ServerConfig } from '../utils/server-config.js';
import type { WorldServerConfig } from '../interfaces/world-server-config.js';

export function getServerConfig(): WorldServerConfig {
  return ServerConfig.getProperties(db.rootPath);
}

export function getServerAdminList(): string[] {
  return (
    ServerConfig.getProperties(db.rootPath).Server_Admins?.toString().split(';') ??
    []
  );
}

export function getServerName(): string {
  return ServerConfig.getProperties(db.rootPath).Server_Name?.toString() ?? '';
}
