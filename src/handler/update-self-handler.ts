import { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { UpdateSelfRequest } from '../dto/update-self-request.js';
import type { ValidateUserResponse } from '../dto/validate-user-response.js';
import { renameSelf } from '../service/auth-service.js';

export async function updateSelfHandler(req: Request, res: Response) {
  try {
    const userId = (req as RequestWithUser).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    const body = req.body as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== 'name')) {
      return res.status(400).json({ error: 'only name is allowed' });
    }

    const payload = typia.assert<UpdateSelfRequest>(req.body);
    const response = typia.assert<ValidateUserResponse>(
      await renameSelf(userId, payload.name),
    );
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'NAME_REQUIRED') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (message === 'USERNAME_EXISTS') {
      return res.status(409).json({ error: 'username already exists' });
    }
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
