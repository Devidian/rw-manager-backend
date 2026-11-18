import { MongoClient, ObjectId, type Collection, type Db, type Document } from 'mongodb';
import { access, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import type { JsonDbUser } from '../interfaces/app-user.js';
import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

export interface MongoCollections {
  servers: Collection<ServerConfig & Document>;
  users: Collection<JsonDbUser & Document>;
  serverStatistics: Collection<ServerStatisticsBucket & Document>;
  playerMappings: Collection<PlayerMapping & Document>;
  suppressedServers: Collection<{ endpoint: string; suppressedAt: Date } & Document>;
}

export interface PlayerMapping {
  _id: ObjectId;
  uid: string;
  name?: string;
  privateFlag?: boolean;
  globalLastSeen?: Date;
  steamCheckedAt?: Date;
  steamMissingSince?: Date;
  steamError?: string;
}

export function getMongoClient(): MongoClient | undefined {
  return client;
}

interface LegacyJsonData {
  servers?: ServerConfig[];
  users?: JsonDbUser[];
  serverStatistics?: ServerStatisticsBucket[];
}

interface MigrationMarker {
  id: string;
  completedAt: Date;
  source: 'lowdb';
  counts: { servers: number; users: number; serverStatistics: number };
}

interface MigrationSummary {
  count: number;
  uniqueIds: number;
  sampleCount: number;
  onlineSampleCount: number;
  playerSampleTotal: number;
  maxPlayers: number;
}

let client: MongoClient | undefined;
let database: Db | undefined;
let collections: MongoCollections | undefined;
let bootstrapStarted = false;

export async function bootstrapMongoDb(): Promise<MongoCollections | undefined> {
  if (collections) return collections;
  if (bootstrapStarted) return undefined;
  bootstrapStarted = true;

  if (!AppConfig.mongoUri) {
    if (AppConfig.enableStorage) {
      bootstrapStarted = false;
      throw new Error('MONGODB_URI is required when ENABLE_STORAGE=true');
    }
    defaultLogger.warn('MONGODB_URI is not set; using JSON database fallback');
    return undefined;
  }

  try {
    client = new MongoClient(AppConfig.mongoUri, {
      serverSelectionTimeoutMS: AppConfig.mongoConnectTimeoutMs,
      connectTimeoutMS: AppConfig.mongoConnectTimeoutMs,
    });
    await client.connect();
    database = client.db(AppConfig.mongoDatabaseName);
    collections = {
      servers: database.collection<ServerConfig & Document>('servers'),
      users: database.collection<JsonDbUser & Document>('users'),
      serverStatistics: database.collection<ServerStatisticsBucket & Document>('server_statistics'),
      playerMappings: database.collection<PlayerMapping & Document>('player_mappings'),
      suppressedServers: database.collection<{ endpoint: string; suppressedAt: Date } & Document>('suppressed_servers'),
    };
    await ensureIndexes(collections);
    if (AppConfig.enableStorage) await migrateLegacyJson(collections);
    if (AppConfig.enableStorage) await migratePlayerReferences(collections);
    defaultLogger.log(`MongoDB connected: ${AppConfig.mongoDatabaseName}`);
    return collections;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    defaultLogger.warn(`MongoDB unavailable: ${message}`);
    collections = undefined;
    await closeMongoDb();
    if (AppConfig.enableStorage) throw error;
    return undefined;
  }
}

async function migrateLegacyJson(next: MongoCollections): Promise<void> {
  const source = await readLegacyJson();
  if (!source) return;
  const migrations = database!.collection<MigrationMarker & Document>('migrations');
  const marker = await migrations.findOne({ id: 'lowdb-to-mongo-v1' });
  const expected = migrationCounts(source);
  if (!marker) {
    const existing = await legacyRecordIds(next, source);
    await writeLegacyRecords(next, source);
    await verifyLegacyRecords(next, source, existing);
  } else {
    await verifyLegacyRecords(next, source, emptyLegacyRecordIds());
  }
  if (!marker) {
    await migrations.insertOne({
      id: 'lowdb-to-mongo-v1',
      completedAt: new Date(),
      source: 'lowdb',
      counts: {
        servers: expected.servers.count,
        users: expected.users.count,
        serverStatistics: expected.serverStatistics.count,
      },
    });
    defaultLogger.log('LowDB to Mongo migration verified');
  }
  await backupLegacyJson();
}

async function backupLegacyJson(): Promise<void> {
  const source = path.join(AppConfig.dataRoot, 'data.json');
  const backup = `${source}.bak`;
  const sourceExists = await exists(source);
  if (!sourceExists) return;
  if (await exists(backup)) {
    throw new Error('Legacy data.json and data.json.bak both exist; source was left untouched');
  }
  await rename(source, backup);
  defaultLogger.log('LowDB source archived as data.json.bak after verified Mongo migration');
}

async function readLegacyJson(): Promise<LegacyJsonData | undefined> {
  const source = path.join(AppConfig.dataRoot, 'data.json');
  if (!await exists(source)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(source, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read legacy data.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Unable to read legacy data.json: root must be an object');
  }
  const data = parsed as LegacyJsonData;
  for (const key of ['servers', 'users', 'serverStatistics'] as const) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`Unable to read legacy data.json: ${key} must be an array`);
    }
  }
  return data;
}

