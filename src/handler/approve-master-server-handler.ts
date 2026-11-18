import type { Request, Response } from 'express';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { approveMasterServer, MasterServerApprovalError } from '../service/master-server-approval-service.js';
import { defaultLogger } from '../utils/logger.js';

export async function approveMasterServerHandler(req: Request, res: Response) {
  const user = (req as RequestWithUser).user;
  if (!user?.steamVerifiedAt || !user.steamId) {
    return res.status(403).json({ error: 'VERIFIED_STEAM_REQUIRED' });
  }
  const id = req.params.id;
  if (typeof id !== 'string') return res.status(400).json({ error: 'INVALID_SERVER_ID' });

  try {
    return res.status(201).json({ server: await approveMasterServer(id, user.steamId) });
  } catch (error) {
    if (error instanceof MasterServerApprovalError) {
      return res.status(error.status).json({ error: error.code });
    }
    defaultLogger.warn('Master server approval failed', { serverId: id });
    return res.status(500).json({ error: 'SERVER_APPROVAL_FAILED' });
  }
}
