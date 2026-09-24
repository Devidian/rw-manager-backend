import http from 'node:http';
import { jest } from '@jest/globals';
import { WebSocket, type RawData } from 'ws';

const servers: Array<Record<string, unknown>> = [{ id: 'server-a', ip: '203.0.113.7', port: 4255 }];
const listServers = jest.fn(async () => servers);
const claimServerConnectorCredential = jest.fn(async (id: string, credential: string) => {
  const server = servers.find((entry) => entry.id === id);
  if (!server || server.connectorCredential) return false;
  server.connectorCredential = credential;
  return true;
});
const replaceServerConnectorCredential = jest.fn(async (id: string, credential: string) => {
  const server = servers.find((entry) => entry.id === id);
  if (!server) return false;
  server.connectorCredential = credential;
  return true;
});
const replaceServerConnectorCredentialIfCurrent = jest.fn(async (
  id: string,
  expected: string,
  credential: string,
) => {
  const server = servers.find((entry) => entry.id === id);
  if (!server || server.connectorCredential !== expected) return false;
  server.connectorCredential = credential;
  return true;
});

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  listServers,
  claimServerConnectorCredential,
  replaceServerConnectorCredential,
  replaceServerConnectorCredentialIfCurrent,
  resetServerConnectorCredential: jest.fn(),
}));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: {
    gameConnectorCredentialKey: 'connector-test-key-with-at-least-32-characters',
    gameConnectorPreviousCredentialKeys: ['previous-connector-test-key-with-at-least-32-characters'],
    gameConnectorTrustedProxyIps: ['127.0.0.1'],
  },
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const {
  attachGameConnectorWebSocketService,
  hasActiveGameConnectorFeature,
  registerGameConnectorEventHandler,
  requestGameConnectorCredentialReset,
} = await import('../src/service/game-connector-websocket-service.js');
const { encryptGameConnectorCredential } = await import('../src/service/game-connector-credential-service.js');

