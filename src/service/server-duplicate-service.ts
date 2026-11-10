import { getMongoClient, getMongoCollections } from '../db/mongodb.js';
import { findServerById, listServers } from '../db/manager-store.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import { mergeKnownPlayers } from './observed-player-service.js';
import { clearServerLiveStatusCacheEntry } from './server-live-status-service.js';
import { closeGameConnectorSession } from './game-connector-websocket-service.js';
import { mergeServerStatisticsBuckets } from './server-statistics-merge.js';

export interface DuplicateEntry {
  id: string;
  name: string;
  shortname: string;
  map: string;
  gamemode: number;
  os: string;
  ip: string;
  port: number;
  firstSeen: string;
  lastSeen: string;
  status: string;
  strength: 'strong' | 'possible';
}

export interface DuplicateGroup { targetId: string; entries: DuplicateEntry[] }
export interface MergeSelection { targetId: string; sourceIds: string[] }
export interface MergePreview extends MergeSelection {
  currentAddress: string;
  affectedFavorites: number;
  statisticHours: number;
}

function fields(server: ServerConfig): Omit<DuplicateEntry, 'id' | 'ip' | 'port' | 'firstSeen' | 'lastSeen' | 'status' | 'strength'> | undefined {
  const data = server.data as Record<string, unknown> | undefined;
  const info = server.info as Record<string, unknown> | undefined;
  const name = typeof data?.name === 'string' ? data.name : server.name;
  const shortname = info?.shortname;
  const map = data?.map;
  const os = data?.os;
  const gamemode = data?.gamemode;
  if (typeof name !== 'string' || !name.trim() || typeof shortname !== 'string' || !shortname.trim()
    || typeof map !== 'string' || !map.trim() || typeof os !== 'string' || !os.trim()
    || typeof gamemode !== 'number' || !Number.isInteger(gamemode)) return undefined;
  return { name: name.trim(), shortname: shortname.trim(), map: map.trim(), os: os.trim(), gamemode };
}

function normalized(value: string): string { return value.normalize('NFKC').trim().toLocaleLowerCase('en-US'); }
function plainName(value: string): string {
  return value.replace(/<\/?(?:b|color(?:=[^>]*)?|align(?:=[^>]*)?)>/gi, '').trim();
}
function isDefaultName(value: string): boolean { return normalized(plainName(value)) === 'default rising world server'; }
function key(value: ReturnType<typeof fields>): string {
  return value ? JSON.stringify([normalized(value.shortname), normalized(value.map), value.gamemode, normalized(value.os)]) : '';
}
function seen(server: ServerConfig): number { return new Date(server.firstSeen ?? server.createdAt).getTime() || 0; }
function oldest(a: ServerConfig, b: ServerConfig): number {
  return seen(a) - seen(b) || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id);
}
function isCatalog(server: ServerConfig): boolean {
  return server.public === true && !server.userId && !!server.ip && Number.isInteger(server.port);
}
function entry(server: ServerConfig, targetName: string): DuplicateEntry {
  const value = fields(server)!;
  return {
    id: server.id, ...value, ip: server.ip!, port: server.port!,
    firstSeen: new Date(server.firstSeen ?? server.createdAt).toISOString(),
    lastSeen: new Date(server.lastSeen ?? server.createdAt).toISOString(),
    status: server.status ?? 'unknown',
    strength: normalized(value.name) === normalized(targetName) ? 'strong' : 'possible',
  };
}

export function duplicateGroups(servers: ServerConfig[]): DuplicateGroup[] {
  const groups = new Map<string, ServerConfig[]>();
  for (const server of servers) {
    if (!isCatalog(server)) continue;
    const value = fields(server);
    if (!value || isDefaultName(value.name)) continue;
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), server]);
  }
  return [...groups.values()].filter((group) => group.length > 1 && group.some((server) => server.status === 'online')).map((group) => {
    const sorted = group.sort(oldest);
    const targetName = fields(sorted[0])!.name;
    return { targetId: sorted[0].id, entries: sorted.map((server) => entry(server, targetName)) };
  }).sort((a, b) => a.entries[0].firstSeen.localeCompare(b.entries[0].firstSeen));
}

function selected(selection: MergeSelection, servers: ServerConfig[]): ServerConfig[] {
  if (!selection.targetId || !Array.isArray(selection.sourceIds) || !selection.sourceIds.length
    || selection.sourceIds.length > 100 || new Set(selection.sourceIds).size !== selection.sourceIds.length
    || selection.sourceIds.includes(selection.targetId)) throw new Error('MERGE_SELECTION_INVALID');
  const group = duplicateGroups(servers).find((item) => item.targetId === selection.targetId);
  if (!group || selection.sourceIds.some((id) => !group.entries.some((item) => item.id === id))) {
    throw new Error('MERGE_SELECTION_STALE');
  }
  return [selection.targetId, ...selection.sourceIds].map((id) => servers.find((server) => server.id === id)!);
}

