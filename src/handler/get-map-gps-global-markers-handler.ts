import type { Request, Response } from 'express';
import typia from 'typia';
import type {
  GetMapGpsGlobalMarkersResponse,
} from '../dto/get-map-gps-global-markers-response.js';
import { getMapGpsGlobalMarkers } from '../service/map-layer-service.js';

export async function getMapGpsGlobalMarkersHandler(_req: Request, res: Response) {
  try {
    const items = await getMapGpsGlobalMarkers();
    const response: GetMapGpsGlobalMarkersResponse = {
      schemaVersion: 1,
      available: items !== null,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapGpsGlobalMarkersResponse>(response));
  } catch (error) {
    return res.status(500).json({ error: message(error) });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
