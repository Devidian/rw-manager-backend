import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';

const features = new Set<string>();
jest.unstable_mockModule('../src/service/game-connector-websocket-service.js', () => ({
  hasActiveGameConnectorFeature: (_id: string, feature: string) => features.has(feature),
}));
const service = await import('../src/service/public-online-player-service.js');
const server: ServerConfig = { id: 'server', label: 'Server', queryUrl: 'https://game.example/query/',
  public: true, createdAt: new Date(), status: 'online' };
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;

beforeEach(() => {
  features.clear();
  service.clearPublicPlayerCount(server.id);
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  jest.restoreAllMocks();
});

test('shares an in-flight fallback and ignores offline, empty, and malformed rows', async () => {
  const players = [null, false, {}, { name: 7 }, { name: ' ' }, { name: 'Gone', connected: false },
    { name: ' Ada ', uid: 'does not leave this function' }];
  fetchMock.mockResolvedValue(Response.json({ players }));
  await expect(Promise.all([service.readPublicOnlinePlayerNames(server), service.readPublicOnlinePlayerNames(server)]))
    .resolves.toEqual([['Ada'], ['Ada']]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://game.example/query/playerlist');
});

test.each([null, {}, { players: {} }, { players: Array(1001).fill({ name: 'Ada' }) }])(
  'does not turn an unsupported payload into an online count', async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(service.refreshPublicPlayerCount(server)).resolves.toBeUndefined();
    expect(service.cachedPublicPlayerCount(server)).toBeUndefined();
  },
);

test('drops an expired cache entry or one for an old query URL', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
  fetchMock.mockImplementation(async () => Response.json({ players: [{ name: 'Ada' }] }));
  await expect(service.refreshPublicPlayerCount(server)).resolves.toBe(1);
  await expect(service.refreshPublicPlayerCount(server)).resolves.toBe(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(service.cachedPublicPlayerCount({ ...server, queryUrl: 'https://other.example/' })).toBeUndefined();
  await expect(service.refreshPublicPlayerCount(server)).resolves.toBe(1);
  now.mockReturnValue(86_400_000);
  expect(service.cachedPublicPlayerCount(server)).toBeUndefined();
});

test('does not fetch for blocked or offline servers, missing URLs, or active consent-aware connectors', async () => {
  await expect(service.refreshPublicPlayerCount({ ...server, queryUrl: '' })).resolves.toBeUndefined();
  await expect(service.readPublicOnlinePlayerNames({ ...server, queryUrl: '' })).resolves.toBeNull();
  await expect(service.refreshPublicPlayerCount({ ...server, blocked: true })).resolves.toBeUndefined();
  await expect(service.refreshPublicPlayerCount({ ...server, status: 'offline' })).resolves.toBeUndefined();
  features.add('playerStatus');
  features.add('playerConsentRevoked');
  await expect(service.refreshPublicPlayerCount(server)).resolves.toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('does not cache a public count when the live plugin takes over during the fetch', async () => {
  fetchMock.mockImplementationOnce(async () => {
    features.add('playerStatus');
    features.add('playerConsentRevoked');
    return Response.json({ players: [{ name: 'Ada' }] });
  });
  await expect(service.refreshPublicPlayerCount(server)).resolves.toBeUndefined();
  expect(service.cachedPublicPlayerCount(server)).toBeUndefined();
});

test('falls back after network or HTTP errors and retries on the next call', async () => {
  fetchMock.mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(Response.json({ players: [] }));
  await expect(service.readPublicOnlinePlayerNames(server)).resolves.toBeNull();
  await expect(service.readPublicOnlinePlayerNames(server)).resolves.toBeNull();
  await expect(service.readPublicOnlinePlayerNames(server)).resolves.toEqual([]);
});
