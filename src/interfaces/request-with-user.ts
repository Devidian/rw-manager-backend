import type { Request } from 'express';
import type { PrivateUser } from './app-user.js';

export interface RequestWithUser extends Request {
  user?: PrivateUser;
}