async function writeLegacyRecords(next: MongoCollections, source: LegacyJsonData): Promise<void> {
  const servers = source.servers ?? [];
  const users = source.users ?? [];
  const statistics = source.serverStatistics ?? [];
  assertUniqueIds('servers', servers);
  assertUniqueIds('users', users);
  assertUniqueIds('serverStatistics', statistics);
  await Promise.all([bulkInsertMissing(next.servers, servers), bulkInsertMissing(next.users, users), bulkInsertMissing(next.serverStatistics, statistics)]);
}

async function bulkInsertMissing<T extends { id: string }>(collection: Collection<T & Document>, records: T[]): Promise<void> {
  if (records.length === 0) return;
  const operations = records.map((record) => ({
    updateOne: { filter: { id: record.id }, update: { $setOnInsert: record }, upsert: true },
  }));
  await collection.bulkWrite(operations as unknown as Parameters<typeof collection.bulkWrite>[0]);
}

function assertUniqueIds(name: string, records: Array<{ id: unknown }>): void {
  if (records.some((record) => typeof record.id !== 'string' || !record.id.trim())
      || new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error(`LowDB to Mongo migration verification failed: ${name} contains invalid or duplicate ids`);
  }
}

function migrationCounts(source: LegacyJsonData): Record<'servers' | 'users' | 'serverStatistics', MigrationSummary> {
  return {
    servers: summarizeRecords(source.servers ?? []),
    users: summarizeRecords(source.users ?? []),
    serverStatistics: summarizeStatistics(source.serverStatistics ?? []),
  };
}

type LegacyRecordIds = Record<'servers' | 'users' | 'serverStatistics', Set<string>>;

async function legacyRecordIds(next: MongoCollections, source: LegacyJsonData): Promise<LegacyRecordIds> {
  const ids = legacySourceIds(source);
  const [servers, users, serverStatistics] = await Promise.all([
    findRecordsByIds(next.servers, ids.servers),
    findRecordsByIds(next.users, ids.users),
    findRecordsByIds(next.serverStatistics, ids.serverStatistics),
  ]);
  return {
    servers: new Set(servers.map((record) => record.id)),
    users: new Set(users.map((record) => record.id)),
    serverStatistics: new Set(serverStatistics.map((record) => record.id)),
  };
}

function legacySourceIds(source: LegacyJsonData): LegacyRecordIds {
  return {
    servers: new Set((source.servers ?? []).map((record) => record.id)),
    users: new Set((source.users ?? []).map((record) => record.id)),
    serverStatistics: new Set((source.serverStatistics ?? []).map((record) => record.id)),
  };
}

function emptyLegacyRecordIds(): LegacyRecordIds {
  return { servers: new Set(), users: new Set(), serverStatistics: new Set() };
}

async function findRecordsByIds<T extends { id: string }>(collection: Collection<T & Document>, ids: Set<string>): Promise<T[]> {
  if (ids.size === 0) return [];
  const records = await collection.find({ id: { $in: [...ids] } } as never, { projection: { _id: 0 } }).toArray();
  return records as unknown as T[];
}

async function verifyLegacyRecords(next: MongoCollections, source: LegacyJsonData, existing: LegacyRecordIds): Promise<void> {
  const ids = legacySourceIds(source);
  const [servers, users, serverStatistics] = await Promise.all([
    findRecordsByIds(next.servers, ids.servers),
    findRecordsByIds(next.users, ids.users),
    findRecordsByIds(next.serverStatistics, ids.serverStatistics),
  ]);
  const expected = migrationCounts(source);
  const actual = {
    servers: summarizeRecords(servers),
    users: summarizeRecords(users),
    serverStatistics: summarizeStatistics(serverStatistics),
  };
  const expectedInsertedStatistics = summarizeStatistics((source.serverStatistics ?? []).filter((record) => !existing.serverStatistics.has(record.id)));
  const actualInsertedStatistics = summarizeStatistics(serverStatistics.filter((record) => !existing.serverStatistics.has(record.id)));
  if (!sameMigrationCounts(actual, expected)
      || !sameStatisticAggregates(actualInsertedStatistics, expectedInsertedStatistics)) {
    throw new Error('LowDB to Mongo migration verification failed; source data was left untouched');
  }
}

