import { Request, Response } from 'express';
import typia from 'typia';
import type { ServerLiveStatusResponse } from '../dto/server-live-status-response.js';
import { getServerLiveStatus } from '../service/server-live-status-service.js';

export async function getServerLiveStatusHandler(req: Request, res: Response) {
  try {
    const serverId =
      typeof req.params.id === 'string'
        ? req.params.id
        : req.params.id[0];
    const response = await getServerLiveStatus(serverId);
    return res.json(typia.assert<ServerLiveStatusResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'SERVER_NOT_FOUND') {
      return res.status(404).json({ error: 'server not found' });
    }
    if (message === 'QUERY_URL_MISSING') {
      return res.status(400).json({ error: 'queryUrl missing' });
    }
    return res.status(400).json({ error: message });
  }
}
