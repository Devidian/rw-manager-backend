import { db } from './json.js';
import { getMongoCollections } from './mongodb.js';
import type {
  ServerStatisticsBucket,
  ServerStatisticsSample,
} from '../interfaces/server-statistics.js';

function clampToHour(date: Date): Date {
  const hour = new Date(date);
  hour.setUTCMinutes(0, 0, 0);
  return hour;
}

function bucketId(serverId: string, hourStart: string): string {
  return `${serverId}:${hourStart}`;
}

function playerCountFromSample(sample: ServerStatisticsSample): number {
  return Number.isFinite(sample.playerCount) && sample.playerCount > 0
    ? Math.floor(sample.playerCount)
    : 0;
}

function uniqueStrings(values: unknown): string[] {
  return Array.isArray(values)
    ? [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))]
    : [];
}

function normalizeSampleUids(sample: ServerStatisticsSample): string[] {
  return uniqueStrings(sample.onlinePlayerUids);
}

function finalizeBucket(bucket: Omit<ServerStatisticsBucket, 'averagePlayers' | 'availability'>): ServerStatisticsBucket {
  return {
    ...bucket,
    onlinePlayerUids: uniqueStrings(bucket.onlinePlayerUids),
    averagePlayers:
      bucket.sampleCount > 0
        ? bucket.playerSampleTotal / bucket.sampleCount
        : 0,
    availability:
      bucket.sampleCount > 0
        ? (bucket.onlineSampleCount / bucket.sampleCount) * 100
        : 0,
  };
}

function stripMongoId(bucket: ServerStatisticsBucket & { _id?: unknown }): ServerStatisticsBucket {
  const { _id, ...rest } = bucket;
  void _id;
  return rest;
}

function jsonBuckets(): ServerStatisticsBucket[] {
  db.data.serverStatistics = Array.isArray(db.data.serverStatistics)
    ? db.data.serverStatistics
    : [];
  return db.data.serverStatistics;
}

export async function recordServerStatisticsSample(sample: ServerStatisticsSample): Promise<ServerStatisticsBucket> {
  const hourStart = clampToHour(sample.sampledAt).toISOString();
  const id = bucketId(sample.serverId, hourStart);
  const playerCount = playerCountFromSample(sample);
  const onlinePlayerUids = normalizeSampleUids(sample);
  const updatedAt = sample.sampledAt.toISOString();
  const mongo = getMongoCollections();

  if (mongo) {
    await mongo.serverStatistics.updateOne(
      { id },
      {
        $setOnInsert: {
          id,
          serverId: sample.serverId,
          hourStart,
        },
        $inc: {
          sampleCount: 1,
          onlineSampleCount: sample.online ? 1 : 0,
          playerSampleTotal: playerCount,
        },
        $max: { maxPlayers: playerCount },
        $set: { updatedAt },
        ...(onlinePlayerUids.length > 0
          ? { $addToSet: { onlinePlayerUids: { $each: onlinePlayerUids } } }
          : {}),
      },
      { upsert: true },
    );
    const bucket = await mongo.serverStatistics.findOne({ id }, { projection: { _id: 0 } });
    if (bucket) {
      return finalizeBucket(bucket as Omit<ServerStatisticsBucket, 'averagePlayers' | 'availability'>);
    }
  }

  const buckets = jsonBuckets();
  const existing = buckets.find((entry) => entry.id === id);
  const next = finalizeBucket({
    id,
    serverId: sample.serverId,
    hourStart,
    sampleCount: (existing?.sampleCount ?? 0) + 1,
    onlineSampleCount: (existing?.onlineSampleCount ?? 0) + (sample.online ? 1 : 0),
    playerSampleTotal: (existing?.playerSampleTotal ?? 0) + playerCount,
    maxPlayers: Math.max(existing?.maxPlayers ?? 0, playerCount),
    onlinePlayerUids: uniqueStrings([...(existing?.onlinePlayerUids ?? []), ...onlinePlayerUids]),
    updatedAt,
  });

  if (existing) {
    Object.assign(existing, next);
  } else {
    buckets.push(next);
  }
  await db.write();
  return next;
}

export async function listServerStatisticsBuckets(params: {
  serverId: string;
  from?: Date;
  to?: Date;
}): Promise<ServerStatisticsBucket[]> {
  const from = params.from?.toISOString();
  const to = params.to?.toISOString();
  const mongo = getMongoCollections();

  if (mongo) {
    const hourStart: Record<string, string> = {};
    if (from) hourStart.$gte = from;
    if (to) hourStart.$lt = to;
    const query = {
      serverId: params.serverId,
      ...(Object.keys(hourStart).length > 0 ? { hourStart } : {}),
    };
    const buckets = await mongo.serverStatistics
      .find(query, { projection: { _id: 0 } })
      .sort({ hourStart: 1 })
      .toArray();
    return buckets.map((bucket) =>
      finalizeBucket(stripMongoId(bucket as ServerStatisticsBucket & { _id?: unknown })),
    );
  }

  return jsonBuckets()
    .filter((bucket) => {
      if (bucket.serverId !== params.serverId) return false;
      if (from && bucket.hourStart < from) return false;
      if (to && bucket.hourStart >= to) return false;
      return true;
    })
    .sort((a, b) => a.hourStart.localeCompare(b.hourStart));
}

export async function listGlobalStatisticsBuckets(params: {
  from?: Date;
  to?: Date;
}): Promise<ServerStatisticsBucket[]> {
  const from = params.from?.toISOString();
  const to = params.to?.toISOString();
  const mongo = getMongoCollections();

  if (mongo) {
    const hourStart: Record<string, string> = {};
    if (from) hourStart.$gte = from;
    if (to) hourStart.$lt = to;
    const query = Object.keys(hourStart).length > 0 ? { hourStart } : {};
    const buckets = await mongo.serverStatistics
      .find(query, { projection: { _id: 0 } })
      .sort({ hourStart: 1, serverId: 1 })
      .toArray();
    return buckets.map((bucket) =>
      finalizeBucket(stripMongoId(bucket as ServerStatisticsBucket & { _id?: unknown })),
    );
  }

  return jsonBuckets()
    .filter((bucket) => {
      if (from && bucket.hourStart < from) return false;
      if (to && bucket.hourStart >= to) return false;
      return true;
    })
    .sort((a, b) => a.hourStart.localeCompare(b.hourStart) || a.serverId.localeCompare(b.serverId))
    .map((bucket) => finalizeBucket(bucket));
}
