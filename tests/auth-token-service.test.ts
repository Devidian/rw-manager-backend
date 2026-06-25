import { jest } from '@jest/globals';

interface PrivateUserRecord {
  id: string;
  username: string;
  email: string;
  state: 'new' | 'verified' | 'closed';
  role: 'guest' | 'user' | 'admin';
  steamId?: string;
  createdAt: Date;
}

const findUserByIdMock = jest.fn<(id: string) => PrivateUserRecord | undefined>();
const findUserByUsernameMock = jest.fn<(username: string) => { id: string } | undefined>();
const toPrivateUserMock = jest.fn<(user: PrivateUserRecord) => PrivateUserRecord>();
const verifyUserPasswordMock = jest.fn<(user: { id: string }, password: string) => boolean>();
const debugMock = jest.fn<(value: unknown) => void>();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findUserById: findUserByIdMock,
  findUserByUsername: findUserByUsernameMock,
  toPrivateUser: toPrivateUserMock,
  verifyUserPassword: verifyUserPasswordMock,
}));

jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    debug: debugMock,
  },
}));

const {
  authMiddleware,
  createAuthToken,
  getUserFromBearerToken,
  passport,
} = await import('../src/service/auth-token-service.js');

describe('auth-token-service', () => {
  const originalEnv = { ...process.env };
  const originalDateNow = Date.now;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AUTH_SESSION_SECRET: 'test-secret',
    };
    findUserByIdMock.mockReset();
    findUserByUsernameMock.mockReset();
    toPrivateUserMock.mockReset();
    verifyUserPasswordMock.mockReset();
    debugMock.mockReset();
    Date.now = jest.fn(() => new Date('2024-01-01T00:00:00.000Z').valueOf());
  });

  afterAll(() => {
    process.env = { ...originalEnv };
    Date.now = originalDateNow;
  });

  test('exports the passport initialize middleware', () => {
    expect(authMiddleware).toHaveLength(1);
    expect(typeof authMiddleware[0]).toBe('function');
  });

  test('registers a local passport strategy that verifies credentials', async () => {
    const strategy = passport._strategy('local') as {
      _verify: (
        username: string,
        password: string,
        done: (error: Error | null, user?: unknown, options?: unknown) => void,
      ) => void;
    };

    findUserByUsernameMock.mockReturnValueOnce(undefined);
    await new Promise<void>((resolve) => strategy._verify('alice', 'secret', (_error, user, options) => {
      expect(user).toBe(false);
      expect(options).toEqual({ message: 'Invalid username or password' });
      resolve();
    }));

    const user = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'user',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    } as PrivateUserRecord;
    findUserByUsernameMock.mockReturnValueOnce(user);
    verifyUserPasswordMock.mockReturnValueOnce(true);
    toPrivateUserMock.mockReturnValueOnce(user);
    await new Promise<void>((resolve) => strategy._verify('alice', 'secret', (_error, result) => {
      expect(result).toEqual(user);
      resolve();
    }));
  });

  test('createAuthToken creates a three-part token and getUserFromBearerToken resolves users', async () => {
    const user: PrivateUserRecord = {
      id: 'user-1',
      username: 'alice',
      email: 'alice@example.com',
      state: 'verified',
      role: 'user',
      steamId: 'steam-1',
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    };
    findUserByIdMock.mockReturnValue(user);
    toPrivateUserMock.mockImplementation((value) => value);

    const token = createAuthToken('user-1');

    expect(token.split('.')).toHaveLength(3);
    await expect(getUserFromBearerToken(`Bearer ${token}`)).resolves.toEqual(user);
    expect(debugMock).toHaveBeenCalled();
  });

  test('getUserFromBearerToken rejects invalid authorization shapes and signatures', async () => {
    const token = createAuthToken('user-1');
    const invalidToken = `${token.slice(0, -1)}x`;

    await expect(getUserFromBearerToken(undefined)).resolves.toBeNull();
    await expect(getUserFromBearerToken('Basic token')).resolves.toBeNull();
    await expect(getUserFromBearerToken('Bearer missing.parts')).resolves.toBeNull();
    await expect(getUserFromBearerToken(`Bearer ${invalidToken}`)).resolves.toBeNull();
  });

  test('getUserFromBearerToken rejects malformed, expired, and missing-user payloads', async () => {
    const token = createAuthToken('user-1');

    findUserByIdMock.mockReturnValue(undefined);
    await expect(getUserFromBearerToken(`Bearer ${token}`)).resolves.toBeNull();

    findUserByIdMock.mockReset();
    Date.now = jest.fn(() => new Date('2030-01-01T00:00:00.000Z').valueOf());
    await expect(getUserFromBearerToken(`Bearer ${token}`)).resolves.toBeNull();

    const malformed = 'Bearer a.b.c';
    await expect(getUserFromBearerToken(malformed)).resolves.toBeNull();
  });
});
