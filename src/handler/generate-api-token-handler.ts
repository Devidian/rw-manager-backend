import { Request, Response } from 'express';
import typia from 'typia';
import type { ApiTokenResponse } from '../dto/api-token-response.js';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import { generateApiToken } from '../service/auth-service.js';

export async function generateApiTokenHandler(req: Request, res: Response) {
  try {
    const userId = (req as RequestWithUser).user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const response: ApiTokenResponse = {
      apiToken: await generateApiToken(userId),
    };
    return res.json(typia.assert<ApiTokenResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'USER_NOT_FOUND') {
      return res.status(404).json({ error: 'user not found' });
    }
    return res.status(400).json({ error: message });
  }
}
