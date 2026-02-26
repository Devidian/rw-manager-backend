import { Request, Response } from 'express';
import { findUserByUsername, findUserBySteamId, createUser } from '../../../db/json.js';
import { normalizeSteamId } from '../../../utils/normalizeSteamId.js';
import { createAuthToken } from '../../utils/auth.js';

export async function registerLocalUserAsync(req: Request, res: Response) {
  const { username, email, password, steamId } = req.body ?? {};
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'email is invalid' });
  }

  const resolvedUsername = typeof username === 'string' && username.trim()
    ? username.trim()
    : normalizedEmail;

  if (findUserByUsername(resolvedUsername)) {
    return res.status(409).json({ error: 'username already exists' });
  }

  let normalizedSteamId: string | undefined;
  if (steamId !== undefined) {
    const parsedSteamId = normalizeSteamId(steamId);
    if (!parsedSteamId) {
      return res
        .status(400)
        .json({ error: 'steamId must be a valid uint64 string' });
    }
    normalizedSteamId = parsedSteamId;
  }
  if (normalizedSteamId && findUserBySteamId(normalizedSteamId)) {
    return res.status(409).json({ error: 'steamId already exists' });
  }

  const user = await createUser(
    resolvedUsername,
    normalizedEmail,
    password,
    normalizedSteamId
  );
  const token = createAuthToken(user.id);
  return res.status(201).json({ user, token });
}
