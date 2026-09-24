import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
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
    };
    await ensureIndexes(collections);
    if (AppConfig.enableStorage) await migrateLegacyJson(collections);
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
    await writeLegacyRecords(next, source);
  }
  const actual = await verifyLegacyRecords(next);
  if (!sameMigrationCounts(actual, expected)) {
    throw new Error('LowDB to Mongo migration verification failed; source data was left untouched');
  }
  if (!marker) {
    await migrations.insertOne({
      id: 'lowdb-to-mongo-v1',
      completedAt: new Date(),
      source: 'lowdb',
      counts: {
        servers: actual.servers.count,
        users: actual.users.count,
        serverStatistics: actual.serverStatistics.count,
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
  await Promise.all([
    bulkReplace(next.servers, servers),
    bulkReplace(next.users, users),
    bulkReplace(next.serverStatistics, statistics),
  ]);
}

async function bulkReplace<T extends { id: string }>(collection: Collection<T & Document>, records: T[]): Promise<void> {
  if (records.length === 0) return;
  const operations = records.map((record) => ({
    replaceOne: { filter: { id: record.id }, replacement: record, upsert: true },
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

async function verifyLegacyRecords(next: MongoCollections): Promise<Record<'servers' | 'users' | 'serverStatistics', MigrationSummary>> {
  const [servers, users, serverStatistics] = await Promise.all([
    next.servers.find({}, { projection: { _id: 0 } }).toArray(),
    next.users.find({}, { projection: { _id: 0 } }).toArray(),
    next.serverStatistics.find({}, { projection: { _id: 0 } }).toArray(),
  ]);
  return {
    servers: summarizeRecords(servers),
    users: summarizeRecords(users),
    serverStatistics: summarizeStatistics(serverStatistics),
  };
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
    return left.count === right.count && left.uniqueIds === right.uniqueIds
      && left.sampleCount === right.sampleCount && left.onlineSampleCount === right.onlineSampleCount
      && left.playerSampleTotal === right.playerSampleTotal && left.maxPlayers === right.maxPlayers;
  });
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
  ]);
}

function isExpectedMissingIndexError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'codeName' in error &&
    (error.codeName === 'IndexNotFound' || error.codeName === 'NamespaceNotFound')
  );
}
