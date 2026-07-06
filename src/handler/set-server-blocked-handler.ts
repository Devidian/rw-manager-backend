import { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { ServerResponse } from '../dto/server-response.js';
import type { SetServerBlockedRequest } from '../dto/set-server-blocked-request.js';
import { setServerBlocked } from '../service/storage-service.js';

export async function setServerBlockedHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const serverId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];
    const body = typia.assert<SetServerBlockedRequest>(request.body ?? {});
    const server = await setServerBlocked(serverId, body.blocked, request.user?.steamId);
    const response = typia.assert<ServerResponse>({ server });
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'FORBIDDEN') return res.status(403).json({ error: 'forbidden' });
    if (message === 'SERVER_NOT_FOUND') return res.status(404).json({ error: 'server not found' });
    return res.status(400).json({ error: message });
  }
}
