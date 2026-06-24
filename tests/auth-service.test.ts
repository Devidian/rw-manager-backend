import { jest } from '@jest/globals';

interface MutableDbUser {
  id: string;
  username: string;
  email: string;
  state: 'new' | 'verified' | 'closed';
  role: 'guest' | 'user' | 'admin';
  steamId?: string;
  apiTokenHash?: string;
  apiTokenSalt?: string;
  apiTokenCreatedAt?: Date;
  createdAt: Date;
}

interface MutableDbState {
  users: MutableDbUser[];
  servers: Array<{ userId?: string }>;
}

const state: MutableDbState = {
  users: [],
  servers: [],
};

const createUserMock = jest.fn();
const findUserByIdMock = jest.fn();
const findUserBySteamIdMock = jest.fn();
const findUserByUsernameMock = jest.fn();
const setUserSteamIdMock = jest.fn();
const toPrivateUserMock = jest.fn();
const verifyUserPasswordMock = jest.fn();
const createAuthTokenMock = jest.fn<(userId: string) => string>();
const mapPrivateUserToDtoMock = jest.fn<(user: MutableDbUser) => { id: string; username: string }>();
const normalizeSteamIdMock = jest.fn<(value: unknown) => string | null>();
const debugMock = jest.fn<(value: unknown) => void>();
const writeMock = jest.fn<() => Promise<void>>().mockResolvedValue();

jest.unstable_mockModule('../src/db/json.js', () => ({
  createUser: createUserMock,
  db: {
    data: state,
    write: writeMock,
  },
  findUserById: findUserByIdMock,
  findUserBySteamId: findUserBySteamIdMock,
  findUserByUsername: findUserByUsernameMock,
  setUserSteamId: setUserSteamIdMock,
  toPrivateUser: toPrivateUserMock,
  verifyUserPassword: verifyUserPasswordMock,
}));

jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  createAuthToken: createAuthTokenMock,
}));

jest.unstable_mockModule('../src/mapper/user-mapper.js', () => ({
  mapPrivateUserToDto: mapPrivateUserToDtoMock,
}));

jest.unstable_mockModule('../src/utils/normalize-steam-id.js', () => ({
  normalizeSteamId: normalizeSteamIdMock,
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    debug: debugMock,
  },
}));

const authService = await import('../src/service/auth-service.js');

