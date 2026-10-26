import { jest } from '@jest/globals';
import { getSteamPersonaName } from '../src/service/steam-profile-service.js';

const originalKey = process.env.STEAM_API_KEY;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalKey === undefined) delete process.env.STEAM_API_KEY;
  else process.env.STEAM_API_KEY = originalKey;
  globalThis.fetch = originalFetch;
});

test('keeps the Steam key server-side and accepts only the requested player', async () => {
  process.env.STEAM_API_KEY = 'server-only-test-key';
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    response: { players: [{ steamid: '76561198000000000', personaname: ' Steam Alice ' }] },
  }), { status: 200 }));
  globalThis.fetch = fetchMock;

  await expect(getSteamPersonaName('76561198000000000')).resolves.toBe('Steam Alice');
  const url = new URL(String(fetchMock.mock.calls[0][0]));
  expect(url.host).toBe('api.steampowered.com');
  expect(url.searchParams.get('steamids')).toBe('76561198000000000');
  expect(url.searchParams.get('key')).toBe('server-only-test-key');
  expect(fetchMock.mock.calls[0][1]).toEqual({ signal: expect.any(AbortSignal) });

  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
    response: { players: [{ steamid: '76561198000000001', personaname: 'Wrong player' }] },
  }), { status: 200 }));
  await expect(getSteamPersonaName('76561198000000000')).resolves.toBeUndefined();
});

test('keeps login usable without a key or when Steam fails', async () => {
  delete process.env.STEAM_API_KEY;
  const fetchMock = jest.fn<typeof fetch>().mockRejectedValue(new Error('unavailable'));
  globalThis.fetch = fetchMock;
  await expect(getSteamPersonaName('76561198000000000')).resolves.toBeUndefined();
  await expect(getSteamPersonaName('invalid')).resolves.toBeUndefined();
  expect(fetchMock).not.toHaveBeenCalled();

  process.env.STEAM_API_KEY = 'server-only-test-key';
  await expect(getSteamPersonaName('76561198000000000')).resolves.toBeUndefined();
});
