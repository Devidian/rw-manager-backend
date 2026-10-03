import type { Request, Response } from 'express';
import typia from 'typia';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import type { ValidateUserResponse } from '../dto/validate-user-response.js';
import { toPrivateUser, updateUser } from '../db/manager-store.js';
import { mapPrivateUserToDto } from '../mapper/user-mapper.js';

const DEFAULT_CHANNELS = ['global', 'web'];
const CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function updateIntercomChannelsHandler(req: Request, res: Response) {
  const userId = (req as RequestWithUser).user?.id;
  if (!userId) return res.status(401).json({ error: 'unauthorized' });
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || Object.keys(body).length !== 1 || !Array.isArray(body.channels)
    || body.channels.length > 20 || body.channels.some((value) => typeof value !== 'string')) {
    return res.status(400).json({ error: 'invalid channels' });
  }
  const channels = [...new Set([...DEFAULT_CHANNELS, ...body.channels.map((value: string) => value.trim().toLowerCase())])];
  if (channels.some((value) => !CHANNEL_PATTERN.test(value))) {
    return res.status(400).json({ error: 'invalid channels' });
  }
  const updated = await updateUser(userId, { intercomChannels: channels });
  if (!updated) return res.status(404).json({ error: 'user not found' });
  const response: ValidateUserResponse = { user: mapPrivateUserToDto(toPrivateUser(updated)) };
  return res.json(typia.assert<ValidateUserResponse>(response));
}
