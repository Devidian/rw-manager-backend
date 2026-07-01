import { Request, Response } from 'express';
import typia from 'typia';
import type { GetServerConfigResponse } from '../dto/get-server-config-response.js';
import { prepareServerRoute, serverIdFromRequest, serverRouteError } from './server-route-context.js';
import { getCachedServerConfig } from '../service/server-plugin-data-service.js';

export async function getServerConfigHandler(req: Request, res: Response) {
  try {
    const serverId = serverIdFromRequest(req);
    if (serverId) await prepareServerRoute(req);
    const response: GetServerConfigResponse = {
      config: getCachedServerConfig(serverId),
    };
    return res.json(typia.assert<GetServerConfigResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status === 500 ? 400 : mapped.status).json({ error: mapped.error });
  }
}
