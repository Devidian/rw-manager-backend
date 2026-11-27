import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';

const counts = new Map<string, { queryUrl: string; count: number; expiresAt: number }>();
interface PublicOnlinePlayer {
  name?: string;
  uid?: string;
}

const pending = new Map<string, Promise<PublicOnlinePlayer[] | null>>();

function publicUid(value: unknown): string | undefined {
  // Accept explicit network identities only, never local slot IDs or names.
  if (typeof value !== 'string') return undefined;
  const uid = value.trim();
  return /^\d{17}$|^[a-f0-9]{32}$|^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(uid)
    ? uid.toLowerCase() : undefined;
}

export async function hasToolsPlayerStatus(serverId: string): Promise<boolean> {
  const { hasActiveGameConnectorFeature } = await import('./game-connector-websocket-service.js');
  return hasActiveGameConnectorFeature(serverId, 'playerStatus')
    && hasActiveGameConnectorFeature(serverId, 'playerConsentRevoked');
}

export function cachedPublicPlayerCount(server: ServerConfig): number | undefined {
  const entry = counts.get(server.id);
  if (entry && entry.expiresAt > Date.now() && entry.queryUrl === server.queryUrl) return entry.count;
  if (entry) counts.delete(server.id);
  return undefined;
}

export function clearPublicPlayerCount(serverId: string): void {
  counts.delete(serverId);
}

export async function readPublicOnlinePlayerNames(server: ServerConfig): Promise<string[] | null> {
  const players = await readPublicOnlinePlayers(server);
  return players?.flatMap(({ name }) => name ? [name] : []) ?? null;
}

export async function readPublicOnlinePlayers(server: Pick<ServerConfig, 'queryUrl'>): Promise<PublicOnlinePlayer[] | null> {
  if (!server.queryUrl) return null;
  const key = server.queryUrl.replace(/\/+$/, '');
  const existing = pending.get(key);
  if (existing) return existing;
  const request = fetchPlayers(key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function fetchPlayers(queryUrl: string): Promise<PublicOnlinePlayer[] | null> {
  try {
    const response = await fetch(new URL('playerlist', queryUrl.replace(/\/+$/, '') + '/'), {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const payload: { players?: unknown } | null = JSON.parse(await response.text(), (key: string, value: unknown, context?: { source?: string }) =>
      typeof value === 'number' && /^(uid|steamid)$/i.test(key) && /^\d{17}$/.test(context?.source ?? '')
        ? context?.source : value,
    );
    if (!Array.isArray(payload?.players) || payload.players.length > 1000) return null;
    return payload.players.flatMap((record): PublicOnlinePlayer[] => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) return [];
      const row = record as Record<string, unknown>;
      if (row.connected === false) return [];
      const name = typeof row.name === 'string' ? row.name.trim() || undefined : undefined;
      const uid = publicUid(row.uid) ?? publicUid(row.UID) ?? publicUid(row.steamid) ?? publicUid(row.steamId);
      return name || uid || row.connected === true || Number.isSafeInteger(row.id) ? [{ name, uid }] : [];
    });
  } catch {
    return null;
  }
}

export async function refreshPublicPlayerCount(server: ServerConfig, roster?: Promise<PublicOnlinePlayer[] | null>): Promise<number | undefined> {
  const queryUrl = server.queryUrl;
  if (!queryUrl || server.blocked || server.status === 'offline' || await hasToolsPlayerStatus(server.id)) {
    clearPublicPlayerCount(server.id);
    return undefined;
  }
  const cached = cachedPublicPlayerCount(server);
  if (cached !== undefined) return cached;
  const players = await (roster ?? readPublicOnlinePlayers(server));
  if (players === null || await hasToolsPlayerStatus(server.id)) return undefined;
  const count = players.filter(({ name }) => name).length;
  if (counts.size >= 5000) {
    for (const [id, entry] of counts) if (entry.expiresAt <= Date.now()) counts.delete(id);
  }
  if (counts.size < 5000) counts.set(server.id, {
    queryUrl, count, expiresAt: Date.now() + AppConfig.activePlayerListRefreshIntervalMs,
  });
  return count;
}
