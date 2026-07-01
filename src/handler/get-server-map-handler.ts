import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import { getServerMap } from '../service/map-service.js';
import { getStoredServerMap } from '../service/server-map-service.js';
import { serverIdFromRequest, serverRouteError } from './server-route-context.js';

export async function getServerMapHandler(req: Request, res: Response) {
  try {
    const serverId = serverIdFromRequest(req);
    const response = serverId ? await getStoredServerMap(serverId) : await getServerMap();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetServerMapResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
