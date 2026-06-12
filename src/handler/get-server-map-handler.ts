import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetServerMapResponse } from '../dto/get-server-map-response.js';
import { getServerMap } from '../service/map-service.js';

export async function getServerMapHandler(_req: Request, res: Response) {
  try {
    const response = await getServerMap();
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetServerMapResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(500).json({ error: message });
  }
}
