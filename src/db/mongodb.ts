import { MongoClient, type Collection, type Db, type Document } from 'mongodb';
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

let client: MongoClient | undefined;
let database: Db | undefined;
let collections: MongoCollections | undefined;
let bootstrapStarted = false;

export async function bootstrapMongoDb(): Promise<MongoCollections | undefined> {
  if (collections) return collections;
  if (bootstrapStarted) return undefined;
  bootstrapStarted = true;

  if (!AppConfig.mongoUri) {
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
    defaultLogger.log(`MongoDB connected: ${AppConfig.mongoDatabaseName}`);
    return collections;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    defaultLogger.warn(`MongoDB unavailable; using JSON database fallback: ${message}`);
    collections = undefined;
    await closeMongoDb();
    return undefined;
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
  await Promise.all([
    next.servers.createIndex({ id: 1 }, { unique: true }),
    next.servers.createIndex({ steamId: 1 }, { unique: true, sparse: true }),
    next.users.createIndex({ id: 1 }, { unique: true }),
    next.users.createIndex({ username: 1 }, { unique: true }),
    next.users.createIndex({ email: 1 }, { unique: true }),
    next.users.createIndex({ steamId: 1 }, { unique: true, sparse: true }),
    next.serverStatistics.createIndex({ id: 1 }, { unique: true }),
    next.serverStatistics.createIndex({ serverId: 1, hourStart: 1 }, { unique: true }),
  ]);
}
