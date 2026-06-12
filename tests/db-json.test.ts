import { jest } from '@jest/globals';
import path from 'node:path';

interface JsonDbUserRecord {
  id: string;
  username: string;
  email: string;
  state: 'new' | 'verified' | 'closed';
  role: 'guest' | 'user' | 'admin';
  steamId?: string;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}

interface JsonDbServerRecord {
  id: string;
  label: string;
  queryUrl: string;
  backendUrl?: string;
  public: boolean;
  userId?: string;
  createdAt: Date;
}

interface JsonDbState {
  servers: JsonDbServerRecord[];
  users: JsonDbUserRecord[];
}

const mkdirSyncMock = jest.fn<(path: string, options: { recursive: boolean }) => void>();
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();
const presetState: JsonDbState = { servers: [], users: [] };
const uuidMock = jest.fn<() => string>();
const randomBytesMock = jest.fn<(size: number) => Buffer>();
const scryptSyncMock = jest.fn<(password: string, salt: string, keylen: number) => Buffer>();
const timingSafeEqualMock = jest.fn<(a: Buffer, b: Buffer) => boolean>();

jest.unstable_mockModule('node:fs', () => ({
  mkdirSync: mkdirSyncMock,
}));

jest.unstable_mockModule('lowdb/node', () => ({
  JSONFilePreset: jest.fn(async () => ({
    data: presetState,
    write: writeMock,
  })),
}));

jest.unstable_mockModule('uuid', () => ({
  v4: uuidMock,
}));

jest.unstable_mockModule('node:crypto', () => ({
  randomBytes: randomBytesMock,
  scryptSync: scryptSyncMock,
  timingSafeEqual: timingSafeEqualMock,
}));

const jsonDb = await import('../src/db/json.js');

function resetState(): void {
  presetState.servers = [];
  presetState.users = [];
  writeMock.mockClear();
  uuidMock.mockReset();
  randomBytesMock.mockReset();
  scryptSyncMock.mockReset();
  timingSafeEqualMock.mockReset();
}

describe('db/json', () => {
  beforeEach(() => {
    resetState();
  });

  test('creates the application data directory on module load', () => {
    expect(mkdirSyncMock).toHaveBeenCalledWith(path.resolve('data'), {
      recursive: true,
    });
  });

  test('addServer, removeServer, and updateServer mutate persisted state', async () => {
    uuidMock.mockReturnValue('server-1');

    const created = await jsonDb.addServer(
      'Server',
      'https://query.example.com',
      'https://backend.example.com',
      'user-1',
      true,
    );

    expect(created).toMatchObject({
      id: 'server-1',
      label: 'Server',
      queryUrl: 'https://query.example.com',
      backendUrl: 'https://backend.example.com',
      userId: 'user-1',
      public: true,
    });
    expect(presetState.servers).toHaveLength(1);

    await expect(
      jsonDb.updateServer('missing', { label: 'x' }),
    ).resolves.toBeNull();

    await expect(
      jsonDb.updateServer('server-1', {
        label: 'Renamed',
        queryUrl: 'https://new-query.example.com',
        backendUrl: 'https://new-backend.example.com',
        public: false,
      }),
    ).resolves.toMatchObject({
      label: 'Renamed',
      queryUrl: 'https://new-query.example.com',
      backendUrl: 'https://new-backend.example.com',
      public: false,
    });

    await jsonDb.removeServer('server-1');
    expect(presetState.servers).toEqual([]);
    expect(writeMock).toHaveBeenCalled();
  });

  test('createUser and lookup helpers operate on in-memory state', async () => {
    uuidMock.mockReturnValue('user-1');
    randomBytesMock.mockReturnValue(Buffer.from('salt'));
    scryptSyncMock.mockReturnValue(Buffer.from('password-hash'));

    const created = await jsonDb.createUser(
      'alice',
      'alice@example.com',
      'secret',
      'steam-1',
      'admin',
      'verified',
    );

    expect(created).toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'admin',
      steamId: 'steam-1',
      createdAt: expect.any(Date),
    });

    expect(jsonDb.findUserByUsername('alice')).toMatchObject({
      username: 'alice',
    });
    expect(jsonDb.findUserById('user-1')).toMatchObject({ id: 'user-1' });
    expect(jsonDb.findUserBySteamId('steam-1')).toMatchObject({
      steamId: 'steam-1',
    });
  });

  test('setUserSteamId returns null for missing users and updates existing users', async () => {
    presetState.users.push({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'new',
      role: 'user',
      steamId: undefined,
      passwordHash: 'abc',
      salt: 'salt',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    await expect(jsonDb.setUserSteamId('missing', 'steam-1')).resolves.toBeNull();
    await expect(
      jsonDb.setUserSteamId('user-1', 'steam-1'),
    ).resolves.toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'new',
      role: 'user',
      steamId: 'steam-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
  });

  test('verifyUserPassword checks hash length and delegates to timingSafeEqual', () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'new',
      role: 'user',
      steamId: undefined,
      passwordHash: Buffer.from('expected-hash').toString('hex'),
      salt: 'salt',
      createdAt: new Date(),
    };

    scryptSyncMock.mockReturnValueOnce(Buffer.from('short'));
    expect(jsonDb.verifyUserPassword(user, 'secret')).toBe(false);

    scryptSyncMock.mockReturnValueOnce(Buffer.from('expected-hash'));
    timingSafeEqualMock.mockReturnValueOnce(true);
    expect(jsonDb.verifyUserPassword(user, 'secret')).toBe(true);
  });

  test('public and private user mappers omit and include email appropriately', () => {
    const user = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'new',
      role: 'user',
      steamId: 'steam-1',
      passwordHash: 'hash',
      salt: 'salt',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    expect(jsonDb.toPrivateUser(user)).toEqual({
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'new',
      role: 'user',
      steamId: 'steam-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
    expect(jsonDb.toPublicUser(user)).toEqual({
      id: 'user-1',
      username: 'alice',
      state: 'new',
      role: 'user',
      steamId: 'steam-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });
  });
});
