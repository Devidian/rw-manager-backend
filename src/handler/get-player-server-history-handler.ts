import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetPlayerServerHistoryResponse } from '../dto/get-player-server-history-response.js';
import { listServers as listVisibleServers } from '../service/storage-service.js';
import { findServerById, listServers as listStoredServers } from '../db/manager-store.js';
import { getCachedServerAdminList } from '../service/server-plugin-data-service.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';

/** Public player identity is a server ID and the server-local DBID. */
export async function getPlayerServerHistoryHandler(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
  const separator = id.lastIndexOf(':');
  const dbId = Number(id.slice(separator + 1));
  if (separator < 1 || !Number.isSafeInteger(dbId) || dbId <= 0) {
    return res.status(400).json({ error: 'INVALID_PLAYER_ID' });
  }
  try {
    const source = await findServerById(id.slice(0, separator));
    const player = source?.knownPlayers?.find((entry) => entry.id === dbId);
    if (!player) return res.status(404).json({ error: 'PLAYER_NOT_FOUND' });
    const user = await getUserFromBearerToken(req.header('authorization'));
    if (!user?.steamVerifiedAt || !user.steamId) return res.status(403).json({ error: 'FORBIDDEN' });
    const stored = await listStoredServers();
    const adminKnowsPlayer = stored.some((server) => {
      const admin = getCachedServerAdminList(server.id).includes(user.steamId!) ||
        (server.info && typeof server.info === 'object' &&
          (server.info as { contact?: unknown }).contact === user.steamId);
      return admin && server.knownPlayers?.some((entry) => entry.uid === player.uid);
    });
    if (player.uid !== user.steamId && !adminKnowsPlayer) return res.status(403).json({ error: 'FORBIDDEN' });
    const visible = await listVisibleServers({});
    const visibleIds = new Set(visible.filter((server) => !server.masterOnly).map((server) => server.id));
    const items = stored
      .filter((server) => visibleIds.has(server.id) && server.public === true && !server.userId)
      .flatMap((server) => {
        const known = server.knownPlayers?.find((entry) => entry.uid === player.uid);
        if (!known) return [];
        return [{
          serverId: server.id,
          label: server.label,
          status: server.status ?? 'unknown' as const,
          ...(known.name ? { name: known.name } : {}),
          ...(typeof known.playtime === 'number' ? { playtime: known.playtime } : {}),
          ...(typeof known.firstseen === 'number' ? { firstseen: known.firstseen } : {}),
          ...(typeof known.lastseen === 'number' ? { lastseen: known.lastseen } : {}),
        }];
      })
      .sort((a, b) => (b.lastseen ?? 0) - (a.lastseen ?? 0) || a.label.localeCompare(b.label));
    return res.json(typia.assert<GetPlayerServerHistoryResponse>({ id, items }));
  } catch {
    return res.status(500).json({ error: 'PLAYER_HISTORY_UNAVAILABLE' });
  }
}
