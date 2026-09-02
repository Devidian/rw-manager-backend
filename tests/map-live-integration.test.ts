import http from 'node:http';
import { jest } from '@jest/globals';
import { WebSocket, type RawData } from 'ws';
import type { MapLiveSnapshot } from '../src/interfaces/map-layer.js';

const state = { forceAuth: false, snapshotCall: 0, refreshMode: 'normal' as 'normal' | 'none' | 'reject' | 'slow' };
const authState: { user: { steamId: string } | null } = { user: null };
let resolveSlowRefresh: (() => void) | undefined;
const findServerById = jest.fn(async (id: string) => id === 'missing' ? null : ({ id, queryUrl: 'http://query' }));
const getUserFromBearerToken = jest.fn(async () => authState.user);
const refreshPluginDataForServer = jest.fn(async () => {
  if (state.refreshMode === 'none') return {};
  if (state.refreshMode === 'reject') throw 'refresh failed';
  if (state.refreshMode === 'slow') await new Promise<void>((resolve) => { resolveSlowRefresh = resolve; });
  return { entry: {} };
});
const onlinePlayersFromEntry = jest.fn(() => undefined);
const publishServerLiveUpdate = jest.fn();
const mapLiveSnapshotFromEntry = jest.fn(() => state.snapshotCall++ === 0 ? snapshot() : changedSnapshot());

