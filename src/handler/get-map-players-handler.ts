import { requestMapLayerAccess } from './map-layer-access.js';
import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapPlayersResponse } from '../dto/get-map-players-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { getMapPlayers } from '../service/map-layer-service.js';
import { AppConfig } from '../utils/app-config.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapPlayersHandler(req: Request, res: Response) {
  try {
    const user = (req as RequestWithUser).user;
    const server = await prepareServerRoute(req, {
      pluginDataMaximumAgeMs: AppConfig.mapPlayerLayerCacheTtlMs,
    });
    if (!requestMapLayerAccess(user, server?.id).players) {
      return res.status(403).json({ error: 'map consent required' });
    }
    const items = server
      ? await getMapPlayers(true, undefined, new Date(), server.id)
      : await getMapPlayers(true);
    const response: GetMapPlayersResponse = {
      schemaVersion: 1,
      available: items !== null,
      recentPlayerDays: AppConfig.mapRecentPlayerDays,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapPlayersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
