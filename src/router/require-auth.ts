import { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../utils/app-config.js';
import { getUserFromBearerToken } from '../service/auth-token-service.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!AppConfig.enableAuth) return next();
  const user = await getUserFromBearerToken(req.header('authorization'));
  if (user) {
    (req as RequestWithUser).user = user;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
