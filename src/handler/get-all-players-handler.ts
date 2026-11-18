import { Request, Response } from 'express';
import typia from 'typia';
import type { GetAllPlayersResponse } from '../dto/get-all-players-response.js';
import { prepareServerRoute, serverIdFromRequest, serverRouteError } from './server-route-context.js';
import { getCachedServerPlayers } from '../service/server-plugin-data-service.js';
import { findServerById } from '../db/manager-store.js';
import type { DbPlayer } from '../interfaces/game-player.js';
import { observedPlayerFromValue } from '../service/observed-player-service.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';
import { AppConfig } from '../utils/app-config.js';

function addMissingPlayers(items: DbPlayer[], players: DbPlayer[] | undefined): void {
  const knownUids = new Set(items.map((player) => player.uid));
  for (const player of players ?? []) {
    if (!player.uid || knownUids.has(player.uid)) continue;
    knownUids.add(player.uid);
    items.push(player);
  }
}

export async function getAllPlayersHandler(req: Request, res: Response) {
  try {
    const serverId = serverIdFromRequest(req);
    if (serverId) await prepareServerRoute(req);
    const items = [...getCachedServerPlayers(serverId)];
    const server = serverId ? await findServerById(serverId) : undefined;
    const user = await getUserFromBearerToken(req.header('authorization'));
    // An empty export contains no player data. Show the participation empty state
    // to any verified Steam user instead of a misleading authorization error.
    if (user?.steamVerifiedAt && server && items.length === 0
      && !server.knownPlayers?.length && !server.onlinePlayers?.length) {
      return res.json(typia.assert<GetAllPlayersResponse>({ items: [] }));
    }
    const contact = server?.info && typeof server.info === 'object'
      ? (server.info as { contact?: unknown }).contact : undefined;
    const allowed = !!user?.steamVerifiedAt && !!server && (
      server.knownPlayers?.some((player) => player.uid === user.steamId)
      || contact === user.steamId
      || (!!AppConfig.superAdminId && AppConfig.superAdminId === user.steamId)
    );
    if (!allowed) {
      return res.status(403).json({ error: 'FORBIDDEN' });
    }
    addMissingPlayers(items, server?.knownPlayers);
    for (const livePlayer of Array.isArray(server?.onlinePlayers) ? server.onlinePlayers : []) {
      addMissingPlayers(items, [
        observedPlayerFromValue(livePlayer, server?.lastChecked ?? new Date()),
      ].filter((player): player is DbPlayer => player !== null));
    }
    const response: GetAllPlayersResponse = {
      items,
    };
    return res.json(typia.assert<GetAllPlayersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status === 500 ? 400 : mapped.status).json({ error: mapped.error });
  }
}
