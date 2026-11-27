import type { ServerConfig } from '../interfaces/server-config.js';

export interface PlayerObservation {
  count: number;
  uids: readonly string[];
}

export function observedPlayerCount(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const { playercount, players, status } = payload as Record<string, unknown>;
  if (status === 'offline') return 0;
  return [playercount, players].find((value): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

export function serverObservationKeys(server: Pick<ServerConfig, 'id' | 'ip' | 'port' | 'queryUrl'>): string[] {
  const keys = [`id:${server.id}`];
  if (server.ip && server.port) keys.push(`game:${server.ip}:${server.port}`);
  if (server.queryUrl) {
    try {
      const url = new URL(server.queryUrl.trim());
      keys.push(`query:${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`);
    } catch {
      // An invalid query URL cannot identify an observed endpoint.
    }
  }
  return keys;
}

export function playerObservation(
  count: number | undefined,
  roster: ReadonlyArray<{ uid?: string }> | null,
): PlayerObservation | undefined {
  const observed = count ?? (roster?.length || undefined);
  if (observed === undefined) return undefined;
  return { count: observed, uids: roster?.flatMap(({ uid }) => uid ? [uid] : []) ?? [] };
}

export function totalObservedPlayers(observations: readonly PlayerObservation[]): number | undefined {
  if (!observations.length) return undefined;
  const seen = new Set<string>();
  let anonymous = 0;
  for (const { count, uids } of observations) {
    // A longer roster cannot establish which players belong to this count.
    const countedUids = uids.length <= count ? uids : [];
    countedUids.forEach(uid => seen.add(uid));
    anonymous += count - countedUids.length;
  }
  return seen.size + anonymous;
}
