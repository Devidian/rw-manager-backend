import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapPlayersResponse } from '../dto/get-map-players-response.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';
import { getMapPlayers } from '../service/map-layer-service.js';
import { AppConfig } from '../utils/app-config.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapPlayersHandler(req: Request, res: Response) {
  try {
    const user = await getUserFromBearerToken(req.header('authorization'));
    const server = await prepareServerRoute(req, {
      pluginDataMaximumAgeMs: AppConfig.mapPlayerLayerCacheTtlMs,
    });
    const items = server
      ? await getMapPlayers(user?.role === 'admin', undefined, new Date(), server.id)
      : await getMapPlayers(user?.role === 'admin');
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
