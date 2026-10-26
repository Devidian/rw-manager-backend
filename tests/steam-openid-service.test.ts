import { jest } from '@jest/globals';
import { verifySteamOpenId } from '../src/service/steam-openid-service.js';
import type { SteamAuthRequest } from '../src/dto/steam-auth-request.js';

const originalOrigin = process.env.STEAM_OPENID_RETURN_ORIGIN;
const originalFetch = globalThis.fetch;

function assertion(): SteamAuthRequest {
  const id = 'https://steamcommunity.com/openid/id/76561198000000000';
  return {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': id,
    'openid.identity': id,
    'openid.return_to': 'https://manager.example/auth/steam/callback',
    'openid.response_nonce': `${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}test-${Math.random()}`,
    'openid.assoc_handle': 'test-association',
    'openid.signed': 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'test-signature',
  };
}

beforeEach(() => {
  process.env.STEAM_OPENID_RETURN_ORIGIN = 'https://manager.example';
});

afterEach(() => {
  if (originalOrigin === undefined) delete process.env.STEAM_OPENID_RETURN_ORIGIN;
  else process.env.STEAM_OPENID_RETURN_ORIGIN = originalOrigin;
  globalThis.fetch = originalFetch;
});

test('checks the Steam signature server-side and rejects a replay', async () => {
  const input = assertion();
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response('is_valid:true\n', { status: 200 }));
  globalThis.fetch = fetchMock;

  await expect(verifySteamOpenId(input)).resolves.toBe('76561198000000000');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe('https://steamcommunity.com/openid/login');
  const form = fetchMock.mock.calls[0][1]?.body as URLSearchParams;
  expect(form.get('openid.mode')).toBe('check_authentication');
  expect(form.get('openid.sig')).toBe('test-signature');
  await expect(verifySteamOpenId(input)).rejects.toThrow('OPEN_ID_INVALID');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test('rejects an unsigned identity, wrong return origin, stale nonce, and Steam denial', async () => {
  const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(new Response('is_valid:false\n', { status: 200 }));
  globalThis.fetch = fetchMock;

  const changedIdentity = assertion();
  changedIdentity['openid.identity'] = 'https://steamcommunity.com/openid/id/76561198000000001';
  await expect(verifySteamOpenId(changedIdentity)).rejects.toThrow('OPEN_ID_INVALID');

  const wrongOrigin = assertion();
  wrongOrigin['openid.return_to'] = 'https://attacker.example/auth/steam/callback';
  await expect(verifySteamOpenId(wrongOrigin)).rejects.toThrow('OPEN_ID_INVALID');

  const stale = assertion();
  stale['openid.response_nonce'] = '2020-01-01T00:00:00Zstale';
  await expect(verifySteamOpenId(stale)).rejects.toThrow('OPEN_ID_INVALID');

  expect(fetchMock).not.toHaveBeenCalled();
  await expect(verifySteamOpenId(assertion())).rejects.toThrow('OPEN_ID_INVALID');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
