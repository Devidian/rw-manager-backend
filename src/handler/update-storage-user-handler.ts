import { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { UpdateStorageUserRequest } from '../dto/update-storage-user-request.js';
import type { UserResponse } from '../dto/user-response.js';
import { patchUser } from '../service/storage-service.js';

export async function updateStorageUserHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const body = request.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== 'state' && key !== 'role')) {
      return res.status(400).json({ error: 'only state and role are allowed' });
    }
    const patch = typia.assert<UpdateStorageUserRequest>(request.body ?? {});
    const userId =
      typeof request.params.id === 'string'
        ? request.params.id
        : request.params.id[0];
    const user = await patchUser(
      request.user?.steamId ?? '',
      userId,
      patch,
    );
    const response = typia.assert<UserResponse>({ user });
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'forbidden' });
    }
    if (message === 'STATE_INVALID') {
      return res.status(400).json({ error: 'state is invalid' });
    }
    if (message === 'ROLE_INVALID') {
      return res.status(400).json({ error: 'role is invalid' });
    }
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
