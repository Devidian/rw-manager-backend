import { randomBytes, scryptSync } from 'node:crypto';
import {
  createUser,
  db,
  findUserById,
  findUserBySteamId,
  findUserByUsername,
  setUserSteamId,
  toPrivateUser,
  verifyUserPassword,
} from '../db/json.js';
import { AppConfig } from '../utils/app-config.js';
import { normalizeSteamId } from '../utils/normalize-steam-id.js';
import { createAuthToken } from './auth-token-service.js';
import type { AuthUserTokenResponse } from '../dto/auth-user-token-response.js';
import type { LoginUserRequest } from '../dto/login-user-request.js';
import type { RegisterLocalUserRequest } from '../dto/register-local-user-request.js';
import type { SteamAuthRequest } from '../dto/steam-auth-request.js';
import type { PrivateUser } from '../interfaces/app-user.js';
import type { ValidateUserResponse } from '../dto/validate-user-response.js';
import { mapPrivateUserToDto } from '../mapper/user-mapper.js';
import { defaultLogger } from '../utils/logger.js';

function resolveOpenId(body: SteamAuthRequest): string {
  const claimed =
    body.openId ?? body['openid.claimed_id'] ?? body['openid.identity'];
  return typeof claimed === 'string' ? claimed.trim() : '';
}

function parseSteamId(body: SteamAuthRequest): string {
  const openId = resolveOpenId(body);
  if (!openId) {
    throw new Error('OPEN_ID_REQUIRED');
  }

  const steamIdMatch = openId.match(/\/openid\/id\/(\d+)(?:\/)?$/);
  const normalizedSteamId = normalizeSteamId(steamIdMatch?.[1]);
  if (!normalizedSteamId) {
    throw new Error('OPEN_ID_INVALID');
  }
  return normalizedSteamId;
}

export async function registerLocalUser(
  input: RegisterLocalUserRequest,
): Promise<AuthUserTokenResponse> {
  const normalizedEmail =
    typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!normalizedEmail || !input.password) {
    throw new Error('EMAIL_PASSWORD_REQUIRED');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('EMAIL_INVALID');
  }

  const resolvedUsername =
    typeof input.username === 'string' && input.username.trim()
      ? input.username.trim()
      : normalizedEmail;

  if (findUserByUsername(resolvedUsername)) {
    throw new Error('USERNAME_EXISTS');
  }

  let normalizedSteamId: string | undefined;
  if (input.steamId !== undefined) {
    const parsedSteamId = normalizeSteamId(input.steamId);
    if (!parsedSteamId) {
      throw new Error('STEAM_ID_INVALID');
    }
    normalizedSteamId = parsedSteamId;
  }
  if (normalizedSteamId && findUserBySteamId(normalizedSteamId)) {
    throw new Error('STEAM_ID_EXISTS');
  }

  const user = await createUser(
    resolvedUsername,
    normalizedEmail,
    input.password,
    normalizedSteamId,
  );

  const token = createAuthToken(user.id);
  return { user: mapPrivateUserToDto(user as PrivateUser), token };
}

export function loginUser(input: LoginUserRequest): AuthUserTokenResponse {
  const user = findUserByUsername(input.username);
  if (!user || !verifyUserPassword(user, input.password)) {
    throw new Error('INVALID_USERNAME_OR_PASSWORD');
  }

  const privateUser = toPrivateUser(user);
  const token = createAuthToken(privateUser.id);
  return { user: mapPrivateUserToDto(privateUser), token };
}

export async function connectSteam(
  userId: string,
  input: SteamAuthRequest,
): Promise<AuthUserTokenResponse> {
  const steamId = parseSteamId(input);

  const existingSteamUser = findUserBySteamId(steamId);
  const privateUser = existingSteamUser
    ? (toPrivateUser(existingSteamUser) as PrivateUser)
    : ((await setUserSteamId(userId, steamId)) as PrivateUser | null);

  if (!privateUser) {
    throw new Error('USER_NOT_FOUND');
  }

  const token = createAuthToken(privateUser.id);
  return { user: mapPrivateUserToDto(privateUser), token };
}

export async function disconnectSteam(
  userId: string,
): Promise<AuthUserTokenResponse> {
  const user = await setUserSteamId(userId, '');
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const publicUser = user as PrivateUser;
  const token = createAuthToken(publicUser.id);
  return { user: mapPrivateUserToDto(publicUser), token };
}

export async function steamSignIn(
  input: SteamAuthRequest,
): Promise<AuthUserTokenResponse> {
  const steamId = parseSteamId(input);
  const existingUser = findUserBySteamId(steamId);

  const user = existingUser
    ? (toPrivateUser(existingUser) as PrivateUser)
    : ((await createUser(
        (() => {
          const baseUsername = `steam_${steamId}`;
          let username = baseUsername;
          for (let i = 1; findUserByUsername(username); i += 1) {
            username = `${baseUsername}_${i}`;
          }
          return username;
        })(),
        `${`steam_${steamId}`}@steam.local`,
        randomBytes(24).toString('hex'),
        steamId,
        steamId === AppConfig.superAdminId
          ? 'admin'
          : AppConfig.defaultUserRole,
        steamId === AppConfig.superAdminId ? 'verified' : 'new',
      )) as PrivateUser);
  const token = createAuthToken(user.id);
  return { user: mapPrivateUserToDto(user), token };
}

export function validateUser(userId: string): ValidateUserResponse {
  const user = findUserById(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  return { user: mapPrivateUserToDto(toPrivateUser(user)) };
}

export async function renameSelf(
  userId: string,
  name: string,
): Promise<ValidateUserResponse> {
  const nextName = name.trim();
  if (!nextName) {
    throw new Error('NAME_REQUIRED');
  }

  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const existing = findUserByUsername(nextName);
  if (existing && existing.id !== user.id) {
    throw new Error('USERNAME_EXISTS');
  }

  user.username = nextName;
  await db.write();
  return { user: mapPrivateUserToDto(toPrivateUser(user)) };
}

export async function deleteSelf(userId: string): Promise<void> {
  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  db.data.users = db.data.users.filter((entry) => entry.id !== userId);
  db.data.servers = db.data.servers.filter((entry) => entry.userId !== userId);
  await db.write();
}

function hashApiToken(token: string, salt: string): string {
  return scryptSync(token, salt, 64).toString('hex');
}

export async function generateApiToken(userId: string): Promise<string> {
  const user = db.data.users.find((entry) => entry.id === userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }

  const token = randomBytes(32).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  user.apiTokenSalt = salt;
  user.apiTokenHash = hashApiToken(token, salt);
  user.apiTokenCreatedAt = new Date();
  await db.write();
  return token;
}
