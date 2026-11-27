import type { ServerConfig } from '../interfaces/server-config.js';
import { findServerById, listServers } from '../db/manager-store.js';
import { getCachedPluginData } from './plugin-data-cache-service.js';
import { parseNativeAdminUtilsInfo } from './native-admin-utils-info.js';
import { stableUid } from './player-identity-service.js';
import { maskPublicSteamIds } from '../utils/mask-public-steam-ids.js';

interface ProjectionContext { userSteamId?: string; guest: boolean; serverId?: string; global?: boolean }

interface ProjectionReads {
  findServer: typeof findServerById;
  listServers: typeof listServers;
}

const directReads: ProjectionReads = { findServer: findServerById, listServers };

/** Share storage reads only for one map publication. Every viewer is still projected independently. */
export function mapPublicationProjection(serverId: string) {
  let server: ReturnType<typeof findServerById> | undefined;
  let servers: ReturnType<typeof listServers> | undefined;
  const reads: ProjectionReads = {
    findServer: (id) => id === serverId ? (server ??= findServerById(serverId)) : findServerById(id),
    listServers: () => (servers ??= listServers()),
  };
  return (value: unknown, viewer: Pick<ProjectionContext, 'userSteamId' | 'guest'>) =>
    projectPlayerDataWithReads(value, { ...viewer, serverId }, reads);
}

function adminOf(server: ServerConfig, steamId: string): boolean {
  if (server.info && typeof server.info === 'object' &&
      (server.info as { contact?: unknown }).contact === steamId) return true;
  const entry = getCachedPluginData(server.id);
  const native = entry && parseNativeAdminUtilsInfo(entry.data['ozadminutils.info']);
  return native?.admins.includes(steamId) === true;
}

/** Applied to REST and both client WebSocket channels before serialization. */
export async function projectPlayerData(value: unknown, context: ProjectionContext): Promise<unknown> {
  return projectPlayerDataWithReads(value, context, directReads);
}

async function projectPlayerDataWithReads(
  value: unknown, context: ProjectionContext, reads: ProjectionReads,
): Promise<unknown> {
  if (value && typeof value === 'object' && Array.isArray((value as { servers?: unknown }).servers)) {
    const root = value as { servers: Array<Record<string, unknown>> };
    return { ...root, servers: await Promise.all(root.servers.map((item) =>
      projectPlayerDataWithReads(item, { ...context, serverId: String(item.id) }, reads))) };
  }

  const server = context.serverId ? await reads.findServer(context.serverId) : undefined;
  const viewerUid = context.userSteamId;
  const member = !!viewerUid && server?.knownPlayers?.some((player) => player.uid === viewerUid) === true;
  const serverAdmin = !!viewerUid && !!server && adminOf(server, viewerUid);
  const knownToAdmin = new Set<string>();
  if (viewerUid) {
    for (const candidate of await reads.listServers()) {
      if (!adminOf(candidate, viewerUid)) continue;
      for (const player of candidate.knownPlayers ?? []) knownToAdmin.add(player.uid);
    }
  }
  const dbIdByUid = new Map((server?.knownPlayers ?? []).flatMap((player) =>
    typeof player.id === 'number' && Number.isSafeInteger(player.id) && player.id > 0
      ? [[player.uid, player.id] as const] : []));

  function walk(node: unknown, listKey?: string): unknown {
    if (Array.isArray(node)) return node.map((item) => walk(item, listKey))
      .filter((item) => item !== undefined);
    if (!node || typeof node !== 'object' || node instanceof Date) return node;
    const item = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, part] of Object.entries(item)) {
      if (key === 'playerMappingId') continue;
      if (key === 'knownPlayers' && !member) { result[key] = []; continue; }
      result[key] = walk(part, Array.isArray(part) ? key : undefined);
    }

    if (listKey === 'onlinePlayers' && !member && !serverAdmin) {
      delete result.platform;
      delete result.ping;
    }
    const uid = stableUid(item.uid ?? item.UID) ??
      (typeof item.id === 'string' && typeof item.state === 'string' && typeof item.x === 'number'
        ? stableUid(item.id) : undefined);
    const isPlayer = listKey === 'knownPlayers' || listKey === 'onlinePlayers' || listKey === 'players'
      || !!uid || 'uid' in item || 'UID' in item;
    if (isPlayer) {
      const canSeeSteam = !!uid && knownToAdmin.has(uid);
      if (!canSeeSteam) {
        delete result.uid;
        delete result.UID;
        delete result.steamid;
        delete result.steamId;
      }
      const dbId = typeof item.dbId === 'number' && Number.isSafeInteger(item.dbId) && item.dbId > 0
        ? item.dbId : uid ? dbIdByUid.get(uid) : undefined;
      if (dbId && context.serverId) result.id = `${context.serverId}:${dbId}`;
      else if (uid && item.id === uid) delete result.id;
    }
    if (Array.isArray(item.onlinePlayerUids)) {
      result.onlinePlayerIds = member && context.serverId
        ? item.onlinePlayerUids.flatMap((entry) => {
          const dbId = dbIdByUid.get(String(entry));
          return dbId ? [`${context.serverId}:${dbId}`] : [];
        }) : [];
      delete result.onlinePlayerUids;
    }
    if (!serverAdmin) {
      delete result.adminUid;
      if (typeof item.contact === 'string' && /^\d{17}$/.test(item.contact)) delete result.contact;
      delete result.Server_Admins;
      delete result.admins;
    }
    return result;
  }
  const projected = walk(value);
  return context.guest ? maskPublicSteamIds(projected) : projected;
}
