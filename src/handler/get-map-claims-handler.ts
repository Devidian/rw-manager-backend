import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapClaimsResponse } from '../dto/get-map-claims-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { getMapClaims } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapClaimsHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    const user = (req as RequestWithUser).user;
    const items = server
      ? await getMapClaims(undefined, server.id, user?.steamId)
      : await getMapClaims(undefined, undefined, user?.steamId);
    const response: GetMapClaimsResponse = {
      schemaVersion: 1,
      available: items !== null,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapClaimsResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
