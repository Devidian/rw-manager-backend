import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';
const warn = jest.fn();
jest.unstable_mockModule('../src/utils/logger.js', () => ({ defaultLogger: { warn } }));
const { fetchNativePluginJson, resetNativePluginAccess } = await import('../src/service/native-plugin-request-service.js');
const server = { id: 'access-test', label: 'Example', queryUrl: 'https://game.example', public: true, createdAt: new Date() } as ServerConfig;
const originalFetch = global.fetch;
const route = 'https://game.example/plugins/example/info';
afterEach(() => { global.fetch = originalFetch; resetNativePluginAccess(server.id); resetNativePluginAccess('other'); warn.mockClear(); jest.restoreAllMocks(); });

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
