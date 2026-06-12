import { jest } from '@jest/globals';
import type { Request, Response } from 'express';
import type { GetServerMapResponse } from '../src/dto/get-server-map-response.js';
import type { PluginInfo } from '../src/interfaces/plugin-info.js';

const listInstalledPluginsMock =
  jest.fn<() => Promise<PluginInfo[]>>();
const getServerMapMock = jest.fn<() => Promise<GetServerMapResponse>>();
const resolveMapTileMock =
  jest.fn<() => Promise<string | null>>();

class InvalidMapTileRequestError extends Error {}

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/plugin-inventory-service.js', () => ({
  listInstalledPlugins: listInstalledPluginsMock,
}));
jest.unstable_mockModule('../src/service/map-service.js', () => ({
  InvalidMapTileRequestError,
  getServerMap: getServerMapMock,
  resolveMapTile: resolveMapTileMock,
}));

const { listServerPluginsHandler } = await import(
  '../src/handler/list-server-plugins-handler.js'
);
const { getServerMapHandler } = await import(
  '../src/handler/get-server-map-handler.js'
);
const { getServerMapTileHandler } = await import(
  '../src/handler/get-server-map-tile-handler.js'
);

describe('map and plugin handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('plugin handler returns inventory and handles service errors', async () => {
    const response = createResponse();
    listInstalledPluginsMock.mockResolvedValue([
      { directory: 'OZAdminUtils', valid: true },
    ]);

    await listServerPluginsHandler({} as Request, response.res);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.json).toHaveBeenCalledWith({
      items: [{ directory: 'OZAdminUtils', valid: true }],
    });

    listInstalledPluginsMock.mockRejectedValue(new Error('inventory failed'));
    await listServerPluginsHandler({} as Request, response.res);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'inventory failed' });

    listInstalledPluginsMock.mockRejectedValue('unknown');
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

  test('tile handler serves PNGs and returns missing or invalid responses', async () => {
    const response = createResponse();
    resolveMapTileMock.mockResolvedValue('/tmp/map.png');

    await getServerMapTileHandler(request('0.png'), response.res);
    expect(response.type).toHaveBeenCalledWith('png');
    expect(response.sendFile).toHaveBeenCalledWith('/tmp/map.png');

    resolveMapTileMock.mockResolvedValue(null);
    await getServerMapTileHandler(request('1.png'), response.res);
    expect(response.sendStatus).toHaveBeenCalledWith(404);

    await getServerMapTileHandler(request('0.jpg'), response.res);
    expect(response.status).toHaveBeenCalledWith(400);
  });

  test('tile handler distinguishes invalid requests from server errors', async () => {
    const response = createResponse();
    resolveMapTileMock.mockRejectedValue(
      new InvalidMapTileRequestError('bad tile'),
    );
    await getServerMapTileHandler(request('0.png'), response.res);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({ error: 'bad tile' });

    resolveMapTileMock.mockRejectedValue(new Error('read failed'));
    await getServerMapTileHandler(request('0.png'), response.res);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({ error: 'read failed' });

    resolveMapTileMock.mockRejectedValue('unknown');
    await getServerMapTileHandler(request('0.png'), response.res);
    expect(response.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });
});

function request(fileName: string) {
  return {
    params: { worldKey: 'new-world', z: '8', x: '0', fileName },
  } as unknown as Request<{
    worldKey: string;
    z: string;
    x: string;
    fileName: string;
  }>;
}

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    json: jest.fn(),
    status: jest.fn(),
    sendStatus: jest.fn(),
    type: jest.fn(),
    sendFile: jest.fn(),
  };
  for (const method of Object.values(response)) {
    method.mockReturnValue(response);
  }
  return { ...response, res: response as unknown as Response };
}
