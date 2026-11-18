import { ObjectId } from 'mongodb';
import { getMongoCollections, type PlayerMapping } from '../db/mongodb.js';

const PRIVATE = '**PRIVATE**';
const visibilityListeners = new Set<(serverId: string) => void>();

export function subscribePlayerVisibilityChanges(listener: (serverId: string) => void): () => void {
  visibilityListeners.add(listener);
  return () => visibilityListeners.delete(listener);
}

export function stableUid(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value !== PRIVATE ? value.trim() : undefined;
}

function playerUid(value: { uid?: unknown; UID?: unknown; id?: unknown }): string | undefined {
  const uid = stableUid(value.uid ?? value.UID);
  return uid && !(typeof value.id === 'number' && uid === String(value.id)) ? uid : undefined;
}

export async function observePlayers(players: unknown[], at: Date): Promise<void> {
  const collection = getMongoCollections()?.playerMappings;
  if (!collection) return;
  for (const value of players) {
    if (!value || typeof value !== 'object') continue;
    const player = value as { uid?: unknown; UID?: unknown; id?: unknown; name?: unknown; Name?: unknown };
    const uid = playerUid(player);
    if (!uid) continue;
    const rawName = player.name ?? player.Name;
    const name = typeof rawName === 'string' && rawName.trim() ? rawName.trim() : undefined;
    await collection.updateOne({ uid }, {
      $setOnInsert: { uid },
      $max: { globalLastSeen: at },
      ...(name ? { $set: { name } } : {}),
    }, { upsert: true });
  }
}

export async function attachPlayerReferences<T extends { knownPlayers?: Array<{ uid?: string; name?: string }>; onlinePlayers?: unknown[] }>(server: T): Promise<T> {
  const collection = getMongoCollections()?.playerMappings;
  if (!collection) return server;
  const known = server.knownPlayers ?? [];
  const online = Array.isArray(server.onlinePlayers) ? server.onlinePlayers : [];
  const players = [...known, ...online].filter((item): item is { uid?: string; UID?: string; name?: string; Name?: string } =>
    !!item && typeof item === 'object' && !!playerUid(item as { uid?: unknown; UID?: unknown; id?: unknown }));
  for (const player of players) {
    const uid = playerUid(player)!;
    const name = player.name ?? player.Name;
    await collection.updateOne({ uid }, {
      $setOnInsert: { uid, ...(name ? { name } : {}) },
    }, { upsert: true });
  }
  const mappings = await mappingByUids(players.map((item) => playerUid(item)!));
  const attach = (value: unknown) => {
    if (!value || typeof value !== 'object') return value;
    const item = value as { uid?: string; UID?: string; id?: number };
    const uid = playerUid(item);
    const mapping = uid && mappings.get(uid);
    return mapping ? { ...item, playerMappingId: mapping._id.toHexString() } : value;
  };
  return { ...server, knownPlayers: known.map(attach), onlinePlayers: online.map(attach) } as T;
}

export async function mappingForId(id: string): Promise<PlayerMapping | null> {
  if (!ObjectId.isValid(id) || !/^[a-f\d]{24}$/i.test(id)) return null;
  return await getMongoCollections()?.playerMappings.findOne({ _id: new ObjectId(id) }) ?? null;
}

export async function mappingByUids(uids: string[]): Promise<Map<string, PlayerMapping>> {
  const collection = getMongoCollections()?.playerMappings;
  if (!collection || !uids.length) return new Map();
  const found = await collection.find({ uid: { $in: [...new Set(uids)] } }).toArray();
  return new Map(found.map((item) => [item.uid, item]));
}

export function privateMarker(): string { return PRIVATE; }
