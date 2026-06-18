import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapClaimsResponse } from '../dto/get-map-claims-response.js';
import { getMapClaims } from '../service/map-layer-service.js';

export async function getMapClaimsHandler(_req: Request, res: Response) {
  try {
    const items = await getMapClaims();
    const response: GetMapClaimsResponse = {
      schemaVersion: 1,
      available: items !== null,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapClaimsResponse>(response));
  } catch (error) {
    return res.status(500).json({ error: message(error) });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
