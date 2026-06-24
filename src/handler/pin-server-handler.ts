import { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { UserResponse } from '../dto/user-response.js';
import { pinServer } from '../service/storage-service.js';

export async function pinServerHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const serverId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];
    const response: UserResponse = {
      user: await pinServer(serverId, {
        userId: request.user?.id,
        userSteamId: request.user?.steamId,
      }),
    };
    return res.json(typia.assert<UserResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'UNAUTHORIZED') {
      return res.status(401).json({ error: 'unauthorized' });
    }
    if (message === 'SERVER_NOT_FOUND') {
      return res.status(404).json({ error: 'server not found' });
    }
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
