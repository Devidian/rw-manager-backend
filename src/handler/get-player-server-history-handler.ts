import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetPlayerServerHistoryResponse } from '../dto/get-player-server-history-response.js';
import { listServers as listVisibleServers } from '../service/storage-service.js';
import { listServers as listStoredServers } from '../db/manager-store.js';

/** Profile history reads durable server records; it never contacts a game server. */
export async function getPlayerServerHistoryHandler(req: Request, res: Response) {
  const uid = typeof req.params.uid === 'string' ? req.params.uid.trim() : undefined;
  if (!uid || uid.length > 128) return res.status(400).json({ error: 'INVALID_UID' });
  try {
    const [visible, stored] = await Promise.all([listVisibleServers({}), listStoredServers()]);
    const visibleIds = new Set(visible.map((server) => server.id));
    const items = stored
      .filter((server) => visibleIds.has(server.id) && server.public === true && !server.userId)
      .flatMap((server) => {
        const player = server.knownPlayers?.find((entry) => entry.uid === uid);
        if (!player) return [];
        return [{
          serverId: server.id,
          label: server.label,
          status: server.status ?? 'unknown' as const,
          ...(player.name ? { name: player.name } : {}),
          ...(typeof player.playtime === 'number' ? { playtime: player.playtime } : {}),
          ...(typeof player.firstseen === 'number' ? { firstseen: player.firstseen } : {}),
          ...(typeof player.lastseen === 'number' ? { lastseen: player.lastseen } : {}),
        }];
      })
      .sort((a, b) => (b.lastseen ?? 0) - (a.lastseen ?? 0) || a.label.localeCompare(b.label));
    return res.json(typia.assert<GetPlayerServerHistoryResponse>({ uid, items }));
  } catch {
    return res.status(500).json({ error: 'PLAYER_HISTORY_UNAVAILABLE' });
  }
}
