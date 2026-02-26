import { NextFunction, Request, Response } from 'express';
import { AppConfig } from '../../utils/app-config.js';
import { getUserFromBearerToken } from '../utils/index.js';

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!AppConfig.enableAuth) return next();
  const user = getUserFromBearerToken(req.header('authorization'));
  if (user) {
    (req as any).user = user;
    return next();
  }
  return res.status(401).json({ error: 'Unauthorized' });
}
