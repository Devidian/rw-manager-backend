import type { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { GetPlayerMapHistoryResponse } from '../dto/get-player-map-history-response.js';
import { getPlayerMapHistory } from '../service/player-map-history-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getPlayerMapHistoryHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    const steamId = (req as RequestWithUser).user?.steamId;
    if (!server || !steamId) return res.status(403).json({ error: 'player map unavailable' });
    const history = await getPlayerMapHistory(server, steamId);
    const response: GetPlayerMapHistoryResponse = {
      schemaVersion: 1,
      available: history !== null,
      sectorSizeChunks: 256,
      items: history?.items ?? [],
    };
    res.setHeader('Cache-Control', 'private, max-age=60');
    return res.json(typia.assert<GetPlayerMapHistoryResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
