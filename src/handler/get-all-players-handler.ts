import { Request, Response } from 'express';
import typia from 'typia';
import { getAllPlayers } from '../service/player-service.js';
import type { GetAllPlayersResponse } from '../dto/get-all-players-response.js';

export function getAllPlayersHandler(_req: Request, res: Response) {
  try {
    const response: GetAllPlayersResponse = { items: getAllPlayers() };
    return res.json(typia.assert<GetAllPlayersResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
