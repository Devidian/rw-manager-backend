import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { v4 } from 'uuid';
import { db } from './json.js';
import { getMongoCollections } from './mongodb.js';
import type {
  JsonDbUser,
  PrivateUser,
  PublicUser,
  UserRole,
  UserState,
} from '../interfaces/app-user.js';
import type { ServerConfig } from '../interfaces/server-config.js';

type ServerPatch = Partial<
  Pick<
    ServerConfig,
    | 'label'
    | 'queryUrl'
    | 'backendUrl'
    | 'mapUrl'
    | 'public'
    | 'data'
    | 'info'
    | 'status'
    | 'onlinePlayers'
    | 'knownPlayers'
    | 'blocked'
    | 'blockedAt'
    | 'lastChecked'
    | 'errorMessage'
    | 'queryDataUpdatedAt'
    | 'steamId'
    | 'addr'
    | 'version'
    | 'name'
    | 'ip'
    | 'port'
    | 'region'
    | 'gm'
    | 'mods'
    | 'password'
    | 'whitelist'
    | 'adminUid'
    | 'firstSeen'
    | 'lastSeen'
  >
>;

function stripMongoId<T extends { _id?: unknown }>(value: T): Omit<T, '_id'> {
  const { _id, ...rest } = value;
  void _id;
  return rest;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
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
    pinnedServers: Array.isArray(user.pinnedServers) ? user.pinnedServers : [],
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
    pinnedServers: Array.isArray(user.pinnedServers) ? user.pinnedServers : [],
    createdAt: user.createdAt,
  };
}

export async function listServers(): Promise<ServerConfig[]> {
  const mongo = getMongoCollections();
  if (mongo) {
    const servers = await mongo.servers.find({}, { projection: { _id: 0 } }).toArray();
    return servers.map((server) => stripMongoId(server) as ServerConfig);
  }
  return db.data.servers;
}

export async function findServerById(id: string): Promise<ServerConfig | undefined> {
  const mongo = getMongoCollections();
  if (mongo) {
    const server = await mongo.servers.findOne({ id }, { projection: { _id: 0 } });
    return server ? stripMongoId(server) as ServerConfig : undefined;
  }
  return db.data.servers.find((server) => server.id === id);
}

export async function findServerByMasterIdentity(params: {
  serverId: string;
  steamId?: string;
}): Promise<ServerConfig | undefined> {
  const mongo = getMongoCollections();
  if (mongo) {
    const server = await mongo.servers.findOne({
      $or: [
        { id: params.serverId },
        ...(params.steamId ? [{ steamId: params.steamId }, { id: params.steamId }] : []),
      ],
    }, { projection: { _id: 0 } });
    return server ? stripMongoId(server) as ServerConfig : undefined;
  }
  return db.data.servers.find(
    (candidate) =>
      candidate.id === params.serverId ||
      (params.steamId !== undefined &&
        (candidate.steamId === params.steamId || candidate.id === params.steamId)),
  );
}

export async function addServer(
  label: string,
  queryUrl: string,
  backendUrl?: string,
  userId?: string,
  isPublic = false,
): Promise<ServerConfig> {
  const server: ServerConfig = {
    id: v4(),
    label,
    queryUrl,
    backendUrl,
    public: isPublic,
    userId,
    createdAt: new Date(),
  };
  await saveServer(server);
  return server;
}

export async function saveServer(server: ServerConfig): Promise<ServerConfig> {
  const mongo = getMongoCollections();
  if (mongo) {
    await mongo.servers.replaceOne({ id: server.id }, server, { upsert: true });
    return server;
  }
  const index = db.data.servers.findIndex((entry) => entry.id === server.id);
  if (index >= 0) {
    db.data.servers[index] = server;
  } else {
    db.data.servers.push(server);
  }
  await db.write();
  return server;
}

export async function updateServer(
  id: string,
  input: ServerPatch,
): Promise<ServerConfig | null> {
  const server = await findServerById(id);
  if (!server) return null;
  Object.assign(server, Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ));
  return saveServer(server);
}

