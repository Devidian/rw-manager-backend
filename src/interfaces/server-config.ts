import type { DbPlayer } from './game-player.js';

export interface ServerConfig {
  id: string;
  label: string;
  steamId?: string;
  addr?: string;
  version?: string;
  name?: string;
  ip?: string;
  port?: number;
  region?: string;
  gm?: number;
  mods?: boolean;
  password?: boolean;
  whitelist?: boolean;
  adminUid?: string;
  queryUrl: string
  mapUrl?: string;
  backendUrl?: string; // Deprecated game-backend URL retained for stored legacy records.
  data?: unknown;
  info?: unknown;
  status?: 'online' | 'offline' | 'unknown';
  onlinePlayers?: unknown[];
  knownPlayers?: DbPlayer[];
  blocked?: boolean;
  blockedAt?: Date | string | null;
  lastChecked?: Date | string;
  errorMessage?: string;
  firstSeen?: Date | string;
  lastSeen?: Date | string;
  queryDataUpdatedAt?: Date | string;
  connectorCredential?: string;
  public: boolean;
  createdAt: Date;
  userId?: string; // for backend-server with login, every user should have own server-list
}
