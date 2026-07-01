import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';

const findServerByIdMock = jest.fn<(id: string) => Promise<ServerConfig | undefined>>();
const getServerMapMock = jest.fn<(
  tileRoot?: string,
  worldName?: string,
  serverId?: string,
  publicTileRootUrl?: string,
) => Promise<unknown>>();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: findServerByIdMock,
}));
jest.unstable_mockModule('../src/service/map-service.js', () => ({
  getServerMap: getServerMapMock,
}));

const { getStoredServerMap } = await import('../src/service/server-map-service.js');

describe('server map service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getServerMapMock.mockResolvedValue({ available: false });
  });

  test('loads stored server map metadata with normalized public tile URL', async () => {
    findServerByIdMock.mockResolvedValue({
      id: 'server-1',
      label: 'Server',
      public: true,
      createdAt: new Date(),
      mapUrl: 'https://tiles.example/maps',
    });

    await expect(getStoredServerMap('server-1')).resolves.toEqual({ available: false });
    expect(getServerMapMock).toHaveBeenCalledWith(
      undefined,
      undefined,
      'server-1',
      'https://tiles.example/maps',
    );
  });

  test('ignores missing or malformed public tile URLs and reports missing servers', async () => {
    findServerByIdMock.mockResolvedValueOnce({
      id: 'server-no-map-url',
      label: 'Server',
      public: true,
      createdAt: new Date(),
    });

    await getStoredServerMap('server-no-map-url');
    expect(getServerMapMock).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      'server-no-map-url',
      undefined,
    );

    findServerByIdMock.mockResolvedValueOnce({
      id: 'server-2',
      label: 'Server',
      public: true,
      createdAt: new Date(),
      mapUrl: 'not a url',
    });

    await getStoredServerMap('server-2');
    expect(getServerMapMock).toHaveBeenLastCalledWith(
      undefined,
      undefined,
      'server-2',
      undefined,
    );

    findServerByIdMock.mockResolvedValueOnce(undefined);
    await expect(getStoredServerMap('missing')).rejects.toThrow('SERVER_NOT_FOUND');
  });
});
