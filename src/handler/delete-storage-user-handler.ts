import { Request, Response } from 'express';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { OkResponse } from '../dto/ok-response.js';
import { deleteStorageUser } from '../service/storage-service.js';

export async function deleteStorageUserHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const currentUserId = request.user?.id;
    if (!currentUserId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const userId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];

    await deleteStorageUser(
      request.user?.steamId ?? '',
      currentUserId,
      userId,
    );
    const response: OkResponse = { ok: true };
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (message === 'CANNOT_DELETE_SELF') {
      return res.status(409).json({ error: 'cannot delete self with this endpoint' });
    }
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
