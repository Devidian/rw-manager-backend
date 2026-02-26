import { addServer, db, removeServer, updateServer } from '../db/json.js';
import { AppConfig } from '../utils/app-config.js';
import type { PublicUser, UserRole, UserState } from '../interfaces/app-user.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import type { CreateServerRequest } from '../dto/create-server-request.js';
import type { PublicUserDto } from '../dto/public-user-dto.js';
import type { ServerDto } from '../dto/server-dto.js';
import type { UpdateServerRequest } from '../dto/update-server-request.js';
import type { UpdateStorageUserRequest } from '../dto/update-storage-user-request.js';
import { mapPublicUserToDto } from '../mapper/user-mapper.js';
import { mapServerToDto } from '../mapper/server-mapper.js';
import {
  canAdminServer,
  fetchBackendAdmins,
} from './can-admin-server-service.js';
import type { StorageRequestContext } from '../interfaces/storage-request-context.js';

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
}): Promise<void> {
  const { backendUrl, userSteamId, queryUrlName } = params;
  if (!AppConfig.enableAuth || !backendUrl) return;

  const admins = await fetchBackendAdmins(backendUrl);
  if (!admins) {
    throw new Error('FAILED_VERIFY_BACKEND_ADMINS');
  }
  if (admins.length > 0 && (!userSteamId || !admins.includes(userSteamId))) {
    throw new Error('NOT_BACKEND_ADMIN');
  }

  if (!queryUrlName) {
    throw new Error('QUERY_URL_NAME_REQUIRED');
  }

  const nameMatch = await verifyServerNameMatch(backendUrl, queryUrlName);
  if (nameMatch === 'failed') {
    throw new Error('FAILED_VERIFY_BACKEND_CONFIG');
  }
  if (nameMatch === 'bad_request') {
    throw new Error('QUERY_URL_NAME_MISMATCH');
  }
}

function assertServerWriteAccess(
  current: ServerConfig,
  context: StorageRequestContext,
): Promise<void> {
  const isOwner = !AppConfig.enableAuth || current.userId === context.userId;
  if (isOwner) return Promise.resolve();

  return canAdminServer(current.backendUrl, context.userSteamId).then((admin) => {
    if (!admin) {
      throw new Error('SERVER_NOT_FOUND');
    }
  });
}

export function listServers(context: StorageRequestContext): ServerDto[] {
  if (!AppConfig.enableAuth) {
    return db.data.servers.map(mapServerToDto);
  }
  return db.data.servers
    .filter(
      (server) =>
        server.public || (!!context.userId && server.userId === context.userId),
    )
    .map(mapServerToDto);
}

export async function createServer(
  input: CreateServerRequest,
  context: StorageRequestContext,
): Promise<ServerDto> {
  const { label, queryUrl, backendUrl, public: isPublic } = input;
  if (!label || !queryUrl) {
    throw new Error('LABEL_QUERY_URL_REQUIRED');
  }

  const normalizedBackendUrl = normalizeBackendUrl(backendUrl);
  const queryUrlSerialized = serializeQueryUrl(queryUrl);
  const queryUrlName =
    AppConfig.enableAuth && normalizedBackendUrl
      ? await fetchQueryUrlName(queryUrl)
      : undefined;

  const duplicate = db.data.servers.some(
    (server) =>
      (AppConfig.enableAuth ? server.userId === context.userId : true) &&
      serializeQueryUrl(server.queryUrl) === queryUrlSerialized,
  );
  if (duplicate) {
    throw new Error('QUERY_URL_EXISTS');
  }

  await checkBackendForWrite({
    backendUrl: normalizedBackendUrl,
    userSteamId: context.userSteamId,
    queryUrlName,
  });

  const server = await addServer(
    label,
    queryUrl,
    normalizedBackendUrl,
    context.userId,
    typeof isPublic === 'boolean' ? isPublic : false,
  );
  return mapServerToDto(server);
}