function summarizeRecords(records: Array<{ id: unknown }>): MigrationSummary {
  return { count: records.length, uniqueIds: new Set(records.map((record) => record.id)).size, sampleCount: 0, onlineSampleCount: 0, playerSampleTotal: 0, maxPlayers: 0 };
}

function summarizeStatistics(records: ServerStatisticsBucket[]): MigrationSummary {
  const summary = summarizeRecords(records);
  return {
    ...summary,
    sampleCount: records.reduce((total, record) => total + finiteNumber(record.sampleCount), 0),
    onlineSampleCount: records.reduce((total, record) => total + finiteNumber(record.onlineSampleCount), 0),
    playerSampleTotal: records.reduce((total, record) => total + finiteNumber(record.playerSampleTotal), 0),
    maxPlayers: records.reduce((maximum, record) => Math.max(maximum, finiteNumber(record.maxPlayers)), 0),
  };
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sameMigrationCounts(
  actual: Record<'servers' | 'users' | 'serverStatistics', MigrationSummary>,
  expected: Record<'servers' | 'users' | 'serverStatistics', MigrationSummary>,
): boolean {
  return (['servers', 'users', 'serverStatistics'] as const).every((key) => {
    const left = actual[key];
    const right = expected[key];
    return left.count === right.count && left.uniqueIds === right.uniqueIds;
  });
}

function sameStatisticAggregates(actual: MigrationSummary, expected: MigrationSummary): boolean {
  return actual.sampleCount === expected.sampleCount
    && actual.onlineSampleCount === expected.onlineSampleCount
    && actual.playerSampleTotal === expected.playerSampleTotal
    && actual.maxPlayers === expected.maxPlayers;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export function getMongoCollections(): MongoCollections | undefined {
  return collections;
}

export async function closeMongoDb(): Promise<void> {
  if (client) {
    await client.close();
  }
  client = undefined;
  database = undefined;
  collections = undefined;
  bootstrapStarted = false;
}

async function ensureIndexes(next: MongoCollections): Promise<void> {
  try {
    await next.servers.dropIndex('steamId_1');
  } catch (error) {
    if (!isExpectedMissingIndexError(error)) throw error;
  }

  await Promise.all([
    next.servers.createIndex({ id: 1 }, { unique: true }),
    next.servers.createIndex({ alternateIds: 1 }, { unique: true, sparse: true }),
    next.servers.createIndex({ 'knownPlayers.uid': 1 }),
    next.servers.createIndex({ 'onlinePlayers.uid': 1 }),
    next.servers.createIndex(
      { ip: 1, port: 1 },
      {
        unique: true,
        partialFilterExpression: {
          ip: { $type: 'string' },
          port: { $type: 'number' },
        },
      },
    ),
    next.users.createIndex({ id: 1 }, { unique: true }),
    next.users.createIndex({ username: 1 }, { unique: true }),
    next.users.createIndex({ email: 1 }, { unique: true }),
    next.users.createIndex({ steamId: 1 }, { unique: true, sparse: true }),
    next.serverStatistics.createIndex({ id: 1 }, { unique: true }),
    next.serverStatistics.createIndex({ serverId: 1, hourStart: 1 }, { unique: true }),
    next.suppressedServers.createIndex({ endpoint: 1 }, { unique: true }),
    next.playerMappings.createIndex({ uid: 1 }, { unique: true }),
    next.playerMappings.createIndex({ globalLastSeen: 1, steamCheckedAt: 1 }),
  ]);
}

/** Additive and repeatable: a crash leaves only rows that are safe to revisit. */
export async function migratePlayerReferences(next: MongoCollections): Promise<void> {
  const playerRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? value as Record<string, unknown> : {};
  for await (const server of next.servers.find({}, { projection: { _id: 1, knownPlayers: 1, onlinePlayers: 1, lastChecked: 1 } })) {
    const knownPlayers = Array.isArray(server.knownPlayers) ? server.knownPlayers : [];
    const onlinePlayers = Array.isArray(server.onlinePlayers) ? server.onlinePlayers : [];
    const uids = [...new Set([...knownPlayers, ...onlinePlayers].flatMap((value) => {
      const uid = playerRecord(value).uid ?? playerRecord(value).UID;
      return typeof uid === 'string' && uid.trim() && !(typeof playerRecord(value).id === 'number' && uid.trim() === String(playerRecord(value).id)) ? [uid.trim()] : [];
    }))];
    for (const uid of uids) {
      const player = [...knownPlayers, ...onlinePlayers].map(playerRecord).find((item) => (item.uid ?? item.UID) === uid);
      const name = player?.name ?? player?.Name;
      await next.playerMappings.updateOne({ uid }, { $setOnInsert: { uid, ...(typeof name === 'string' && name.trim() ? { name: name.trim() } : {}) } }, { upsert: true });
      const knownSeen = knownPlayers.map(playerRecord).filter((item) => item.uid === uid)
        .map((item) => typeof item.lastseen === 'number' ? item.lastseen * 1000 : 0);
      const onlineSeen = onlinePlayers.map(playerRecord).some((item) => (item.uid ?? item.UID) === uid)
        ? new Date(server.lastChecked ?? 0).getTime() : 0;
      const latest = Math.max(0, ...knownSeen, Number.isFinite(onlineSeen) ? onlineSeen : 0);
      if (latest > 0) await next.playerMappings.updateOne({ uid }, { $max: { globalLastSeen: new Date(latest) } });
    }
    const mappings = await next.playerMappings.find({ uid: { $in: uids } }).toArray();
    const ids = new Map(mappings.map((item) => [item.uid, item._id.toHexString()]));
    const attach = (items: unknown[]) => items.map((value) => {
      const item = playerRecord(value);
      const uid = item.uid ?? item.UID;
      return typeof uid === 'string' && ids.has(uid)
        ? { ...item, playerMappingId: ids.get(uid) } : value;
    });
    await next.servers.updateOne({ _id: server._id }, { $set: { knownPlayers: attach(knownPlayers) as ServerConfig['knownPlayers'], onlinePlayers: attach(onlinePlayers) } });
  }
  const statisticUids = new Map<string, Date | undefined>();
  const statisticQuery = { 'onlinePlayerUids.0': { $exists: true } };
  for await (const bucket of next.serverStatistics.find(statisticQuery, { projection: { onlinePlayerUids: 1, hourStart: 1 } })) {
    const observedAt = new Date(bucket.hourStart ?? 0);
    for (const uid of bucket.onlinePlayerUids ?? []) {
      if (typeof uid !== 'string' || !uid.trim()) continue;
      const previous = statisticUids.get(uid);
      if (!statisticUids.has(uid) || (Number.isFinite(observedAt.getTime()) && observedAt.getTime() > (previous?.getTime() ?? 0))) {
        statisticUids.set(uid, Number.isFinite(observedAt.getTime()) && observedAt.getTime() > 0 ? observedAt : previous);
      }
    }
  }
  const uidEntries = [...statisticUids];
  for (let offset = 0; offset < uidEntries.length; offset += 1000) {
    await next.playerMappings.bulkWrite(uidEntries.slice(offset, offset + 1000).map(([uid, observedAt]) => ({
      updateOne: { filter: { uid }, update: {
        $setOnInsert: { uid }, ...(observedAt ? { $max: { globalLastSeen: observedAt } } : {}),
      }, upsert: true },
    })), { ordered: false });
  }
  const statisticMappings = await next.playerMappings.find({ uid: { $in: [...statisticUids.keys()] } }).toArray();
  const statisticIds = new Map(statisticMappings.map((item) => [item.uid, item._id.toHexString()]));
  const statisticUpdates = [];
  for await (const bucket of next.serverStatistics.find(statisticQuery, { projection: { _id: 1, onlinePlayerUids: 1, onlinePlayerIds: 1 } })) {
    const ids = [...new Set((bucket.onlinePlayerUids ?? []).map((uid) => statisticIds.get(uid)).filter((id): id is string => !!id))];
    if (ids.length === bucket.onlinePlayerIds?.length && ids.every((id) => bucket.onlinePlayerIds?.includes(id))) continue;
    statisticUpdates.push({ updateOne: { filter: { _id: bucket._id }, update: { $set: { onlinePlayerIds: ids } } } });
    if (statisticUpdates.length >= 1000) await next.serverStatistics.bulkWrite(statisticUpdates.splice(0), { ordered: false });
  }
  if (statisticUpdates.length) await next.serverStatistics.bulkWrite(statisticUpdates, { ordered: false });
}

function isExpectedMissingIndexError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'codeName' in error &&
    (error.codeName === 'IndexNotFound' || error.codeName === 'NamespaceNotFound')
  );
}
