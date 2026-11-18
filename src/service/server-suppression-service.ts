import { getMongoCollections } from '../db/mongodb.js';

const temporarySuppression = new Set<string>();

function keys(ip?: string, port?: number, queryUrl?: string): string[] {
  const result: string[] = [];
  if (ip && port) result.push(`master:${ip}:${port}`);
  if (queryUrl) result.push(`query:${queryUrl.trim().replace(/\/+$/, '')}`);
  return result;
}

export async function isServerSuppressed(ip?: string, port?: number, queryUrl?: string): Promise<boolean> {
  const endpointKeys = keys(ip, port, queryUrl);
  if (endpointKeys.some((key) => temporarySuppression.has(key))) return true;
  const mongo = getMongoCollections();
  if (!mongo || endpointKeys.length === 0) return false;
  return !!await mongo.suppressedServers.findOne({ endpoint: { $in: endpointKeys } });
}

export async function suppressServer(ip?: string, port?: number, queryUrl?: string): Promise<void> {
  const endpointKeys = keys(ip, port, queryUrl);
  const mongo = getMongoCollections();
  if (mongo) {
    for (const endpoint of endpointKeys) {
      await mongo.suppressedServers.updateOne({ endpoint },
        { $set: { endpoint, suppressedAt: new Date() } }, { upsert: true });
    }
  } else {
    endpointKeys.forEach((key) => temporarySuppression.add(key));
  }
}

export async function unsuppressServer(ip?: string, port?: number, queryUrl?: string): Promise<void> {
  const endpointKeys = keys(ip, port, queryUrl);
  const mongo = getMongoCollections();
  if (mongo) await mongo.suppressedServers.deleteMany({ endpoint: { $in: endpointKeys } });
  endpointKeys.forEach((key) => temporarySuppression.delete(key));
}
