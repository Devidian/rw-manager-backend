import { Request, Response } from 'express';
import typia from 'typia';
import type { RegisterLocalUserRequest } from '../dto/register-local-user-request.js';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import type { ErrorResponse } from '../dto/error-response.js';
import { registerLocalUser } from '../service/auth-service.js';

export async function registerUserHandler(req: Request, res: Response) {
  try {
    const body = typia.assert<RegisterLocalUserRequest>(req.body);
    const response = typia.assert<AuthUserTokenResponse>(
      await registerLocalUser(body),
    );
    return res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    let response: ErrorResponse;
    if (message === 'EMAIL_PASSWORD_REQUIRED') {
      response = { error: 'email and password are required' };
      return res.status(400).json(response);
    }
    if (message === 'EMAIL_INVALID') {
      response = { error: 'email is invalid' };
      return res.status(400).json(response);
    }
    if (message === 'STEAM_ID_INVALID') {
      response = { error: 'steamId must be a valid uint64 string' };
      return res.status(400).json(response);
    }
    if (message === 'USERNAME_EXISTS') {
      response = { error: 'username already exists' };
      return res.status(409).json(response);
    }
    if (message === 'STEAM_ID_EXISTS') {
      response = { error: 'steamId already exists' };
      return res.status(409).json(response);
    }
    response = { error: message };
    return res.status(400).json(response);
  }
}
