import { JSONFilePreset } from 'lowdb/node';
import { ServerConfig } from '../interfaces/server-config.js';
import { v4 } from 'uuid';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type {
  JsonDbUser,
  PrivateUser,
  PublicUser,
  UserRole,
  UserState,
} from '../interfaces/app-user.js';
import { mkdirSync } from 'node:fs';

// ensure data directory exists
mkdirSync('/appdata/rwman', { recursive: true });

export const db = await JSONFilePreset<{
  servers: ServerConfig[];
  users: JsonDbUser[];
}>('/appdata/rwman/data.json', { servers: [], users: [] });

export async function addServer(
  label: string,
  queryUrl: string,
  backendUrl?: string,
  userId?: string,
  isPublic = false,
) {
  const server: ServerConfig = {
    id: v4(),
    label,
    queryUrl,
    backendUrl,
    public: isPublic,
    userId,
    createdAt: new Date(),
  };
  db.data.servers.push(server);
  await db.write();
  return server;
}

export async function removeServer(id: string) {
  db.data.servers = db.data.servers.filter((s) => s.id !== id);
  await db.write();
}

export async function updateServer(
  id: string,
  input: Partial<
    Pick<ServerConfig, 'label' | 'queryUrl' | 'backendUrl' | 'public'>
  >,
) {
  const server = db.data.servers.find((s) => s.id === id);
  if (!server) return null;

  if (typeof input.label === 'string') server.label = input.label;
  if (input.queryUrl !== undefined) server.queryUrl = input.queryUrl;
  if (typeof input.backendUrl === 'string')
    server.backendUrl = input.backendUrl;
  if (typeof input.public === 'boolean') server.public = input.public;

  await db.write();
  return server;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

export async function createUser(
  username: string,
  email: string,
  password: string,
  steamId?: string,
  role: UserRole = 'user',
  state: UserState = 'new',
) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  const user: JsonDbUser = {
    id: v4(),
    username,
    email,
    state,
    role,
    steamId,
    passwordHash,
    salt,
    createdAt: new Date(),
  };

  db.data.users.push(user);
  await db.write();
  return toPrivateUser(user);
}

export function findUserByUsername(username: string) {
  return db.data.users.find((user) => user.username === username);
}

export function findUserById(id: string) {
  return db.data.users.find((user) => user.id === id);
}

export function findUserBySteamId(steamId: string) {
  return db.data.users.find((user) => user.steamId === steamId);
}

export async function setUserSteamId(id: string, steamId: string) {
  const user = findUserById(id);
  if (!user) return null;
  user.steamId = steamId;
  await db.write();
  return toPrivateUser(user);
}

export function verifyUserPassword(user: JsonDbUser, password: string) {
  const inputHash = hashPassword(password, user.salt);
  const a = Buffer.from(user.passwordHash, 'hex');
  const b = Buffer.from(inputHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function toPrivateUser(user: JsonDbUser): PrivateUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    state: user.state,
    role: user.role,
    steamId: user.steamId,
    createdAt: user.createdAt,
  };
}

export function toPublicUser(user: JsonDbUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    state: user.state,
    role: user.role,
    steamId: user.steamId,
    createdAt: user.createdAt,
  };
}
