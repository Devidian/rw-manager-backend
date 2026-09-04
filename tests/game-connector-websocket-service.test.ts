import http from 'node:http';
import { jest } from '@jest/globals';
import { WebSocket, type RawData } from 'ws';

const servers: Array<Record<string, unknown>> = [{ id: 'server-a', ip: '203.0.113.7', port: 4255 }];
const listServers = jest.fn(async () => servers);
const saveServer = jest.fn(async () => undefined);

jest.unstable_mockModule('../src/db/manager-store.js', () => ({ listServers, saveServer }));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: {
    gameConnectorCredentialKey: 'connector-test-key-with-at-least-32-characters',
    gameConnectorTrustedProxyIps: ['127.0.0.1'],
  },
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: { debug: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { attachGameConnectorWebSocketService, registerGameConnectorEventHandler } = await import('../src/service/game-connector-websocket-service.js');

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
    expect(saveServer).toHaveBeenCalledWith(expect.objectContaining({ id: 'server-a', connectorCredential: expect.stringMatching(/^v1:/) }));
  });

  test('rejects a claimed game port that is not in the proxy-authenticated server catalog', async () => {
    const socket = await connect(baseUrl);
    const response = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'connector.provision', schemaVersion: 1, gamePort: 4256 }));

    await expect(response.then(([message]) => message)).resolves.toEqual({
      type: 'error', schemaVersion: 1, code: 'server_not_found',
    });
    expect(saveServer).not.toHaveBeenCalled();
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
    socket.send(JSON.stringify({ type: 'connector.event', schemaVersion: 1, event: 'playerStatus', data: payload }));

    await expect(received).resolves.toEqual({ serverId: 'server-a', event: 'playerStatus', data: payload });
    socket.close();
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
