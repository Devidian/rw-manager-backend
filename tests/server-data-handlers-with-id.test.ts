import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const serverIdFromRequestMock = jest.fn<() => string | undefined>();
const prepareServerRouteMock = jest.fn<() => Promise<{ id: string } | null>>();
const serverRouteErrorMock = jest.fn<(error: unknown) => { status: number; error: string }>();
const getCachedServerConfigMock = jest.fn<(serverId?: string) => Record<string, unknown>>();
const getCachedServerAdminListMock = jest.fn<(serverId?: string) => string[]>();
const getCachedPluginDataMock = jest.fn<(serverId: string) => { plugins?: unknown[] } | undefined>();
const getFirstCachedPluginDataMock = jest.fn<() => { plugins?: unknown[] } | undefined>();
const getStoredServerMapMock = jest.fn<(serverId: string) => Promise<unknown>>();
const getServerMapMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/handler/server-route-context.js', () => ({
  serverIdFromRequest: serverIdFromRequestMock,
  prepareServerRoute: prepareServerRouteMock,
  serverRouteError: serverRouteErrorMock,
}));
jest.unstable_mockModule('../src/service/server-plugin-data-service.js', () => ({
  getCachedServerConfig: getCachedServerConfigMock,
  getCachedServerAdminList: getCachedServerAdminListMock,
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  getCachedPluginData: getCachedPluginDataMock,
  getFirstCachedPluginData: getFirstCachedPluginDataMock,
}));
jest.unstable_mockModule('../src/service/server-map-service.js', () => ({
  getStoredServerMap: getStoredServerMapMock,
}));
jest.unstable_mockModule('../src/service/map-service.js', () => ({
  getServerMap: getServerMapMock,
}));

const { getServerConfigHandler } = await import('../src/handler/get-server-config-handler.js');
const { getServerAdminListHandler } = await import('../src/handler/get-server-admin-list-handler.js');
const { listServerPluginsHandler } = await import('../src/handler/list-server-plugins-handler.js');
const { getServerMapHandler } = await import('../src/handler/get-server-map-handler.js');

describe('server data handlers with server id routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    serverIdFromRequestMock.mockReturnValue('server-1');
    prepareServerRouteMock.mockResolvedValue({ id: 'server-1' });
    serverRouteErrorMock.mockImplementation((error) => (
      error && typeof error === 'object' && 'status' in error && 'error' in error
        ? error as { status: number; error: string }
        : { status: 500, error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }
    ));
    getCachedServerConfigMock.mockReturnValue({ Server_Name: 'OZ' });
    getCachedServerAdminListMock.mockReturnValue(['steam-admin']);
    getCachedPluginDataMock.mockReturnValue({
      plugins: [
        { directory: 'OZShop', name: 'Shop', version: '1.0.0', valid: true },
        { directory: 42, name: 'bad' },
      ],
    });
    getFirstCachedPluginDataMock.mockReturnValue({ plugins: [] });
    getStoredServerMapMock.mockResolvedValue({ schemaVersion: 6 });
    getServerMapMock.mockResolvedValue({ schemaVersion: 6 });
  });

  test('uses route server ids for config, admin list, plugin list, and map handlers', async () => {
    const configResponse = createResponse();
    await getServerConfigHandler(request(), configResponse.res);
    expect(prepareServerRouteMock).toHaveBeenCalledTimes(1);
    expect(getCachedServerConfigMock).toHaveBeenCalledWith('server-1');
    expect(configResponse.json).toHaveBeenCalledWith({ config: { Server_Name: 'OZ' } });

    const adminResponse = createResponse();
    await getServerAdminListHandler(request(), adminResponse.res);
    expect(getCachedServerAdminListMock).toHaveBeenCalledWith('server-1');
    expect(adminResponse.json).toHaveBeenCalledWith({ admins: ['steam-admin'] });

    const pluginsResponse = createResponse();
    await listServerPluginsHandler(request(), pluginsResponse.res);
    expect(getCachedPluginDataMock).toHaveBeenCalledWith('server-1');
    expect(getFirstCachedPluginDataMock).not.toHaveBeenCalled();
    expect(pluginsResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(pluginsResponse.json).toHaveBeenCalledWith({
      items: [{ directory: 'OZShop', name: 'Shop', version: '1.0.0', valid: true }],
    });

    const mapResponse = createResponse();
    await getServerMapHandler(request(), mapResponse.res);
    expect(getStoredServerMapMock).toHaveBeenCalledWith('server-1');
    expect(getServerMapMock).not.toHaveBeenCalled();
    expect(mapResponse.json).toHaveBeenCalledWith({ schemaVersion: 6 });
  });

  test('maps route errors without calling server data services', async () => {
    prepareServerRouteMock.mockRejectedValueOnce({ status: 404, error: 'Server not found' });

    const response = createResponse();
    await getServerConfigHandler(request(), response.res);

    expect(getCachedServerConfigMock).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ error: 'Server not found' });
  });

  test('lists plugins from the first cache entry when no server route is selected', async () => {
    prepareServerRouteMock.mockResolvedValueOnce(null);
    getFirstCachedPluginDataMock.mockReturnValueOnce({
      plugins: [{ directory: 'OZGPS', name: 'GPS', version: '1.0.0', valid: true }],
    });

    const response = createResponse();
    await listServerPluginsHandler(request(), response.res);

    expect(getCachedPluginDataMock).not.toHaveBeenCalled();
    expect(getFirstCachedPluginDataMock).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({
      items: [{ directory: 'OZGPS', name: 'GPS', version: '1.0.0', valid: true }],
    });
  });
});

function request() {
  return {
    params: { serverId: 'server-1' },
  } as unknown as Request;
}

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
