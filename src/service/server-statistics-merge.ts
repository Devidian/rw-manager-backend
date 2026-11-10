import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

function preference(a: ServerStatisticsBucket, b: ServerStatisticsBucket): number {
  const availabilityA = a.sampleCount > 0 ? a.onlineSampleCount / a.sampleCount : 0;
  const availabilityB = b.sampleCount > 0 ? b.onlineSampleCount / b.sampleCount : 0;
  return availabilityA - availabilityB
    || a.maxPlayers - b.maxPlayers
    || a.sampleCount - b.sampleCount
    || a.updatedAt.localeCompare(b.updatedAt);
}

/** Duplicate endpoints may be polled simultaneously, so their samples must not be summed. */
export function mergeServerStatisticsBuckets(targetId: string, buckets: ServerStatisticsBucket[]): ServerStatisticsBucket[] {
  const byHour = new Map<string, ServerStatisticsBucket[]>();
  for (const bucket of buckets) byHour.set(bucket.hourStart, [...(byHour.get(bucket.hourStart) ?? []), bucket]);
  return [...byHour.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hourStart, entries]) => {
    const best = entries.reduce((a, b) => preference(b, a) > 0 ? b : a);
    const maxPlayers = Math.max(...entries.map((entry) => entry.maxPlayers ?? 0));
    const playerSampleTotal = Math.max(best.playerSampleTotal ?? 0, ...entries.map((entry) => entry.playerSampleTotal ?? 0));
    return {
      ...best,
      id: `${targetId}:${hourStart}`,
      serverId: targetId,
      maxPlayers,
      playerSampleTotal,
      averagePlayers: best.sampleCount > 0 ? playerSampleTotal / best.sampleCount : 0,
      availability: best.sampleCount > 0 ? best.onlineSampleCount / best.sampleCount * 100 : 0,
      onlinePlayerUids: [...new Set(entries.flatMap((entry) => entry.onlinePlayerUids ?? []))],
    };
  });
}