function latest(a: ServerConfig, b: ServerConfig): number {
  return new Date(b.lastSeen ?? b.createdAt).getTime() - new Date(a.lastSeen ?? a.createdAt).getTime()
    || b.id.localeCompare(a.id);
}

export async function listDuplicateGroups(steamId: string): Promise<DuplicateGroup[]> {
  assertAdmin(steamId);
  return duplicateGroups(await listServers());
}

function assertAdmin(steamId: string): void {
  if (!AppConfig.superAdminId || steamId !== AppConfig.superAdminId) throw new Error('FORBIDDEN');
}

export async function previewServerMerge(selection: MergeSelection, steamId: string): Promise<MergePreview> {
  assertAdmin(steamId);
  const servers = selected(selection, await listServers());
  const ids = servers.map((server) => server.id);
  const current = [...servers].sort(latest)[0];
  const mongo = getMongoCollections();
  const [affectedFavorites, statisticHours] = mongo ? await Promise.all([
    mongo.users.countDocuments({ pinnedServers: { $in: ids } }),
    mongo.serverStatistics.distinct('hourStart', { serverId: { $in: ids } }).then((hours) => hours.length),
  ]) : [0, 0];
  return { ...selection, currentAddress: `${current.ip}:${current.port}`, affectedFavorites, statisticHours };
}

export async function mergeServers(selection: MergeSelection, steamId: string): Promise<MergePreview> {
  assertAdmin(steamId);
  const mongo = getMongoCollections();
  const client = getMongoClient();
  if (!mongo || !client) throw new Error('MERGE_REQUIRES_MONGODB');
  const preview = await previewServerMerge(selection, steamId);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const documents = await mongo.servers.find({ id: { $in: [selection.targetId, ...selection.sourceIds] } }, { session }).toArray();
      const servers = selected(selection, documents as ServerConfig[]);
      const [target, ...sources] = servers;
      const current = [...servers].sort(latest)[0];
      const ids = servers.map((server) => server.id);
      const aliases = [...new Set(servers.flatMap((server) => [server.id, ...(server.alternateIds ?? [])]))]
        .filter((id) => id !== target.id);
      const conflicting = await mongo.servers.findOne({
        id: { $nin: ids }, $or: [{ id: { $in: aliases } }, { alternateIds: { $in: aliases } }],
      }, { session });
      if (conflicting) throw new Error('MERGE_ID_CONFLICT');
      let knownPlayers = target.knownPlayers;
      for (const source of sources) knownPlayers = mergeKnownPlayers(knownPlayers, source.knownPlayers ?? []);
      const merged: ServerConfig = {
        ...target, ...current, id: target.id, label: target.label,
        firstSeen: target.firstSeen ?? target.createdAt, createdAt: target.createdAt,
        alternateIds: aliases, catalogIdPinned: true, knownPlayers,
        blocked: servers.some((server) => server.blocked === true),
        connectorCredential: current.connectorCredential ?? target.connectorCredential,
        mapSourceId: current.mapUrl ? (current.mapSourceId ?? current.id) : (target.mapSourceId ?? target.id),
      };
      delete (merged as ServerConfig & { _id?: unknown })._id;
      if (!current.mapUrl) merged.mapUrl = target.mapUrl;

      const buckets = await mongo.serverStatistics.find({ serverId: { $in: ids } }, { session }).toArray();
      const mergedBuckets = mergeServerStatisticsBuckets(target.id, buckets as ServerStatisticsBucket[]);
      const users = await mongo.users.find({ pinnedServers: { $in: ids } }, { session }).toArray();
      await mongo.servers.deleteMany({ id: { $in: selection.sourceIds } }, { session });
      await mongo.servers.replaceOne({ id: target.id }, merged, { session });
      await mongo.serverStatistics.deleteMany({ serverId: { $in: ids } }, { session });
      if (mergedBuckets.length) await mongo.serverStatistics.insertMany(mergedBuckets, { session });
      for (const user of users) {
        const pins = [...new Set((user.pinnedServers ?? []).map((id) => ids.includes(id) ? target.id : id))];
        await mongo.users.updateOne({ id: user.id }, { $set: { pinnedServers: pins } }, { session });
      }
    });
  } finally { await session.endSession(); }
  for (const id of selection.sourceIds) {
    clearServerLiveStatusCacheEntry(id);
    closeGameConnectorSession(id);
  }
  clearServerLiveStatusCacheEntry(selection.targetId);
  defaultLogger.log('Server catalog records merged:', {
    targetId: selection.targetId, sourceIds: selection.sourceIds, adminSteamId: steamId,
  });
  return preview;
}

export async function resolveServerId(id: string): Promise<string | undefined> {
  return (await findServerById(id))?.id;
}
