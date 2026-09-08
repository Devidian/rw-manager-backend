import type { ServerConfig } from '../interfaces/server-config.js';
import type { PlayerMapHistory, PlayerMapHistorySector } from '../interfaces/player-map-history.js';
import { getCachedServerPlayers } from './server-plugin-data-service.js';
import { fetchNativePluginJson } from './native-plugin-request-service.js';

const PAGE_SIZE = 100;
const MAX_PAGES = 100;
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { expiresAtMs: number; value: PlayerMapHistory | null }>();

export async function getPlayerMapHistory(server: ServerConfig, steamId: string): Promise<PlayerMapHistory | null> {
  if (!knownPlayerUids(server).has(steamId)) return null;
  const key = `${server.id}:${steamId}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAtMs > Date.now()) return cached.value;

  const items: PlayerMapHistorySector[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL('plugins/oz---land-claim/player-map', `${server.queryUrl!.replace(/\/+$/, '')}/`);
    url.searchParams.set('uid', steamId);
    url.searchParams.set('page', String(page));
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    const result = await fetchNativePluginJson(server, url.toString());
    const parsed = result.ok ? parsePage(result.data) : null;
    if (!parsed) return remember(key, null);
    items.push(...parsed.items);
    if (!parsed.hasMore) return remember(key, { schemaVersion: 1, sectorSizeChunks: 256, items });
  }
  return remember(key, null);
}

function knownPlayerUids(server: ServerConfig): Set<string> {
  return new Set([...getCachedServerPlayers(server.id), ...(server.knownPlayers ?? [])]
    .map((player) => player.uid)
    .filter(Boolean));
}

function remember(key: string, value: PlayerMapHistory | null): PlayerMapHistory | null {
  cache.set(key, { expiresAtMs: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function parsePage(value: unknown): { hasMore: boolean; items: PlayerMapHistorySector[] } | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as { schemaVersion?: unknown; hasMore?: unknown; sectors?: unknown };
  if (page.schemaVersion !== 1 || typeof page.hasMore !== 'boolean' || !Array.isArray(page.sectors)) return null;
  const items = page.sectors.flatMap((sector): PlayerMapHistorySector[] => {
    if (!sector || typeof sector !== 'object') return [];
    const item = sector as Record<string, unknown>;
    return typeof item.sectorX === 'number' && Number.isSafeInteger(item.sectorX)
      && typeof item.sectorZ === 'number' && Number.isSafeInteger(item.sectorZ)
      && typeof item.bitmap === 'string' && typeof item.updatedAtMs === 'number'
      ? [{ sectorX: item.sectorX, sectorZ: item.sectorZ, bitmap: item.bitmap, updatedAtMs: item.updatedAtMs }]
      : [];
  });
  return items.length === page.sectors.length ? { hasMore: page.hasMore, items } : null;
}
