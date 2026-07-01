import { Request, Response } from 'express';
import typia from 'typia';
import type { GetServerAdminListResponse } from '../dto/get-server-admin-list-response.js';
import { prepareServerRoute, serverIdFromRequest, serverRouteError } from './server-route-context.js';
import { getCachedServerAdminList } from '../service/server-plugin-data-service.js';

export async function getServerAdminListHandler(req: Request, res: Response) {
  try {
    const serverId = serverIdFromRequest(req);
    if (serverId) await prepareServerRoute(req);
    const response: GetServerAdminListResponse = {
      admins: getCachedServerAdminList(serverId),
    };
    return res.json(typia.assert<GetServerAdminListResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status === 500 ? 400 : mapped.status).json({ error: mapped.error });
  }
}
