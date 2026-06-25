import type { Format } from 'typia/lib/tags/Format.js';

export interface ServerDto {
  id: string;
  label: string;
  steamId?: string | undefined;
  addr?: string | undefined;
  version?: string | undefined;
  name?: string | undefined;
  ip?: string | undefined;
  port?: number | undefined;
  region?: string | undefined;
  gm?: number | undefined;
  mods?: boolean | undefined;
  password?: boolean | undefined;
  whitelist?: boolean | undefined;
  adminUid?: string | undefined;
  queryUrl: string & Format<'url'>;
  mapUrl?: (string & Format<'url'>) | undefined;
  backendUrl?: (string & Format<'url'>) | undefined;
  data?: unknown;
  info?: unknown;
  status?: 'online' | 'offline' | undefined;
  queryData?: unknown;
  infoData?: unknown;
  onlinePlayers?: unknown[] | undefined;
  lastChecked?: (string & Format<'date-time'>) | undefined;
  errorMessage?: string | undefined;
  firstSeen?: (string & Format<'date-time'>) | undefined;
  lastSeen?: (string & Format<'date-time'>) | undefined;
  queryDataUpdatedAt?: (string & Format<'date-time'>) | undefined;
  public: boolean;
  createdAt: string & Format<'date-time'>;
  userId?: string | undefined;
}
