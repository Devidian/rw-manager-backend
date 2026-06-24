import { db } from '../db/json.js';
import type { MasterServerListEntry, MasterServerListResponse } from '../interfaces/master-server-list.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';

const STEAM_ID_PATTERN = /^\d{17}$/;
const MAP_URL_PATTERN = /@mapUrl:\[([^\]]+)]/i;

export interface MasterServerListSyncResult {
  fetched: number;
  inserted: number;
  updated: number;
  refreshed: number;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function steamIdOrUndefined(value: unknown): string | undefined {
  const serialized =
    typeof value === 'number' && Number.isFinite(value)
      ? String(value)
      : stringOrUndefined(value);
  return serialized && STEAM_ID_PATTERN.test(serialized) ? serialized : undefined;
}

function mapUrlFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const description = stringOrUndefined((info as { description?: unknown }).description);
  const match = description?.match(MAP_URL_PATTERN);
  if (!match) return undefined;
  try {
    return new URL(match[1]).toString();
  } catch {
    return undefined;
  }
}

function adminUidFromInfo(info: unknown): string | undefined {
  if (!info || typeof info !== 'object') return undefined;
  return steamIdOrUndefined((info as { contact?: unknown }).contact);
}

function queryUrlFor(entry: MasterServerListEntry): string | undefined {
  const ip = stringOrUndefined(entry.ip);
  const port = numberOrUndefined(entry.port);
  if (!ip || port === undefined || port <= 1) return undefined;
  return `http://${ip}:${port - 1}`;
}

function shouldRefreshQueryData(server: ServerConfig, now: Date): boolean {
  if (!server.queryDataUpdatedAt) return true;
  const previous = new Date(server.queryDataUpdatedAt).getTime();
  if (Number.isNaN(previous)) return true;
  return now.getTime() - previous >= AppConfig.serverQueryRefreshIntervalMs;
}

async function fetchJson(url: string): Promise<unknown | undefined> {
  try {
    const response = await fetch(url);
    if (!response.ok) return undefined;
    return await response.json();
  } catch {
    return undefined;
  }
}

async function fetchMasterServerList(): Promise<MasterServerListResponse | undefined> {
  try {
    const response = await fetch(AppConfig.masterServerListUrl);
    if (!response.ok) return undefined;
    const text = await response.text();
    return JSON.parse(
      text.replace(/("steamid"\s*:\s*)(\d{15,20})/g, '$1"$2"'),
    ) as MasterServerListResponse;
  } catch {
    return undefined;
  }
}

async function refreshQueryData(server: ServerConfig, now: Date): Promise<boolean> {
  if (!server.queryUrl || !shouldRefreshQueryData(server, now)) return false;

  const [data, info] = await Promise.all([
    fetchJson(server.queryUrl),
    fetchJson(new URL('info', `${server.queryUrl.replace(/\/+$/, '')}/`).toString()),
  ]);

  if (data !== undefined) server.data = data;
  if (info !== undefined) {
    server.info = info;
    server.adminUid = adminUidFromInfo(info) ?? server.adminUid;
    server.mapUrl = mapUrlFromInfo(info) ?? server.mapUrl;
    server.backendUrl = server.mapUrl ?? server.backendUrl;
  }
  server.queryDataUpdatedAt = now;
  return data !== undefined || info !== undefined;
}

function applyMasterEntry(server: ServerConfig, entry: MasterServerListEntry, now: Date): void {
  const steamId = steamIdOrUndefined(entry.steamid);
  const queryUrl = queryUrlFor(entry);
  const name = stringOrUndefined(entry.name);

  if (steamId) server.steamId = steamId;
  server.addr = stringOrUndefined(entry.addr) ?? server.addr;
  server.version = stringOrUndefined(entry.version) ?? server.version;
  server.name = name ?? server.name;
  server.label = name ?? server.label;
  server.ip = stringOrUndefined(entry.ip) ?? server.ip;
  server.port = numberOrUndefined(entry.port) ?? server.port;
  server.region = stringOrUndefined(entry.region) ?? server.region;
  server.gm = numberOrUndefined(entry.gm) ?? server.gm;
  server.mods = booleanOrUndefined(entry.mods) ?? server.mods;
  server.password = booleanOrUndefined(entry.password) ?? server.password;
  server.whitelist = booleanOrUndefined(entry.whitelist) ?? server.whitelist;
  server.queryUrl = queryUrl ?? server.queryUrl;
  server.lastSeen = now;
}

export async function refreshMasterServerList(options: {
  refreshQueryData?: boolean;
} = {}): Promise<MasterServerListSyncResult> {
  const now = new Date();
  const response = await fetchMasterServerList();
  const entries = Array.isArray(response?.data)
    ? response.data as MasterServerListEntry[]
    : [];

  let inserted = 0;
  let updated = 0;
  let refreshed = 0;

  for (const entry of entries) {
    const steamId = steamIdOrUndefined(entry.steamid);
    const queryUrl = queryUrlFor(entry);
    if (!steamId || !queryUrl) continue;

    let server = db.data.servers.find(
      (candidate) => candidate.steamId === steamId || candidate.id === steamId,
    );
    if (!server) {
      server = {
        id: steamId,
        steamId,
        label: stringOrUndefined(entry.name) ?? steamId,
        queryUrl,
        public: true,
        createdAt: now,
        firstSeen: now,
        lastSeen: now,
      };
      db.data.servers.push(server);
      inserted += 1;
    } else {
      updated += 1;
    }

    applyMasterEntry(server, entry, now);
    if (options.refreshQueryData && await refreshQueryData(server, now)) {
      refreshed += 1;
    }
  }

  await db.write();
  return { fetched: entries.length, inserted, updated, refreshed };
}

export async function refreshAllServerQueryData(): Promise<MasterServerListSyncResult> {
  const now = new Date();
  let refreshed = 0;
  for (const server of db.data.servers) {
    if (await refreshQueryData(server, now)) refreshed += 1;
  }
  await db.write();
  return { fetched: db.data.servers.length, inserted: 0, updated: 0, refreshed };
}

export function startMasterServerListSync(): { stop: () => void } | null {
  if (!AppConfig.enableStorage) return null;

  void refreshMasterServerList({ refreshQueryData: true }).catch((error) => {
    defaultLogger.error('Master server list refresh failed:', error);
  });
  const timer = setInterval(() => {
    void refreshMasterServerList({ refreshQueryData: true }).catch((error) => {
      defaultLogger.error('Master server list refresh failed:', error);
    });
  }, AppConfig.masterServerListRefreshIntervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}
