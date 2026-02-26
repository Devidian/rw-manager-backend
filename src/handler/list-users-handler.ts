import { Request, Response } from 'express';
import typia from 'typia';
import type { ListUsersResponse } from '../dto/list-users-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { listUsers } from '../service/storage-service.js';

export function listUsersHandler(req: Request, res: Response) {
  try {
    const request = req as RequestWithUser;
    const response = typia.assert<ListUsersResponse>({
      users: listUsers(request.user?.steamId ?? ''),
    });
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'FORBIDDEN') {
      return res.status(403).json({ error: 'forbidden' });
    }
    return res.status(400).json({ error: message });
  }
}
