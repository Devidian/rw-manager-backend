import { NextFunction, Request, Response, Router } from 'express';
import { randomBytes } from 'node:crypto';
import {
  createUser,
  db,
  findUserBySteamId,
  findUserByUsername,
  setUserSteamId,
  toPublicUser,
} from '@db/json.js';
import { AppConfig } from '@utils/app-config.js';
import { requireAuth } from '../../guards/require-auth.js';
import { createAuthToken, passport } from '../../utils/index.js';
import { normalizeSteamId } from '@utils/normalizeSteamId.js';
import { registerLocalUserAsync } from './registerLocalUserAsync.js';
import { UserRole, UserState } from '@interfaces/app-user.js';

const router = Router();

export const MAX_UINT64 = 18446744073709551615n;

router.post('/register', registerLocalUserAsync);

function loginUser(req: Request, res: Response, next: NextFunction) {
  passport.authenticate(
    'local',
    (
      error: Error | null,
      user:
        | {
            id: string;
            username: string;
            email: string;
            state: UserState;
            role: UserRole;
            steamId?: string;
            createdAt: Date;
          }
        | false,
    ) => {
      if (error)
        return res.status(500).json({ error: 'authentication failed' });
      if (!user)
        return res.status(401).json({ error: 'invalid username or password' });
      const token = createAuthToken(user.id);
      return res.json({ user, token });
    },
  )(req, res, next);
}

router.post('/login', );

router.post('/steam-connect', requireAuth, async (req, res) => {
  const openIdClaimedId =
    typeof req.body?.openId === 'string'
      ? req.body.openId.trim()
      : typeof req.body?.['openid.claimed_id'] === 'string'
        ? req.body['openid.claimed_id'].trim()
        : typeof req.body?.['openid.identity'] === 'string'
          ? req.body['openid.identity'].trim()
          : '';
  if (!openIdClaimedId) {
    return res.status(400).json({ error: 'openId is required' });
  }

  const steamIdMatch = openIdClaimedId.match(/\/openid\/id\/(\d+)(?:\/)?$/);
  const normalizedSteamId = normalizeSteamId(steamIdMatch?.[1]);
  if (!normalizedSteamId) {
    return res.status(400).json({ error: 'openId is invalid' });
  }

  const existingSteamUser = findUserBySteamId(normalizedSteamId);
  let publicUser: Awaited<ReturnType<typeof toPublicUser>>;
  if (!existingSteamUser) {
    const updatedUser = await setUserSteamId(
      (req as any).user.id,
      normalizedSteamId,
    );

    if (!updatedUser) {
      return res.status(404).json({ error: 'user not found' });
    }
    publicUser = toPublicUser(updatedUser as any);
  } else {
    publicUser = toPublicUser(existingSteamUser);
  }

  const token = createAuthToken(publicUser.id);
  return res.json({ user: publicUser, token });
});

router.post('/steam-disconnect', requireAuth, async (req, res) => {
  const updatedUser = await setUserSteamId((req as any).user.id, '');

  if (!updatedUser) {
    return res.status(404).json({ error: 'user not found' });
  }
  const token = createAuthToken(updatedUser.id);
  return res.json({ user: updatedUser, token });
});

router.post('/steam', async (req, res) => {
  const openIdClaimedId =
    typeof req.body?.openId === 'string'
      ? req.body.openId.trim()
      : typeof req.body?.['openid.claimed_id'] === 'string'
        ? req.body['openid.claimed_id'].trim()
        : typeof req.body?.['openid.identity'] === 'string'
          ? req.body['openid.identity'].trim()
          : '';
  if (!openIdClaimedId) {
    return res.status(400).json({ error: 'openId is required' });
  }

  const steamIdMatch = openIdClaimedId.match(/\/openid\/id\/(\d+)(?:\/)?$/);
  const normalizedSteamId = normalizeSteamId(steamIdMatch?.[1]);
  if (!normalizedSteamId) {
    return res.status(400).json({ error: 'openId is invalid' });
  }

  const existingUser = findUserBySteamId(normalizedSteamId);
  let publicUser: Awaited<ReturnType<typeof createUser>>;
  if (!existingUser) {
    const role =
      normalizedSteamId === AppConfig.superAdminId
        ? 'admin'
        : AppConfig.defaultUserRole;
    const state = role === 'admin' ? 'verified' : 'new';
    const baseUsername = `steam_${normalizedSteamId}`;
    let username = baseUsername;
    for (let i = 1; findUserByUsername(username); i += 1) {
      username = `${baseUsername}_${i}`;
    }
    const email = `${username}@steam.local`;
    const password = randomBytes(24).toString('hex');
    publicUser = await createUser(
      username,
      email,
      password,
      normalizedSteamId,
      role,
      state,
    );
  } else {
    publicUser = toPublicUser(existingUser);
  }

  const token = createAuthToken(publicUser.id);
  return res.json({ user: publicUser, token });
});

router.get('/validate', requireAuth, (req, res) => {
  return res.json({ user: (req as any).user });
});

router.patch('/self', requireAuth, async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const body = req.body ?? {};
  if (Object.keys(body).some((key) => key !== 'name')) {
    return res.status(400).json({ error: 'only name is allowed' });
  }

  const { name } = body as { name?: unknown };
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const nextName = name.trim();

  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  const existing = findUserByUsername(nextName);
  if (existing && existing.id !== user.id) {
    return res.status(409).json({ error: 'username already exists' });
  }

  user.username = nextName;
  await db.write();
  return res.json({ user: toPublicUser(user) });
});

router.delete('/self', requireAuth, async (req, res) => {
  const userId = (req as any).user?.id as string | undefined;
  if (!userId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    return res.status(404).json({ error: 'user not found' });
  }

  db.data.users = db.data.users.filter((entry) => entry.id !== userId);
  db.data.servers = db.data.servers.filter((entry) => entry.userId !== userId);
  await db.write();
  return res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  return res.json({ ok: true });
});

export default router;
