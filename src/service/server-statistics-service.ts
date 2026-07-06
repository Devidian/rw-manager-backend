import { findServerById } from '../db/manager-store.js';
import { listGlobalStatisticsBuckets, listServerStatisticsBuckets } from '../db/server-statistics-store.js';
import type { GlobalStatisticsResponse } from '../dto/global-statistics-response.js';
import type { ServerStatisticsResponse } from '../dto/server-statistics-response.js';
import { getCachedServerPlayers } from './server-plugin-data-service.js';
import type { DbPlayer } from '../interfaces/game-player.js';

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  return date;
}

export async function getServerStatistics(params: {
  serverId: string;
  from?: unknown;
  to?: unknown;
}): Promise<ServerStatisticsResponse> {
  const server = await findServerById(params.serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');

  const from = parseDate(params.from, 'from');
  const to = parseDate(params.to, 'to');
  if (from && to && from >= to) {
    throw new Error('DATE_RANGE_INVALID');
  }

  const buckets = await listServerStatisticsBuckets({
    serverId: params.serverId,
    from,
    to,
  });
  return {
    serverId: params.serverId,
    from: from?.toISOString(),
    to: to?.toISOString(),
    buckets,
  };
}

export async function getGlobalStatistics(params: {
  from?: unknown;
  to?: unknown;
}): Promise<GlobalStatisticsResponse> {
  const from = parseDate(params.from, 'from');
  const to = parseDate(params.to, 'to');
  if (from && to && from >= to) {
    throw new Error('DATE_RANGE_INVALID');
  }

  const buckets = await listGlobalStatisticsBuckets({ from, to });
  const playerNamesByUid = new Map<string, string>();
  for (const serverId of new Set(buckets.map((bucket) => bucket.serverId))) {
    const server = await findServerById(serverId);
    const players: DbPlayer[] = [
      ...getCachedServerPlayers(serverId),
      ...(server?.knownPlayers ?? []),
    ];
    for (const player of players) {
      if (player.name && !playerNamesByUid.has(player.uid)) {
        playerNamesByUid.set(player.uid, player.name);
      }
    }
  }
  const players = [...new Set(buckets.flatMap((bucket) => bucket.onlinePlayerUids))]
    .sort()
    .map((uid) => ({
      uid,
      ...(playerNamesByUid.has(uid) ? { name: playerNamesByUid.get(uid) } : {}),
    }));
  return {
    from: from?.toISOString(),
    to: to?.toISOString(),
    buckets,
    players,
  };
}
