import { db } from '../db/json.js';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import { AppConfig } from '../utils/app-config.js';

interface CacheEntry {
  expiresAt: number;
  response: ServerLiveStatusResponse;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ServerLiveStatusResponse>>();

async function fetchJson(url: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, data: await response.json() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'UNKNOWN_ERROR',
    };
  }
}

function buildInfoUrl(queryUrl: string): string {
  return new URL('info', `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function buildPlayerListUrl(queryUrl: string): string {
  return new URL('playerlist', `${queryUrl.replace(/\/+$/, '')}/`).toString();
}

function playersFromPayload(payload: unknown): unknown[] | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const players = (payload as { players?: unknown }).players;
  return Array.isArray(players) ? players : undefined;
}

async function fetchLiveStatus(queryUrl: string): Promise<ServerLiveStatusResponse> {
  const [queryResult, infoResult, playerlistResult] = await Promise.all([
    fetchJson(queryUrl),
    fetchJson(buildInfoUrl(queryUrl)),
    fetchJson(buildPlayerListUrl(queryUrl)),
  ]);

  const lastChecked = new Date().toISOString() as ServerLiveStatusResponse['lastChecked'];
  const response: ServerLiveStatusResponse = {
    status: queryResult.ok ? 'online' : 'offline',
    lastChecked,
  };

  if (queryResult.ok) {
    response.queryData = queryResult.data;
  } else {
    response.errorMessage = queryResult.error;
  }

  if (infoResult.ok) response.infoData = infoResult.data;
  if (playerlistResult.ok) response.onlinePlayers = playersFromPayload(playerlistResult.data);

  return response;
}

export async function getServerLiveStatus(serverId: string): Promise<ServerLiveStatusResponse> {
  const server = db.data.servers.find((entry) => entry.id === serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  if (!server.queryUrl) throw new Error('QUERY_URL_MISSING');

  const now = Date.now();
  const cached = cache.get(serverId);
  if (cached && cached.expiresAt > now) {
    return cached.response;
  }

  const existing = inflight.get(serverId);
  if (existing) return existing;

  const request = fetchLiveStatus(server.queryUrl)
    .then((response) => {
      cache.set(serverId, {
        expiresAt: Date.now() + AppConfig.liveQueryProxyCacheTtlMs,
        response,
      });
      return response;
    })
    .finally(() => {
      inflight.delete(serverId);
    });

  inflight.set(serverId, request);
  return request;
}

export function clearServerLiveStatusCache(): void {
  cache.clear();
  inflight.clear();
}
