import http from 'node:http';
import { jest } from '@jest/globals';
import { WebSocket, type RawData } from 'ws';

const getStoredServerLiveStatus = jest.fn(async (serverId: string) => {
  if (serverId === 'missing') throw new Error('SERVER_NOT_FOUND');
  if (serverId === 'no-query') throw new Error('QUERY_URL_MISSING');
  if (serverId === 'internal') throw 'unexpected';
  return serverId === 'server-a'
    ? {
        status: 'online' as const,
        onlinePlayers: [{ uid: 'one' }],
        lastChecked: '2026-08-03T12:00:00.000Z',
      }
    : { status: 'offline' as const, lastChecked: '2026-08-03T12:00:00.000Z' };
});
const authState: { user: { id: string } | null } = { user: null };
const getUserFromBearerToken = jest.fn(async () => authState.user);

jest.unstable_mockModule('../src/service/server-live-status-service.js', () => ({
  getStoredServerLiveStatus,
}));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  getUserFromBearerToken,
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const { attachServerStatusLiveService } = await import('../src/service/server-status-live-service.js');
const { publishServerLiveUpdate } = await import('../src/service/server-live-update-service.js');

describe('server status live endpoint', () => {
  const originalEnv = { ...process.env };
  let server: http.Server;
  let closeLive: (() => void) | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    process.env.ENABLE_AUTH = 'false';
    process.env.FORCE_AUTH = 'false';
    authState.user = null;
    server = http.createServer((_request, response) => response.end('ok'));
    closeLive = attachServerStatusLiveService(server).close;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    closeLive?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restoreEnv(originalEnv);
    jest.clearAllMocks();
  });

  test('subscribes, replaces the server set, and streams semantic deltas', async () => {
    const socket = await connect(`${baseUrl}/api/storage/server-live`);
    const initialMessages = messages(socket, 2);
    socket.send(JSON.stringify({
      type: 'server.status.subscribe', schemaVersion: 1, serverIds: ['server-a'],
    }));
    const [subscribed, snapshot] = await initialMessages;
    expect(subscribed).toMatchObject({
      type: 'server.status.subscribed', serverIds: ['server-a'],
    });
    expect(snapshot).toMatchObject({
      type: 'server.status.snapshot',
      items: [{ serverId: 'server-a', value: { status: 'online' } }],
    });

    publishServerLiveUpdate('server-b', {
      status: 'offline', lastChecked: '2026-08-03T12:00:00.000Z',
    });
    publishServerLiveUpdate('server-a', {
      status: 'online', onlinePlayers: [{ uid: 'one' }], lastChecked: '2026-08-03T12:02:00.000Z',
    });
    const changedMessage = messages(socket, 1);
    publishServerLiveUpdate('server-a', {
      status: 'offline', errorMessage: 'FETCH_FAILED', lastChecked: '2026-08-03T12:01:00.000Z',
    });
    await expect(changedMessage.then(([message]) => message)).resolves.toMatchObject({
      type: 'server.status.changed', serverId: 'server-a', sequence: 1,
      changed: { status: 'offline', errorMessage: 'FETCH_FAILED' },
      removedFields: ['onlinePlayers'],
    });

    const replacementMessages = messages(socket, 2);
    socket.send(JSON.stringify({
      type: 'server.status.set-servers', schemaVersion: 1, serverIds: ['server-b'],
    }));
    const [replacementSubscribed, replacementSnapshot] = await replacementMessages;
    expect(replacementSubscribed).toMatchObject({
      type: 'server.status.subscribed', serverIds: ['server-b'],
    });
    expect(replacementSnapshot).toMatchObject({
      type: 'server.status.snapshot', items: [{ serverId: 'server-b' }],
    });
    socket.close();
  });

  test('closes invalid and unknown initial subscriptions with protocol errors', async () => {
    const invalid = await connect(`${baseUrl}/api/storage/server-live`);
    const invalidMessage = messages(invalid, 1);
    const invalidClose = closeCode(invalid);
    invalid.send('{bad json');
    await expect(invalidMessage.then(([message]) => message)).resolves.toMatchObject({ type: 'error', code: 'invalid_message' });
    await expect(invalidClose).resolves.toBe(1003);

    const missing = await connect(`${baseUrl}/api/storage/server-live`);
    const missingMessage = messages(missing, 1);
    const missingClose = closeCode(missing);
    missing.send(JSON.stringify({
      type: 'server.status.subscribe', schemaVersion: 1, serverIds: ['missing'],
    }));
    await expect(missingMessage.then(([message]) => message)).resolves.toMatchObject({ type: 'error', code: 'server_not_found' });
    await expect(missingClose).resolves.toBe(1003);

    for (const [serverId, code] of [['no-query', 'query_url_missing'], ['internal', 'internal_error']]) {
      const socket = await connect(`${baseUrl}/api/storage/server-live`);
      const result = messages(socket, 1);
      socket.send(JSON.stringify({ type: 'server.status.subscribe', schemaVersion: 1, serverIds: [serverId] }));
      await expect(result.then(([message]) => message)).resolves.toMatchObject({ type: 'error', code });
    }
  });

  test('enforces auth and reports invalid messages after subscription', async () => {
    process.env.ENABLE_AUTH = 'true';
    process.env.FORCE_AUTH = 'true';
    const unauthorized = await connect(`${baseUrl}/api/storage/server-live`);
    const unauthorizedMessages = messages(unauthorized, 1);
    unauthorized.send(JSON.stringify({
      type: 'server.status.subscribe', schemaVersion: 1, serverIds: [],
    }));
    await expect(unauthorizedMessages.then(([message]) => message)).resolves.toMatchObject({
      type: 'error', code: 'unauthorized',
    });

    authState.user = { id: 'user-1' };
    const authorized = await connect(`${baseUrl}/api/storage/server-live`);
    const initial = messages(authorized, 2);
    authorized.send(JSON.stringify({
      type: 'server.status.subscribe', schemaVersion: 1, serverIds: [], token: 'valid',
    }));
    await initial;
    const errorMessage = messages(authorized, 1);
    authorized.send(JSON.stringify({ type: 'wrong', schemaVersion: 1, serverIds: [] }));
    await expect(errorMessage.then(([message]) => message)).resolves.toMatchObject({
      type: 'error', code: 'invalid_message',
    });
    authorized.close();
  });
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function messages(socket: WebSocket, count: number): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve) => {
    const result: Array<Record<string, unknown>> = [];
    const listener = (data: RawData) => {
      result.push(JSON.parse(data.toString()) as Record<string, unknown>);
      if (result.length === count) {
        socket.off('message', listener);
        resolve(result);
      }
    };
    socket.on('message', listener);
  });
}

function closeCode(socket: WebSocket): Promise<number> {
  return new Promise((resolve) => socket.once('close', (code) => resolve(code)));
}

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) if (!(key in snapshot)) delete process.env[key];
  Object.assign(process.env, snapshot);
}
