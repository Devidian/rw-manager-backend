import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';

const counts = new Map<string, { queryUrl: string; count: number; expiresAt: number }>();
const pending = new Map<string, Promise<string[] | null>>();

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
  if (!server.queryUrl) return null;
  const key = server.queryUrl;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = fetchNames(key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

async function fetchNames(queryUrl: string): Promise<string[] | null> {
  try {
    const response = await fetch(new URL('playerlist', queryUrl.replace(/\/+$/, '') + '/'), {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const payload = await response.json() as { players?: unknown } | null;
    if (!Array.isArray(payload?.players) || payload.players.length > 1000) return null;
    return payload.players.flatMap((record): string[] => {
      if (!record || typeof record !== 'object') return [];
      const row = record as { connected?: unknown; name?: unknown };
      return row.connected !== false && typeof row.name === 'string' && row.name.trim()
        ? [row.name.trim()] : [];
    });
  } catch {
    return null;
  }
}

export async function refreshPublicPlayerCount(server: ServerConfig): Promise<number | undefined> {
  const queryUrl = server.queryUrl;
  if (!queryUrl || server.blocked || server.status === 'offline' || await hasToolsPlayerStatus(server.id)) {
    clearPublicPlayerCount(server.id);
    return undefined;
  }
  const cached = cachedPublicPlayerCount(server);
  if (cached !== undefined) return cached;
  const names = await readPublicOnlinePlayerNames(server);
  if (names === null || await hasToolsPlayerStatus(server.id)) return undefined;
  if (counts.size >= 5000) {
    for (const [id, entry] of counts) if (entry.expiresAt <= Date.now()) counts.delete(id);
  }
  if (counts.size < 5000) counts.set(server.id, {
    queryUrl, count: names.length, expiresAt: Date.now() + AppConfig.activePlayerListRefreshIntervalMs,
  });
  return names.length;
}
