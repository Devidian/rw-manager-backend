import { Request, Response } from 'express';
import typia from 'typia';
import type { LoginUserRequest } from '../dto/login-user-request.js';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import { loginUser } from '../service/auth-service.js';

export function loginUserHandler(req: Request, res: Response) {
  try {
    const body = typia.assert<LoginUserRequest>(req.body);
    const response = typia.assert<AuthUserTokenResponse>(loginUser(body));
    return res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'INVALID_USERNAME_OR_PASSWORD') {
      return res.status(401).json({ error: 'invalid username or password' });
    }
    return res.status(500).json({ error: 'authentication failed' });
  }
}
