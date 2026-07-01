import type { Request, Response } from 'express';
import typia from 'typia';
import type {
  GetMapGpsGlobalMarkersResponse,
} from '../dto/get-map-gps-global-markers-response.js';
import { getMapGpsGlobalMarkers } from '../service/map-layer-service.js';
import { prepareServerRoute, serverRouteError } from './server-route-context.js';

export async function getMapGpsGlobalMarkersHandler(req: Request, res: Response) {
  try {
    const server = await prepareServerRoute(req);
    const items = server
      ? await getMapGpsGlobalMarkers(undefined, server.id)
      : await getMapGpsGlobalMarkers();
    const response: GetMapGpsGlobalMarkersResponse = {
      schemaVersion: 1,
      available: items !== null,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapGpsGlobalMarkersResponse>(response));
  } catch (error) {
    const mapped = serverRouteError(error);
    return res.status(mapped.status).json({ error: mapped.error });
  }
}
