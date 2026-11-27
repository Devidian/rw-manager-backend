import { getMongoCollections } from './mongodb.js';
import type { GlobalPlayerBucket, GlobalPlayerHour, GlobalPlayerSample } from '../interfaces/global-player-statistics.js';
import { clampToHour } from '../utils/clamp-to-hour.js';

const memory = new Map<string, GlobalPlayerHour>();

export async function recordGlobalPlayerSample(at: Date, playerCount: number): Promise<void> {
  const hourStart = clampToHour(at).toISOString();
  const sample: GlobalPlayerSample = { sampledAt: at.toISOString(), playerCount };
  const collection = getMongoCollections()?.globalPlayerStatistics;
  if (collection) {
    await collection.updateOne(
      { hourStart },
      [{ $set: {
        hourStart,
        samples: { $cond: [
          { $in: [sample.sampledAt, { $ifNull: ['$samples.sampledAt', []] }] },
          '$samples',
          { $concatArrays: [{ $ifNull: ['$samples', []] }, [sample]] },
        ] },
      } }],
      { upsert: true },
    );
    return;
  }

  const bucket = memory.get(hourStart) ?? { hourStart, samples: [] };
  if (!bucket.samples.some(({ sampledAt }) => sampledAt === sample.sampledAt)) bucket.samples.push(sample);
  memory.set(hourStart, bucket);
}

export async function listGlobalPlayerBuckets(from?: Date, to?: Date): Promise<GlobalPlayerBucket[]> {
  const start = from?.toISOString();
  const end = to?.toISOString();
  const hourRange = { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
  const collection = getMongoCollections()?.globalPlayerStatistics;
  const hours = collection
    ? await collection.find(start || end ? { hourStart: hourRange } : {}, {
      projection: { _id: 0, hourStart: 1, samples: 1 },
    }).sort({ hourStart: 1 }).toArray()
    : [...memory.values()]
      .filter(({ hourStart }) => (!start || hourStart >= start) && (!end || hourStart < end))
      .sort((a, b) => a.hourStart.localeCompare(b.hourStart));

  return hours.flatMap(({ hourStart, samples }) => {
    if (!samples.length) return [];
    let minPlayers = Infinity;
    let maxPlayers = 0;
    let total = 0;
    for (const { playerCount } of samples) {
      minPlayers = Math.min(minPlayers, playerCount);
      maxPlayers = Math.max(maxPlayers, playerCount);
      total += playerCount;
    }
    return [{ hourStart, sampleCount: samples.length, minPlayers, maxPlayers, averagePlayers: total / samples.length }];
  });
}
