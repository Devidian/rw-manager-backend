import { Request, Response } from 'express';
import typia from 'typia';
import type { GetAllPlayersResponse } from '../dto/get-all-players-response.js';
import { prepareServerRoute, serverIdFromRequest, serverRouteError } from './server-route-context.js';
import { getCachedServerPlayers } from '../service/server-plugin-data-service.js';

export async function getAllPlayersHandler(req: Request, res: Response) {
  try {
    const serverId = serverIdFromRequest(req);
    if (serverId) await prepareServerRoute(req);
    const response: GetAllPlayersResponse = {
      items: getCachedServerPlayers(serverId),
    };
    return res.json(typia.assert<GetAllPlayersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status === 500 ? 400 : mapped.status).json({ error: mapped.error });
  }
}
