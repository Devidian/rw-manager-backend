import { requestMapLayerAccess } from './map-layer-access.js';
import { restrictMapLayerCapabilities } from '../service/map-layer-access.js';
import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapLayerCapabilitiesResponse } from '../dto/get-map-layer-capabilities-response.js';
import { getMapLayerCapabilities } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';

export async function getMapLayerCapabilitiesHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    res.setHeader('Cache-Control', 'no-store');
    const capabilities = await getMapLayerCapabilities(undefined, server?.id);
    const user = await getUserFromBearerToken(req.header('authorization'));
    return res.json(typia.assert<GetMapLayerCapabilitiesResponse>(
      restrictMapLayerCapabilities(capabilities, requestMapLayerAccess(user, server?.id)),
    ));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