jest.unstable_mockModule('../src/db/manager-store.js', () => ({ findServerById }));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({ getUserFromBearerToken }));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  refreshPluginDataForServer,
  onlinePlayersFromEntry,
}));
jest.unstable_mockModule('../src/service/map-layer-service.js', () => ({ mapLiveSnapshotFromEntry }));
jest.unstable_mockModule('../src/service/server-live-status-service.js', () => ({
  storedLiveStatusResponse: jest.fn(() => ({ status: 'online', lastChecked: '2026-08-04T10:00:00.000Z' })),
}));
jest.unstable_mockModule('../src/service/server-live-update-service.js', () => ({
  publishServerLiveUpdate,
}));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: {
    get enableAuth() { return state.forceAuth; },
    get forceAuth() { return state.forceAuth; },
    mapLiveRefreshIntervalMs: 15,
  },
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: { debug: jest.fn(), error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

const { attachMapLiveService } = await import('../src/service/map-live-service.js');

describe('map live endpoint integration', () => {
  let server: http.Server;
  let closeLive: (() => void) | undefined;
  let baseUrl: string;

  beforeEach(async () => {
    state.forceAuth = false;
    state.snapshotCall = 0;
    state.refreshMode = 'normal';
    authState.user = null;
    resolveSlowRefresh = undefined;
    onlinePlayersFromEntry.mockReturnValue(undefined);
    server = http.createServer((_request, response) => response.end('ok'));
    closeLive = attachMapLiveService(server).close;
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing test server address');
    baseUrl = `ws://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    closeLive?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    jest.clearAllMocks();
  });

  test('keeps one server-scoped refresh loop and emits entity deltas', async () => {
    const socket = await connect(`${baseUrl}/api/storage/map-live`);
    const subscribedMessage = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'server-a' }));
    const [subscribed] = await subscribedMessage;
    expect(subscribed).toMatchObject({ type: 'subscribed', serverId: 'server-a' });

    const changedMessage = messages(socket, 1);
    const second = await connect(`${baseUrl}/api/storage/map-live`);
    const secondSubscribed = messages(second, 1);
    second.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'server-a' }));
    await secondSubscribed;
    const [changed] = await changedMessage;
    expect(changed).toMatchObject({
      type: 'map.layers.changed', serverId: 'server-a', sequence: 1,
      layers: expect.arrayContaining(['players', 'claims']),
    });
    expect(refreshPluginDataForServer).toHaveBeenCalled();
    second.close();
    socket.close();
  });

  test('publishes fresh bridge presence to server-status subscribers', async () => {
    onlinePlayersFromEntry.mockReturnValue([{ uid: 'live-player', name: 'Live' }]);
    const socket = await connect(`${baseUrl}/api/storage/map-live`);
    const subscribedMessage = messages(socket, 1);
    socket.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'server-a' }));
    await subscribedMessage;

    await waitUntil(() => publishServerLiveUpdate.mock.calls.length > 0);
    expect(publishServerLiveUpdate).toHaveBeenCalledWith(
      'server-a',
      expect.objectContaining({ onlinePlayers: [{ uid: 'live-player', name: 'Live', online: true }] }),
    );
    socket.close();
  });

  test('rejects unknown servers and missing authentication', async () => {
    const missing = await connect(`${baseUrl}/api/storage/map-live`);
    const missingResult = messages(missing, 1);
    missing.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'missing' }));
    await expect(missingResult.then(([message]) => message)).resolves.toMatchObject({
      type: 'error', code: 'server_not_found',
    });

    state.forceAuth = true;
    const unauthorized = await connect(`${baseUrl}/api/storage/map-live`);
    const unauthorizedResult = messages(unauthorized, 1);
    unauthorized.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'server-a' }));
    await expect(unauthorizedResult.then(([message]) => message)).resolves.toMatchObject({
      type: 'error', code: 'unauthorized',
    });

    state.forceAuth = false;
    authState.user = { steamId: 'steam-admin' };
    const authenticated = await connect(`${baseUrl}/api/storage/map-live`);
    const authenticatedResult = messages(authenticated, 1);
    authenticated.send(JSON.stringify({
      type: 'subscribe', schemaVersion: 1, serverId: 'server-a', token: 'valid',
    }));
    await expect(authenticatedResult.then(([message]) => message)).resolves.toMatchObject({
      type: 'subscribed', serverId: 'server-a',
    });
    authenticated.close();
  });

  test('handles empty, failed, and subscriber-less refresh completions', async () => {
    state.refreshMode = 'none';
    const noEntry = await connect(`${baseUrl}/api/storage/map-live`);
    const noEntrySubscribed = messages(noEntry, 1);
    noEntry.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'no-entry' }));
    await noEntrySubscribed;
    await delay(20);
    noEntry.close();

    state.refreshMode = 'reject';
    const rejected = await connect(`${baseUrl}/api/storage/map-live`);
    const rejectedSubscribed = messages(rejected, 1);
    rejected.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'rejected' }));
    await rejectedSubscribed;
    await delay(5);
    rejected.close();

    state.refreshMode = 'slow';
    const slow = await connect(`${baseUrl}/api/storage/map-live`);
    const slowSubscribed = messages(slow, 1);
    slow.send(JSON.stringify({ type: 'subscribe', schemaVersion: 1, serverId: 'slow' }));
    await slowSubscribed;
    await waitUntil(() => resolveSlowRefresh !== undefined);
    slow.close();
    await new Promise<void>((resolve) => slow.once('close', () => resolve()));
    resolveSlowRefresh?.();
    await delay(5);
  });
});

function snapshot(): MapLiveSnapshot {
  return {
    capabilities: capabilities(),
    claims: [{
      areaId: 1, name: 'Claim', permission: 'guest', minX: 0, minZ: 0, width: 32, depth: 32,
      borderColor: '#FFFFFFFF', fillColor: '#FFFFFF50', forSale: false, renewZone: false,
      marketplace: false, shop: false,
    }],
    players: [{ id: 'one', name: 'One', x: 1, z: 2, state: 'online', lastSeen: '2026-08-03T12:00:00.000Z' }],
    gpsGlobalMarkers: [],
    marketplaceOffers: {},
  };
}

function changedSnapshot(): MapLiveSnapshot {
  return {
    ...snapshot(),
    claims: [],
    players: [{ id: 'one', name: 'One', x: 3, z: 4, state: 'online', lastSeen: '2026-08-03T12:01:00.000Z' }],
  };
}

function capabilities(): MapLiveSnapshot['capabilities'] {
  return {
    schemaVersion: 1, worldName: 'World', sectorSizeChunks: 256, chunkSizeBlocks: 32,
    sectorSizeBlocks: 8192, recentPlayerDays: 30, claims: true, claimSales: false,
    renewZones: false, marketplace: false, shop: false, players: true, gpsGlobalMarkers: false,
  };
}

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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await delay(2);
  }
  throw new Error('condition not reached');
}
