import { Request, Response } from 'express';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { OkResponse } from '../dto/ok-response.js';
import { deleteSelf } from '../service/auth-service.js';

export async function deleteSelfHandler(req: Request, res: Response) {
  try {
    const userId = (req as RequestWithUser).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    await deleteSelf(userId);
    const response: OkResponse = { ok: true };
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
