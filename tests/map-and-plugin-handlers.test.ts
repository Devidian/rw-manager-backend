import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { GetServerMapResponse } from '../src/dto/get-server-map-response.js';
import type { PluginInfo } from '../src/interfaces/plugin-info.js';

const getFirstCachedPluginDataMock =
  jest.fn<() => { plugins: PluginInfo[] } | undefined>();
const getCachedPluginDataMock =
  jest.fn<() => { plugins: PluginInfo[] } | undefined>();
const getServerMapMock = jest.fn<() => Promise<GetServerMapResponse>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  getCachedPluginData: getCachedPluginDataMock,
  getFirstCachedPluginData: getFirstCachedPluginDataMock,
}));
jest.unstable_mockModule('../src/service/map-service.js', () => ({
  getServerMap: getServerMapMock,
}));

const { listServerPluginsHandler } = await import(
  '../src/handler/list-server-plugins-handler.js'
);
const { getServerMapHandler } = await import(
  '../src/handler/get-server-map-handler.js'
);
describe('map and plugin handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('plugin handler returns inventory and handles service errors', async () => {
    const response = createResponse();
    getFirstCachedPluginDataMock.mockReturnValue({
      plugins: [{ name: 'OZ - Admin Utils', valid: true }],
    });

    await listServerPluginsHandler({} as Request, response.res);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({
      available: true,
      items: [{ name: 'OZ - Admin Utils', valid: true }],
    });

    getFirstCachedPluginDataMock.mockImplementationOnce(() => {
      throw new Error('inventory failed');
    });
    await listServerPluginsHandler({} as Request, response.res);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'inventory failed' });

    getFirstCachedPluginDataMock.mockImplementationOnce(() => {
      throw 'unknown';
    });
    await listServerPluginsHandler({} as Request, response.res);
    expect(response.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });

  test('map handler returns availability and handles service errors', async () => {
    const response = createResponse();
    getServerMapMock.mockResolvedValue({ available: false });

    await getServerMapHandler({} as Request, response.res);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({ available: false });

    getServerMapMock.mockRejectedValue(new Error('map failed'));
    await getServerMapHandler({} as Request, response.res);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'map failed' });

    getServerMapMock.mockRejectedValue('unknown');
    await getServerMapHandler({} as Request, response.res);
    expect(response.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });

});

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) {
    method.mockReturnValue(response);
  }
  return { ...response, res: response as unknown as Response };
}