function createUserRecord(overrides: Partial<MutableDbUser> = {}): MutableDbUser {
  return {
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    state: 'new',
    role: 'user',
    steamId: undefined,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('auth-service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.DEFAULT_USER_ROLE = 'user';
    process.env.SUPER_ADMIN_ID = '';
    state.users = [];
    state.servers = [];
    createUserMock.mockReset();
    findUserByIdMock.mockReset();
    findUserBySteamIdMock.mockReset();
    findUserByUsernameMock.mockReset();
    setUserSteamIdMock.mockReset();
    toPrivateUserMock.mockReset();
    verifyUserPasswordMock.mockReset();
    createAuthTokenMock.mockReset().mockImplementation((userId: string) => `token:${userId}`);
    mapPrivateUserToDtoMock.mockReset().mockImplementation((user: MutableDbUser) => ({
      id: user.id,
      username: user.username,
    }));
    toPrivateUserMock.mockReset().mockImplementation((user: MutableDbUser) => user);
    normalizeSteamIdMock.mockReset().mockImplementation((value: unknown) => {
      if (typeof value !== 'string') return null;
      return value.trim() || null;
    });
    debugMock.mockReset();
    writeMock.mockClear();
  });

  afterAll(() => {
    restoreEnv(originalEnv);
  });

  test('registerLocalUser validates required fields and email format', async () => {
    await expect(
      authService.registerLocalUser({
        email: '',
        password: '',
      }),
    ).rejects.toThrow('EMAIL_PASSWORD_REQUIRED');

    await expect(
      authService.registerLocalUser({
        email: 'bad',
        password: 'secret',
      }),
    ).rejects.toThrow('EMAIL_INVALID');
  });

  test('registerLocalUser enforces username and steam uniqueness and validates steam ids', async () => {
    findUserByUsernameMock.mockReturnValueOnce(createUserRecord());
    await expect(
      authService.registerLocalUser({
        email: 'alice@example.com',
        password: 'secret',
        username: 'alice',
      }),
    ).rejects.toThrow('USERNAME_EXISTS');

    findUserByUsernameMock.mockReset();
    normalizeSteamIdMock.mockReturnValueOnce(null);
    await expect(
      authService.registerLocalUser({
        email: 'alice@example.com',
        password: 'secret',
        steamId: 'bad',
      }),
    ).rejects.toThrow('STEAM_ID_INVALID');

    normalizeSteamIdMock.mockReset().mockReturnValue('steam-1');
    findUserBySteamIdMock.mockReturnValueOnce(createUserRecord());
    await expect(
      authService.registerLocalUser({
        email: 'alice@example.com',
        password: 'secret',
        steamId: 'steam-1',
      }),
    ).rejects.toThrow('STEAM_ID_EXISTS');
  });

  test('registerLocalUser creates users and falls back username to normalized email', async () => {
    const created = createUserRecord({ steamId: 'steam-1' });
    createUserMock.mockResolvedValue(created);

    await expect(
      authService.registerLocalUser({
        email: ' Alice@Example.com ',
        password: 'secret',
        steamId: 'steam-1',
      }),
    ).resolves.toEqual({
      user: { id: 'user-1', username: 'alice' },
      token: 'token:user-1',
    });

    expect(createUserMock).toHaveBeenCalledWith(
      'alice@example.com',
      'alice@example.com',
      'secret',
      'steam-1',
    );

    createUserMock.mockResolvedValueOnce(createUserRecord({ username: 'Bob' }));
    await expect(
      authService.registerLocalUser({
        email: 'bob@example.com',
        password: 'secret',
        username: ' Bob ',
      }),
    ).resolves.toEqual({
      user: { id: 'user-1', username: 'Bob' },
      token: 'token:user-1',
    });
  });

  test('loginUser rejects invalid credentials and returns an auth token on success', () => {
    const user = createUserRecord();
    findUserByUsernameMock.mockReturnValueOnce(undefined);
    expect(() =>
      authService.loginUser({ username: 'alice', password: 'secret' }),
    ).toThrow('INVALID_USERNAME_OR_PASSWORD');

    findUserByUsernameMock.mockReturnValueOnce(user);
    verifyUserPasswordMock.mockReturnValueOnce(false);
    expect(() =>
      authService.loginUser({ username: 'alice', password: 'secret' }),
    ).toThrow('INVALID_USERNAME_OR_PASSWORD');

    findUserByUsernameMock.mockReturnValueOnce(user);
    verifyUserPasswordMock.mockReturnValueOnce(true);
    toPrivateUserMock.mockReturnValueOnce(user);

    expect(
      authService.loginUser({ username: 'alice', password: 'secret' }),
    ).toEqual({
      user: { id: 'user-1', username: 'alice' },
      token: 'token:user-1',
    });
  });

  test('connectSteam validates open ids and links or reuses users', async () => {
    await expect(authService.connectSteam('user-1', {})).rejects.toThrow(
      'OPEN_ID_REQUIRED',
    );

    normalizeSteamIdMock.mockReturnValueOnce(null);
    await expect(
      authService.connectSteam('user-1', {
        openId: 'https://steamcommunity.com/openid/id/not-a-number',
      }),
    ).rejects.toThrow('OPEN_ID_INVALID');

    const existing = createUserRecord({ steamId: '76561198000000000' });
    findUserBySteamIdMock.mockReturnValueOnce(existing);
    toPrivateUserMock.mockReturnValueOnce(existing);
    await expect(
      authService.connectSteam('user-1', {
        openId: 'https://steamcommunity.com/openid/id/76561198000000000',
      }),
    ).resolves.toEqual({
      user: { id: 'user-1', username: 'alice' },
      token: 'token:user-1',
    });

    findUserBySteamIdMock.mockReset().mockReturnValue(undefined);
    setUserSteamIdMock.mockResolvedValueOnce(null);
    await expect(
      authService.connectSteam('user-1', {
        openId: 'https://steamcommunity.com/openid/id/76561198000000000',
      }),
    ).rejects.toThrow('USER_NOT_FOUND');
  });

  test('disconnectSteam, validateUser, renameSelf, and deleteSelf handle state changes', async () => {
    setUserSteamIdMock.mockResolvedValueOnce(null);
    await expect(authService.disconnectSteam('user-1')).rejects.toThrow(
      'USER_NOT_FOUND',
    );

    setUserSteamIdMock.mockResolvedValueOnce(createUserRecord());
    await expect(authService.disconnectSteam('user-1')).resolves.toEqual({
      user: { id: 'user-1', username: 'alice' },
      token: 'token:user-1',
    });

    findUserByIdMock.mockReturnValueOnce(undefined);
    expect(() => authService.validateUser('missing')).toThrow('USER_NOT_FOUND');

    findUserByIdMock.mockReturnValueOnce(createUserRecord());
    toPrivateUserMock.mockReturnValueOnce(createUserRecord());
    expect(authService.validateUser('user-1')).toEqual({
      user: { id: 'user-1', username: 'alice' },
    });

    state.users = [createUserRecord()];
    await expect(authService.renameSelf('user-1', '   ')).rejects.toThrow(
      'NAME_REQUIRED',
    );
    await expect(authService.renameSelf('missing', 'bob')).rejects.toThrow(
      'USER_NOT_FOUND',
    );

    findUserByUsernameMock.mockReturnValueOnce(createUserRecord({ id: 'user-2' }));
    await expect(authService.renameSelf('user-1', 'bob')).rejects.toThrow(
      'USERNAME_EXISTS',
    );

    findUserByUsernameMock.mockReturnValueOnce(undefined);
    await expect(authService.renameSelf('user-1', 'bob')).resolves.toEqual({
      user: { id: 'user-1', username: 'bob' },
    });

    state.servers = [{ userId: 'user-1' }, { userId: 'user-2' }];
    await expect(authService.deleteSelf('missing')).rejects.toThrow('USER_NOT_FOUND');
    await expect(authService.deleteSelf('user-1')).resolves.toBeUndefined();
    expect(state.users).toEqual([]);
    expect(state.servers).toEqual([{ userId: 'user-2' }]);
  });

  test('generateApiToken returns a one-time token and stores only hash metadata', async () => {
    state.users = [createUserRecord()];

    await expect(authService.generateApiToken('missing')).rejects.toThrow('USER_NOT_FOUND');
    const token = await authService.generateApiToken('user-1');

    expect(token).toEqual(expect.any(String));
    expect(token.length).toBeGreaterThan(30);
    expect(state.users[0].apiTokenHash).toEqual(expect.any(String));
    expect(state.users[0].apiTokenSalt).toEqual(expect.any(String));
    expect(state.users[0].apiTokenCreatedAt).toEqual(expect.any(Date));
    expect(state.users[0].apiTokenHash).not.toBe(token);
    expect(state.users[0].apiTokenSalt).not.toBe(token);
    expect(writeMock).toHaveBeenCalled();
  });

  test('steamSignIn reuses existing users and creates new users with role and state defaults', async () => {
    const existing = createUserRecord({ steamId: '76561198000000000' });
    findUserBySteamIdMock.mockReturnValueOnce(existing);
    toPrivateUserMock.mockReturnValueOnce(existing);

    await expect(
      authService.steamSignIn({
        'openid.identity': 'https://steamcommunity.com/openid/id/76561198000000000',
      }),
    ).resolves.toEqual({
      user: { id: 'user-1', username: 'alice' },
      token: 'token:user-1',
    });

    findUserBySteamIdMock.mockReset().mockReturnValue(undefined);
    findUserByUsernameMock.mockReset().mockReturnValue(undefined);
    createUserMock.mockResolvedValueOnce(
      createUserRecord({
        id: 'user-2',
        username: 'steam_76561198000000000',
        steamId: '76561198000000000',
        role: 'user',
        state: 'new',
      }),
    );

    await expect(
      authService.steamSignIn({
        openId: 'https://steamcommunity.com/openid/id/76561198000000000',
      }),
    ).resolves.toEqual({
      user: { id: 'user-2', username: 'steam_76561198000000000' },
      token: 'token:user-2',
    });

    expect(createUserMock).toHaveBeenCalledWith(
      'steam_76561198000000000',
      'steam_76561198000000000@steam.local',
      expect.any(String),
      '76561198000000000',
      'user',
      'new',
    );

    process.env.SUPER_ADMIN_ID = '76561198000000000';
    findUserBySteamIdMock.mockReset().mockReturnValue(undefined);
    findUserByUsernameMock.mockImplementation((username: string) =>
      username === 'steam_76561198000000000' ? createUserRecord() : undefined,
    );
    createUserMock.mockResolvedValueOnce(
      createUserRecord({
        id: 'user-9',
        username: 'steam_76561198000000000_1',
        steamId: '76561198000000000',
        role: 'admin',
        state: 'verified',
      }),
    );

    await expect(
      authService.steamSignIn({
        openId: 'https://steamcommunity.com/openid/id/76561198000000000',
      }),
    ).resolves.toEqual({
      user: { id: 'user-9', username: 'steam_76561198000000000_1' },
      token: 'token:user-9',
    });

    expect(createUserMock).toHaveBeenCalledWith(
      'steam_76561198000000000_1',
      'steam_76561198000000000@steam.local',
      expect.any(String),
      '76561198000000000',
      'admin',
      'verified',
    );
  });
});
