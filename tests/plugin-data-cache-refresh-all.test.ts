import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';

const listServersMock = jest.fn<() => Promise<ServerConfig[]>>();
const updateServerMock = jest.fn();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  listServers: listServersMock,
  updateServer: updateServerMock,
}));
jest.unstable_mockModule('../src/utils/app-config.js', () => ({
  AppConfig: {
    liveQueryProxyTimeoutMs: 8000,
    pluginDataCacheTtlMs: 300000,
  },
}));
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: {
    warn: jest.fn(),
  },
}));

const { refreshPluginDataForOnlineServers, clearPluginDataCache } = await import(
  '../src/service/plugin-data-cache-service.js'
);

describe('plugin data cache refresh for online servers', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearPluginDataCache();
    jest.clearAllMocks();
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/pluginlist')) {
        return response({
          plugins: [
            { name: 'OZ - Admin Utils', version: 'Version: 1.0.0' },
          ],
        });
      }
      return response({});
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('counts refreshed and skipped servers from the manager store', async () => {
    listServersMock.mockResolvedValue([
      server('server-1', 'https://query.example/server-1/'),
      server('server-2', undefined),
    ]);

    await expect(refreshPluginDataForOnlineServers()).resolves.toEqual({
      checked: 2,
      refreshed: 1,
      skipped: 1,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://query.example/server-1/pluginlist',
      expect.any(Object),
    );
  });
});

function server(id: string, queryUrl: string | undefined): ServerConfig {
  return {
    id,
    name: id,
    address: '127.0.0.1',
    port: 4255,
    queryUrl,
    status: 'online',
  } as ServerConfig;
}

function response(payload: unknown): Response {
  return {
    ok: true,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}
