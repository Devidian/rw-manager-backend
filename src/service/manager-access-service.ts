import { cachedMasterServers } from './master-only-cache-service.js';
import { AppConfig } from '../utils/app-config.js';

export interface ManagerAccess {
  serverIds: string[];
  confirmedDenied: boolean;
  preserveExisting: boolean;
}

async function liveContact(queryUrl: string): Promise<string | undefined | null> {
  try {
    const response = await fetch(new URL('info', `${queryUrl.replace(/\/+$/, '')}/`).toString(), {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
    });
    if (!response.ok) return null;
    const value = (await response.json()) as { contact?: unknown };
    return typeof value.contact === 'string' ? value.contact : undefined;
  } catch {
    return null;
  }
}

/** A missing source is inconclusive; only a valid export or live contact check can revoke access. */
export async function managerAccess(
  steamId: string,
  previousServerIds: string[] = [],
  scanAllContacts = false,
): Promise<ManagerAccess> {
  const [{ listServers }, { getCachedPluginData }] = await Promise.all([
    import('../db/manager-store.js'), import('./plugin-data-cache-service.js'),
  ]);
  const stored = await listServers();
  const candidates = [...stored, ...cachedMasterServers()];
  const candidateIds = new Set(candidates.map((server) => server.id));
  const serverIds = new Set<string>();
  let uncertain = previousServerIds.some((id) => !candidateIds.has(id));
  let confirmedHistory = previousServerIds.length > 0;
  await Promise.all(candidates.map(async (server) => {
    const cached = getCachedPluginData(server.id);
    const playerlist = cached?.data['ozadminutils.playerlist'];
    const players = playerlist && typeof playerlist === 'object'
      ? (playerlist as { players?: unknown }).players : undefined;
    if (Array.isArray(players) && players.some((player) => player && typeof player === 'object'
      && ((player as { uid?: unknown; UID?: unknown }).uid === steamId
        || (player as { UID?: unknown }).UID === steamId))) serverIds.add(server.id);
    else if ('knownPlayers' in server && server.knownPlayers?.some((player) => player.uid === steamId)
      && !Array.isArray(players)) { uncertain = true; confirmedHistory = true; }

    const lastContact = server.info && typeof server.info === 'object'
      ? (server.info as { contact?: unknown }).contact : undefined;
    if (server.queryUrl && (scanAllContacts || lastContact === steamId || previousServerIds.includes(server.id))) {
      const contact = await liveContact(server.queryUrl);
      if (contact === steamId) serverIds.add(server.id);
      else if (contact === null && lastContact === steamId) { uncertain = true; confirmedHistory = true; }
      else if (contact === null && previousServerIds.includes(server.id)) uncertain = true;
      if (previousServerIds.includes(server.id) && !Array.isArray(players) && contact !== steamId) uncertain = true;
    }
  }));
  return { serverIds: [...serverIds], confirmedDenied: steamId !== AppConfig.superAdminId &&
    candidates.length > 0 && serverIds.size === 0 && !uncertain,
    preserveExisting: steamId === AppConfig.superAdminId || uncertain && confirmedHistory };
}

export async function revokeManagerAccountIfDenied(steamId: string): Promise<boolean> {
  const { findUserBySteamId, deleteUserOnly } = await import('../db/manager-store.js');
  const access = await managerAccess(steamId);
  if (!access.confirmedDenied) return false;
  const user = await findUserBySteamId(steamId);
  return user ? deleteUserOnly(user.id) : false;
}

/** Reconcile confirmed losses after source refresh, including idle sessions. */
export async function reconcileManagerAccounts(): Promise<number> {
  const { listUsers, deleteUserOnly } = await import('../db/manager-store.js');
  let removed = 0;
  for (const user of await listUsers()) {
    if (user.steamId === AppConfig.superAdminId) continue;
    const access = await managerAccess(user.steamId ?? '', user.managerServerIds);
    if (!access.confirmedDenied) continue;
    if (await deleteUserOnly(user.id)) removed += 1;
  }
  return removed;
}