export async function removeServer(id: string): Promise<void> {
  const mongo = getMongoCollections();
  if (mongo) {
    await mongo.servers.deleteOne({ id });
    return;
  }
  db.data.servers = db.data.servers.filter((server) => server.id !== id);
  await db.write();
}

export async function replacePinnedServerId(previousId: string, nextId: string): Promise<void> {
  if (previousId === nextId) return;
  const users = await listUsers();
  for (const user of users) {
    if (!Array.isArray(user.pinnedServers)) continue;
    const pinned = new Set(user.pinnedServers.map((entry) => entry === previousId ? nextId : entry));
    await updateUser(user.id, { pinnedServers: [...pinned] });
  }
}

export async function createUser(
  username: string,
  email: string,
  password: string,
  steamId?: string,
  role: UserRole = 'user',
  state: UserState = 'new',
): Promise<PrivateUser> {
  const salt = randomBytes(16).toString('hex');
  const user: JsonDbUser = {
    id: v4(),
    username,
    email,
    state,
    role,
    steamId,
    pinnedServers: [],
    passwordHash: hashPassword(password, salt),
    salt,
    createdAt: new Date(),
  };
  await saveUser(user);
  return toPrivateUser(user);
}

export async function saveUser(user: JsonDbUser): Promise<JsonDbUser> {
  const mongo = getMongoCollections();
  if (mongo) {
    await mongo.users.replaceOne({ id: user.id }, user, { upsert: true });
    return user;
  }
  const index = db.data.users.findIndex((entry) => entry.id === user.id);
  if (index >= 0) {
    db.data.users[index] = user;
  } else {
    db.data.users.push(user);
  }
  await db.write();
  return user;
}

export async function findUserByUsername(username: string): Promise<JsonDbUser | undefined> {
  const mongo = getMongoCollections();
  if (mongo) {
    const user = await mongo.users.findOne({ username }, { projection: { _id: 0 } });
    return user ? stripMongoId(user) as JsonDbUser : undefined;
  }
  return db.data.users.find((user) => user.username === username);
}

export async function findUserById(id: string): Promise<JsonDbUser | undefined> {
  const mongo = getMongoCollections();
  if (mongo) {
    const user = await mongo.users.findOne({ id }, { projection: { _id: 0 } });
    return user ? stripMongoId(user) as JsonDbUser : undefined;
  }
  return db.data.users.find((user) => user.id === id);
}

export async function findUserBySteamId(steamId: string): Promise<JsonDbUser | undefined> {
  const mongo = getMongoCollections();
  if (mongo) {
    const user = await mongo.users.findOne({ steamId }, { projection: { _id: 0 } });
    return user ? stripMongoId(user) as JsonDbUser : undefined;
  }
  return db.data.users.find((user) => user.steamId === steamId);
}

export async function setUserSteamId(id: string, steamId: string): Promise<PrivateUser | null> {
  const user = await findUserById(id);
  if (!user) return null;
  user.steamId = steamId || undefined;
  await saveUser(user);
  return toPrivateUser(user);
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<JsonDbUser, 'username' | 'state' | 'role' | 'pinnedServers' | 'apiTokenHash' | 'apiTokenSalt' | 'apiTokenCreatedAt'>>,
): Promise<JsonDbUser | null> {
  const user = await findUserById(id);
  if (!user) return null;
  Object.assign(user, Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ));
  await saveUser(user);
  return user;
}

export async function listUsers(): Promise<JsonDbUser[]> {
  const mongo = getMongoCollections();
  if (mongo) {
    const users = await mongo.users.find({}, { projection: { _id: 0 } }).toArray();
    return users.map((user) => stripMongoId(user) as JsonDbUser);
  }
  return db.data.users;
}

export async function deleteUserAndOwnedServers(userId: string): Promise<boolean> {
  const user = await findUserById(userId);
  if (!user) return false;
  const mongo = getMongoCollections();
  if (mongo) {
    await Promise.all([
      mongo.users.deleteOne({ id: userId }),
      mongo.servers.deleteMany({ userId }),
    ]);
    return true;
  }
  db.data.users = db.data.users.filter((entry) => entry.id !== userId);
  db.data.servers = db.data.servers.filter((entry) => entry.userId !== userId);
  await db.write();
  return true;
}