describe('game connector WebSocket', () => {
  let server: http.Server;
  let closeConnector: (() => void) | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    servers.splice(0, servers.length, { id: 'server-a', ip: '203.0.113.7', port: 4255 });
    server = http.createServer((_request, response) => response.end('ok'));
    closeConnector = attachGameConnectorWebSocketService(server).close;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing server address');
    baseUrl = `ws://127.0.0.1:${address.port}/ws`;
  });

  afterEach(async () => {
    closeConnector?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.clearAllMocks();
  });

  test('provisions the unique proxy-authenticated peer-IP and game-port match without accepting a client server id', async () => {
    const socket = await connect(baseUrl);
    const response = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255, serverId: 'other-server' }));

    await expect(response.then(([message]) => message)).resolves.toMatchObject({
      type: 'connector.provisioned', schemaVersion: 1, credential: expect.any(String),
    });
    expect(claimServerConnectorCredential).toHaveBeenCalledWith('server-a', expect.stringMatching(/^v1:/));
  });

  test('rejects a claimed game port that is not in the proxy-authenticated server catalog', async () => {
    const socket = await connect(baseUrl);
    const response = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4256 }));

    await expect(response.then(([message]) => message)).resolves.toEqual({
      type: 'error', schemaVersion: 1, code: 'server_not_found',
    });
    expect(claimServerConnectorCredential).not.toHaveBeenCalled();
  });

  test('reprovisions a stale credential only for the uniquely proxy-authenticated server', async () => {
    servers[0].connectorCredential = 'stale-encrypted-record';
    const socket = await connect(baseUrl);
    const response = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));

    await expect(response.then(([message]) => message)).resolves.toMatchObject({
      type: 'connector.provisioned', schemaVersion: 1, credential: expect.any(String),
    });
    expect(replaceServerConnectorCredential).toHaveBeenCalledWith('server-a', expect.stringMatching(/^v1:/));
    expect(claimServerConnectorCredential).not.toHaveBeenCalled();
  });

  test('authenticates the provisioned credential and accepts a bounded feature list', async () => {
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;

    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await expect(authenticated.then(([message]) => message)).resolves.toMatchObject({
      type: 'connector.authenticated', serverId: 'server-a',
    });

    const accepted = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: ['playerStatus', 'playerStatus'] }));
    await expect(accepted.then(([message]) => message)).resolves.toEqual({
      type: 'connector.features.accepted', schemaVersion: 1, events: ['playerStatus'],
    });
    socket.close();
  });

  test('accepts a previous encryption key once and re-encrypts the stored credential with the current key', async () => {
    const credential = 'rotating-credential';
    const previousCiphertext = encryptGameConnectorCredential(
      credential,
      'previous-connector-test-key-with-at-least-32-characters',
    );
    servers[0].connectorCredential = previousCiphertext;
    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));

    await expect(authenticated.then(([message]) => message)).resolves.toMatchObject({
      type: 'connector.authenticated', serverId: 'server-a',
    });
    expect(replaceServerConnectorCredentialIfCurrent).toHaveBeenCalledWith(
      'server-a', previousCiphertext, expect.stringMatching(/^v1:/),
    );
    expect(servers[0].connectorCredential).not.toBe(previousCiphertext);
    socket.close();
  });

  test('sends a reset command only to the authenticated server session', async () => {
    expect(requestGameConnectorCredentialReset('server-a')).toBe(false);
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;

    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;
    const reset = messages(socket, 1);
    expect(requestGameConnectorCredentialReset('server-a')).toBe(true);
    await expect(reset.then(([message]) => message)).resolves.toEqual({
      type: 'connector.reset', schemaVersion: 1, reason: 'native_route_unauthorized',
    });
    socket.close();
  });

  test('closes an authenticated connector that exceeds the bounded message rate', async () => {
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;
    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;

    const responses = messages(socket, 121);
    for (let index = 0; index <= 120; index += 1) {
      socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: [] }));
    }
    await expect(responses.then((messages) => messages.at(-1))).resolves.toEqual({
      type: 'error', schemaVersion: 1, code: 'rate_limited',
    });
  });

  test('delivers a player-status snapshot only after that feature was negotiated', async () => {
    const received = new Promise<{ serverId: string; event: string; data: unknown }>((resolve) => {
      registerGameConnectorEventHandler((serverId, event, data) => resolve({ serverId, event, data }));
    });
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;

    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;
    const accepted = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: ['playerStatus'] }));
    await accepted;
    const payload = { schemaVersion: 1, players: [{ uid: 'player-1', name: 'Alice', connected: true }] };
    socket.send(JSON.stringify({ type: 'connector.event', schemaVersion: 1, event: 'playerStatus', sequence: 1, data: payload }));

    await expect(received).resolves.toEqual({ serverId: 'server-a', event: 'playerStatus', data: payload });
    socket.close();
  });

  test('rejects replayed or unsequenced feature events', async () => {
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;
    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;
    const accepted = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: ['playerStatus'] }));
    await accepted;
    const error = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.event', schemaVersion: 1, event: 'playerStatus', sequence: 0, data: {} }));
    await expect(error).resolves.toEqual([{ type: 'error', schemaVersion: 1, code: 'invalid_message' }]);
  });

  test('removes a negotiated feature when the connector no longer advertises it', async () => {
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;
    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;
    const accepted = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: ['playerStatus'] }));
    await accepted;
    expect(hasActiveGameConnectorFeature('server-a', 'playerStatus')).toBe(true);
    const removed = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.features', schemaVersion: 1, events: [] }));
    await removed;
    expect(hasActiveGameConnectorFeature('server-a', 'playerStatus')).toBe(false);
  });

  test('cleans up a disconnected session and rejects a failed reconnect', async () => {
    const provision = await connect(baseUrl);
    const provisioned = messages(provision, 1);
    provision.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4255 }));
    const [{ credential }] = await provisioned;
    const socket = await connect(baseUrl);
    const authenticated = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential }));
    await authenticated;
    await new Promise<void>((resolve) => { socket.once('close', () => resolve()); socket.close(); });
    expect(requestGameConnectorCredentialReset('server-a')).toBe(false);

    const reconnect = await connect(baseUrl);
    const rejected = messages(reconnect, 1);
    reconnect.send(JSON.stringify({ type: 'connector.authenticate', schemaVersion: 1, credential: 'not-the-issued-credential' }));
    await expect(rejected).resolves.toEqual([{ type: 'error', schemaVersion: 1, code: 'unauthorized' }]);
  });
});

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { 'X-Real-IP': '203.0.113.7' } });
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
