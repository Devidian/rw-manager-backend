import { Request, Response } from 'express';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { OkResponse } from '../dto/ok-response.js';
import { deleteServer } from '../service/storage-service.js';

export async function deleteServerHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const serverId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];
    await deleteServer(serverId, {
      userId: request.user?.id,
      userSteamId: request.user?.steamId,
    });
    const response: OkResponse = { ok: true };
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'SERVER_NOT_FOUND') {
      return res.status(404).json({ error: 'server not found' });
    }
    return res.status(400).json({ error: message });
  }
}