export async function patchServer(
  serverId: string,
  patch: UpdateServerRequest,
  context: StorageRequestContext,
): Promise<ServerDto> {
  const current = db.data.servers.find((server) => server.id === serverId);
  if (!current) {
    throw new Error('SERVER_NOT_FOUND');
  }

  await assertServerWriteAccess(current, context);

  const nextQueryUrl = patch.queryUrl !== undefined ? patch.queryUrl : current.queryUrl;
  const nextBackendUrl =
    patch.backendUrl !== undefined
      ? normalizeBackendUrl(patch.backendUrl)
      : normalizeBackendUrl(current.backendUrl);
  const nextQueryUrlSerialized = serializeQueryUrl(nextQueryUrl);
  const duplicate = db.data.servers.some(
    (server) =>
      server.id !== current.id &&
      (AppConfig.enableAuth ? server.userId === current.userId : true) &&
      serializeQueryUrl(server.queryUrl) === nextQueryUrlSerialized,
  );
  if (duplicate) {
    throw new Error('QUERY_URL_EXISTS');
  }

  if (patch.backendUrl !== undefined || patch.queryUrl !== undefined) {
    const nextQueryUrlName =
      AppConfig.enableAuth && nextBackendUrl
        ? await fetchQueryUrlName(nextQueryUrl)
        : undefined;
    await checkBackendForWrite({
      backendUrl: nextBackendUrl,
      userSteamId: context.userSteamId,
      queryUrlName: nextQueryUrlName,
    });
  }

  const server = await updateServer(current.id, {
    label: patch.label,
    queryUrl: patch.queryUrl,
    backendUrl: patch.backendUrl === undefined ? undefined : nextBackendUrl,
    public: patch.public,
  });
  if (!server) {
    throw new Error('SERVER_NOT_FOUND');
  }
  return mapServerToDto(server);
}

export async function deleteServer(
  serverId: string,
  context: StorageRequestContext,
): Promise<void> {
  const current = db.data.servers.find((server) => server.id === serverId);
  if (!current) {
    throw new Error('SERVER_NOT_FOUND');
  }

  await assertServerWriteAccess(current, context);
  await removeServer(current.id);
}

function toPublicUser(user: (typeof db.data.users)[number]): PublicUser {
  return {
    id: user.id,
    username: user.username,
    state: user.state,
    role: user.role,
    steamId: user.steamId,
    createdAt: user.createdAt,
  };
}

export function listUsers(currentSteamId: string): PublicUserDto[] {
  if (!AppConfig.superAdminId || currentSteamId !== AppConfig.superAdminId) {
    throw new Error('FORBIDDEN');
  }
  return db.data.users.map(toPublicUser).map(mapPublicUserToDto);
}

export async function patchUser(
  currentSteamId: string,
  userId: string,
  patch: UpdateStorageUserRequest,
): Promise<PublicUserDto> {
  if (!AppConfig.superAdminId || currentSteamId !== AppConfig.superAdminId) {
    throw new Error('FORBIDDEN');
  }

  const validStates: UserState[] = ['new', 'verified', 'closed'];
  const validRoles: UserRole[] = ['guest', 'user', 'admin'];

  if (
    patch.state !== undefined &&
    (typeof patch.state !== 'string' || !validStates.includes(patch.state))
  ) {
    throw new Error('STATE_INVALID');
  }
  if (
    patch.role !== undefined &&
    (typeof patch.role !== 'string' || !validRoles.includes(patch.role))
  ) {
    throw new Error('ROLE_INVALID');
  }

  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  if (patch.state !== undefined) user.state = patch.state;
  if (patch.role !== undefined) user.role = patch.role;
  await db.write();
  return mapPublicUserToDto(toPublicUser(user));
}

export async function deleteStorageUser(
  currentSteamId: string,
  currentUserId: string,
  userId: string,
): Promise<void> {
  if (!AppConfig.superAdminId || currentSteamId !== AppConfig.superAdminId) {
    throw new Error('FORBIDDEN');
  }
  if (currentUserId === userId) {
    throw new Error('CANNOT_DELETE_SELF');
  }

  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  db.data.users = db.data.users.filter((entry) => entry.id !== userId);
  db.data.servers = db.data.servers.filter((entry) => entry.userId !== userId);
  await db.write();
}
