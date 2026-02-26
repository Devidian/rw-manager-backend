import { Request, Response } from 'express';
import typia from 'typia';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { disconnectSteam } from '../service/auth-service.js';

export async function steamDisconnectHandler(
  req: Request,
  res: Response,
) {
  try {
    const userId = (req as RequestWithUser).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const response = typia.assert<AuthUserTokenResponse>(
      await disconnectSteam(userId),
    );
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
