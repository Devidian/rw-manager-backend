import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';
const warn = jest.fn();
const resetServerConnectorCredential = jest.fn(async () => true);
const requestGameConnectorCredentialReset = jest.fn(() => false);
jest.unstable_mockModule('../src/utils/logger.js', () => ({ defaultLogger: { warn } }));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ resetServerConnectorCredential }));
jest.unstable_mockModule('../src/service/game-connector-websocket-service.js', () => ({ requestGameConnectorCredentialReset }));
jest.unstable_mockModule('../src/service/game-connector-credential-service.js', () => ({
  gameConnectorAuthorizationHeader: (entry: { connectorCredential?: string }) => entry.connectorCredential ? 'Bearer test' : undefined,
}));
const { fetchNativePluginJson, resetNativePluginAccess } = await import('../src/service/native-plugin-request-service.js');
const server = { id: 'access-test', label: 'Example', queryUrl: 'https://game.example', public: true, createdAt: new Date() } as ServerConfig;
const originalFetch = global.fetch;
const route = 'https://game.example/plugins/example/info';
afterEach(() => {
  global.fetch = originalFetch;
  resetNativePluginAccess(server.id);
  resetNativePluginAccess('other');
  warn.mockClear();
  resetServerConnectorCredential.mockClear();
  requestGameConnectorCredentialReset.mockReset().mockReturnValue(false);
  jest.restoreAllMocks();
});

test('one 401 pauses sibling and subsequent protected requests and logs server context without secrets', async () => {
  const fetch = jest.fn<typeof global.fetch>().mockResolvedValue(new Response('', { status: 401 }));
  global.fetch = fetch;
  await Promise.all([fetchNativePluginJson(server, route), fetchNativePluginJson(server, route + '/other')]);
  await fetchNativePluginJson(server, route);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ serverId: 'access-test', serverName: 'Example', host: 'game.example', status: 401, retryAfterMs: 300000 }));
  await fetchNativePluginJson({ ...server, id: 'other' }, route);
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('credential replacement and successful reconnect each permit an immediate retry', async () => {
  const fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => new Response('', { status: 401 }));
  global.fetch = fetch;
  await fetchNativePluginJson(server, route);
  await fetchNativePluginJson({ ...server, connectorCredential: 'new-encrypted-record' }, route);
  expect(fetch).toHaveBeenCalledTimes(2);
  resetNativePluginAccess(server.id);
  await fetchNativePluginJson(server, route);
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('resets only a rejected credential when that server has an authenticated connector session', async () => {
  const paired = { ...server, connectorCredential: 'encrypted-old-record' };
  requestGameConnectorCredentialReset.mockReturnValue(true);
  global.fetch = jest.fn<typeof global.fetch>().mockResolvedValue(new Response('', { status: 401 }));

  await fetchNativePluginJson(paired, route);

  expect(requestGameConnectorCredentialReset).toHaveBeenCalledWith('access-test');
  expect(resetServerConnectorCredential).toHaveBeenCalledWith('access-test', 'encrypted-old-record');
  expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ recoveryRequested: true }));
});

test('backoff probes after five minutes and doubles on continued rejection', async () => {
  let now = 1000000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  global.fetch = jest.fn<typeof global.fetch>().mockImplementation(async () => new Response('', { status: 401 }));
  await fetchNativePluginJson(server, route);
  now += 300000;
  await fetchNativePluginJson(server, route);
  expect(warn).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ retryAfterMs: 600000 }));
  now += 300000;
  await fetchNativePluginJson(server, route);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
