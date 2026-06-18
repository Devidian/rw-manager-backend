import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapLayerCapabilitiesResponse } from '../dto/get-map-layer-capabilities-response.js';
import { getMapLayerCapabilities } from '../service/map-layer-service.js';

export async function getMapLayerCapabilitiesHandler(_req: Request, res: Response) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapLayerCapabilitiesResponse>(
      await getMapLayerCapabilities(),
    ));
  } catch (error) {
    return res.status(500).json({ error: message(error) });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
