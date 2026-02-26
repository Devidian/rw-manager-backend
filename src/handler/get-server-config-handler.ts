import { Request, Response } from 'express';
import typia from 'typia';
import { getServerConfig } from '../service/server-config-service.js';
import type { GetServerConfigResponse } from '../dto/get-server-config-response.js';

export function getServerConfigHandler(_req: Request, res: Response) {
  try {
    const response: GetServerConfigResponse = { config: getServerConfig() };
    return res.json(typia.assert<GetServerConfigResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    return res.status(400).json({ error: message });
  }
}
