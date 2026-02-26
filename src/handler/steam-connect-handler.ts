import { Request, Response } from 'express';
import typia from 'typia';
import type { SteamAuthRequest } from '../dto/steam-auth-request.js';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { connectSteam } from '../service/auth-service.js';

export async function steamConnectHandler(req: Request, res: Response) {
  try {
    const body = typia.assert<SteamAuthRequest>(req.body);
    const userId = (req as RequestWithUser).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const response = typia.assert<AuthUserTokenResponse>(
      await connectSteam(userId, body),
    );
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'OPEN_ID_REQUIRED') {
      return res.status(400).json({ error: 'openId is required' });
    }
    if (message === 'OPEN_ID_INVALID') {
      return res.status(400).json({ error: 'openId is invalid' });
    }
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
