import { jest } from '@jest/globals';
import type { Request, Response as ExpressResponse } from 'express';

const findServerByIdMock = jest.fn();
const fetchMock = jest.fn<typeof fetch>();
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ findServerById: findServerByIdMock }));
const features = new Set<string>();
jest.unstable_mockModule('../src/service/game-connector-websocket-service.js', () => ({
  hasActiveGameConnectorFeature: (_serverId: string, feature: string) => features.has(feature),
}));
const { getGuestOnlinePlayersHandler } = await import('../src/handler/get-guest-online-players-handler.js');

describe('guest online players', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    features.clear();
    globalThis.fetch = fetchMock;
    findServerByIdMock.mockReset().mockResolvedValue({ id: 'server-1', queryUrl: 'https://game.example/query' });
    fetchMock.mockReset().mockImplementation(async () => Response.json({ players: [
      { name: 'Alice', uid: 'private-uid', health: 100 },
      { name: 'Bob', connected: true, dbId: 7 },
      { name: 'Gone', connected: false },
    ] }));
  });
  afterAll(() => { globalThis.fetch = originalFetch; });

  test('fetches the game playerlist and returns names and count only', async () => {
    const payload = jest.fn();
    const headers = jest.fn();
    const response = { json: payload, setHeader: headers, status: jest.fn() } as unknown as ExpressResponse;
    await getGuestOnlinePlayersHandler({ params: { id: 'server-1' } } as unknown as Request, response);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://game.example/query/playerlist');
    expect(payload).toHaveBeenCalledWith({ names: ['Alice', 'Bob'], count: 2 });
    expect(headers).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  test('only suppresses the public fallback for a consent-aware connector', async () => {
    features.add('playerStatus');
    const json = jest.fn();
    const status = jest.fn();
    const end = jest.fn();
    status.mockReturnValue({ end });
    const response = { json, setHeader: jest.fn(), status } as unknown as ExpressResponse;
    const req = { params: { id: 'server-1' }, query: { fallback: '1' } } as unknown as Request;
    await getGuestOnlinePlayersHandler(req, response);
    expect(json).toHaveBeenCalledWith({ names: ['Alice', 'Bob'], count: 2 });

    features.add('playerConsentRevoked');
    fetchMock.mockClear();
    await getGuestOnlinePlayersHandler(req, response);
    expect(status).toHaveBeenCalledWith(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

});
