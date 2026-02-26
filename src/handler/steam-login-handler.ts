import { Request, Response } from 'express';
import typia from 'typia';
import type { SteamAuthRequest } from '../dto/steam-auth-request.js';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import { steamSignIn } from '../service/auth-service.js';

export async function steamLoginHandler(req: Request, res: Response) {
  try {
    const body = typia.assert<SteamAuthRequest>(req.body);
    const response = typia.assert<AuthUserTokenResponse>(await steamSignIn(body));
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'OPEN_ID_REQUIRED') {
      return res.status(400).json({ error: 'openId is required' });
    }
    if (message === 'OPEN_ID_INVALID') {
      return res.status(400).json({ error: 'openId is invalid' });
    }
    return res.status(400).json({ error: message });
  }
}
