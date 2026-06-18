import type { Request, Response } from 'express';
import typia from 'typia';
import type { GetMapPlayersResponse } from '../dto/get-map-players-response.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';
import { getMapPlayers } from '../service/map-layer-service.js';
import { AppConfig } from '../utils/app-config.js';

export async function getMapPlayersHandler(req: Request, res: Response) {
  try {
    const user = getUserFromBearerToken(req.header('authorization'));
    const items = await getMapPlayers(user?.role === 'admin');
    const response: GetMapPlayersResponse = {
      schemaVersion: 1,
      available: items !== null,
      recentPlayerDays: AppConfig.mapRecentPlayerDays,
      items: items ?? [],
    };
    res.setHeader('Cache-Control', 'no-store');
    return res.json(typia.assert<GetMapPlayersResponse>(response));
  } catch (error) {
    return res.status(500).json({ error: message(error) });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'UNKNOWN_ERROR';
}
