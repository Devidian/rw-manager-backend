import { RequestHandler, Router } from 'express';
import { addServer, db, removeServer, updateServer } from '../../../db/json.js';
import { requireAuth } from '../../guards/require-auth.js';
import { AppConfig } from '../../../utils/app-config.js';
import type { PublicUser, UserRole, UserState } from '../../../interfaces/app-user.js';
import {
  canAdminServer,
  fetchBackendAdmins,
} from '../../utils/can-admin-server.js';

const router = Router();

const noAuth: RequestHandler = (_req, _res, next) => next();
const requireServerGetAuth =
  AppConfig.enableAuth && AppConfig.forceAuth ? requireAuth : noAuth;
const requireServerWriteAuth = AppConfig.enableAuth ? requireAuth : noAuth;

async function fetchQueryUrlName(
  queryUrl: unknown,
): Promise<string | undefined> {
  if (typeof queryUrl !== 'string' || !queryUrl.trim()) return undefined;
  try {
    const response = await fetch(queryUrl);
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { name?: unknown };
    const name = payload.name;
    return typeof name === 'string' && name.trim() ? name.trim() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBackendUrl(backendUrl: unknown): string | undefined {
  return typeof backendUrl === 'string' && backendUrl.trim()
    ? backendUrl.trim()
    : undefined;
}

function serializeQueryUrl(queryUrl: unknown): string {
  if (typeof queryUrl === 'string') return queryUrl;
  try {
    return JSON.stringify(queryUrl);
  } catch {
    return String(queryUrl);
  }
}

async function verifyServerNameMatch(
  backendUrl: string,
  queryUrlName: string,
): Promise<'ok' | 'bad_request' | 'failed'> {
  try {
    const configUrl = new URL('api/data/server/name', backendUrl).toString();
    const response = await fetch(configUrl);
    if (!response.ok) return 'failed';
    const payload = (await response.json()) as { name?: string };
    if (typeof payload.name !== 'string') return 'failed';
    return payload.name === queryUrlName ? 'ok' : 'bad_request';
  } catch {
    return 'failed';
  }
}

async function checkBackendForWrite(params: {
  backendUrl?: string;
  userSteamId?: string;
  queryUrlName?: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const { backendUrl, userSteamId, queryUrlName } = params;
  if (!AppConfig.enableAuth || !backendUrl) return { ok: true };

  const admins = await fetchBackendAdmins(backendUrl);
  if (!admins) {
    return { ok: false, status: 502, error: 'failed to verify backend admins' };
  }
  if (admins.length > 0 && (!userSteamId || !admins.includes(userSteamId))) {
    return { ok: false, status: 403, error: 'not a backend admin' };
  }

  if (!queryUrlName) {
    return {
      ok: false,
      status: 400,
      error:
        'queryUrl must return JSON with a non-empty name when backendUrl is provided',
    };
  }

  const nameMatch = await verifyServerNameMatch(backendUrl, queryUrlName);
  if (nameMatch === 'failed') {
    return { ok: false, status: 502, error: 'failed to verify backend config' };
  }
  if (nameMatch === 'bad_request') {
    return {
      ok: false,
      status: 400,
      error: 'queryUrl.name must match backend config Server_Name',
    };
  }
  return { ok: true };
}

router.get('/server', requireServerGetAuth, (req, res) => {
  const userId = (req as any).user?.id;
  const servers = AppConfig.enableAuth
    ? db.data.servers.filter((s) => s.public || (userId && s.userId === userId))
    : db.data.servers;
  res.json({ servers });
});

router.post('/server', requireServerWriteAuth, async (req, res) => {
  const { label, queryUrl, backendUrl, public: isPublic } = req.body ?? {};
  if (!label || !queryUrl) {
    return res.status(400).json({ error: 'label and queryUrl are required' });
  }

  const userId = (req as any).user?.id as string | undefined;
  const userSteamId = (req as any).user?.steamId as string | undefined;
  const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
  const queryUrlSerialized = serializeQueryUrl(queryUrl);
  const queryUrlName =
    AppConfig.enableAuth && normalizedBackendUrl
      ? await fetchQueryUrlName(queryUrl)
      : undefined;

  const duplicate = db.data.servers.some(
    (s) =>
      (AppConfig.enableAuth ? s.userId === userId : true) &&
      serializeQueryUrl(s.queryUrl) === queryUrlSerialized,
  );
  if (duplicate) {
    return res
      .status(409)
      .json({ error: 'queryUrl already exists for this user' });
  }

  const writeChecks = await checkBackendForWrite({
    backendUrl: normalizedBackendUrl,
    userSteamId,
    queryUrlName,
  });
  if (!writeChecks.ok) {
    return res.status(writeChecks.status).json({ error: writeChecks.error });
  }

  const server = await addServer(
    label,
    queryUrl,
    normalizedBackendUrl,
    userId,
    typeof isPublic === 'boolean' ? isPublic : false,
  );
  res.status(201).json({ server });
});

router.patch('/server/:id', requireServerWriteAuth, async (req, res) => {
  const current = db.data.servers.find((s) => s.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: 'server not found' });
  }

  const userId = (req as any).user?.id as string | undefined;
  const userSteamId = (req as any).user?.steamId as string | undefined;
  const isOwner = !AppConfig.enableAuth || current.userId === userId;
  if (!isOwner) {
    const isAdmin = await canAdminServer(current.backendUrl, userSteamId);
    if (!isAdmin) {
      return res.status(404).json({ error: 'server not found' });
    }
  }

  const patch = req.body ?? {};
  const nextQueryUrl =
    patch.queryUrl !== undefined ? patch.queryUrl : current.queryUrl;
  const nextBackendUrl =
    patch.backendUrl !== undefined
      ? normalizeBackendUrl(patch.backendUrl)
      : normalizeBackendUrl(current.backendUrl);
  const nextQueryUrlSerialized = serializeQueryUrl(nextQueryUrl);
  const duplicate = db.data.servers.some(
    (s) =>
      s.id !== current.id &&
      (AppConfig.enableAuth ? s.userId === current.userId : true) &&
      serializeQueryUrl(s.queryUrl) === nextQueryUrlSerialized,
  );
  if (duplicate) {
    return res
      .status(409)
      .json({ error: 'queryUrl already exists for this user' });
  }

  if (patch.backendUrl !== undefined || patch.queryUrl !== undefined) {
    const nextQueryUrlName =
      AppConfig.enableAuth && nextBackendUrl
        ? await fetchQueryUrlName(nextQueryUrl)
        : undefined;
    const writeChecks = await checkBackendForWrite({
      backendUrl: nextBackendUrl,
      userSteamId,
      queryUrlName: nextQueryUrlName,
    });
    if (!writeChecks.ok) {
      return res.status(writeChecks.status).json({ error: writeChecks.error });
    }
  }

  const server = await updateServer(current.id, {
    label: patch.label,
    queryUrl: patch.queryUrl,
    backendUrl: patch.backendUrl === undefined ? undefined : nextBackendUrl,
    public: patch.public,
  });
  return res.json({ server });
});

router.delete('/server/:id', requireServerWriteAuth, async (req, res) => {
  const current = db.data.servers.find((s) => s.id === req.params.id);
  if (!current) {
    return res.status(404).json({ error: 'server not found' });
  }

  const userId = (req as any).user?.id as string | undefined;
  const userSteamId = (req as any).user?.steamId as string | undefined;
  const isOwner = !AppConfig.enableAuth || current.userId === userId;
  if (!isOwner) {
    const isAdmin = await canAdminServer(current.backendUrl, userSteamId);
    if (!isAdmin) {
      return res.status(404).json({ error: 'server not found' });
    }
  }

  await removeServer(current.id);
  res.json({ ok: true });
});

if (AppConfig.superAdminId) {
  const validStates: UserState[] = ['new', 'verified', 'closed'];
  const validRoles: UserRole[] = ['guest', 'user', 'admin'];
  const toPublicUser = (user: (typeof db.data.users)[number]): PublicUser => ({
    id: user.id,
    username: user.username,
    state: user.state,
    role: user.role,
    steamId: user.steamId,
    createdAt: user.createdAt,
  });

  router.get('/user', requireAuth, (req, res) => {
    const currentSteamId = (req as any).user?.steamId as string | undefined;
    if (currentSteamId !== AppConfig.superAdminId) {
      return res.status(403).json({ error: 'forbidden' });
    }
    return res.json({ users: db.data.users.map(toPublicUser) });
  });

  router.patch('/user/:id', requireAuth, async (req, res) => {
    const currentSteamId = (req as any).user?.steamId as string | undefined;
    if (currentSteamId !== AppConfig.superAdminId) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const body = req.body ?? {};
    const keys = Object.keys(body);
    if (keys.some((key) => key !== 'state' && key !== 'role')) {
      return res.status(400).json({ error: 'only state and role are allowed' });
    }

    const { state, role } = body as { state?: unknown; role?: unknown };
    if (
      state !== undefined &&
      (typeof state !== 'string' || !validStates.includes(state as UserState))
    ) {
      return res.status(400).json({ error: 'state is invalid' });
    }
    if (
      role !== undefined &&
      (typeof role !== 'string' || !validRoles.includes(role as UserRole))
    ) {
      return res.status(400).json({ error: 'role is invalid' });
    }

    const user = db.data.users.find((entry) => entry.id === req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'user not found' });
    }

    if (state !== undefined) user.state = state as UserState;
    if (role !== undefined) user.role = role as UserRole;
    await db.write();
    return res.json({ user: toPublicUser(user) });
  });
}

export default router;
