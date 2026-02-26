import { Request, Response } from 'express';
import typia from 'typia';
import { getServerName } from '../service/server-config-service.js';
import type { GetServerNameResponse } from '../dto/get-server-name-response.js';

export function getServerNameHandler(_req: Request, res: Response) {
  try {
    const response: GetServerNameResponse = { name: getServerName() };
    return res.json(typia.assert<GetServerNameResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
