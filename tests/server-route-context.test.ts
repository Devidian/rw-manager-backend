import { jest } from '@jest/globals';
import type { Request } from 'express';
import type { ServerConfig } from '../src/interfaces/server-config.js';

const findServerByIdMock = jest.fn<(id: string) => Promise<ServerConfig | undefined>>();
const ensurePluginDataForServerMock = jest.fn<(server: ServerConfig) => Promise<unknown>>();

jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  findServerById: findServerByIdMock,
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  ensurePluginDataForServer: ensurePluginDataForServerMock,
}));

const { prepareServerRoute, serverIdFromRequest, serverRouteError } = await import(
  '../src/handler/server-route-context.js'
);

describe('server route context', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('extracts optional server ids from route params', () => {
    expect(serverIdFromRequest({ params: {} } as Request)).toBeUndefined();
    expect(serverIdFromRequest({ params: { id: '   ' } } as unknown as Request)).toBeUndefined();
    expect(serverIdFromRequest({ params: { id: ['server-1'] } } as unknown as Request)).toBe('server-1');
    expect(serverIdFromRequest({ params: { id: 'server-2' } } as unknown as Request)).toBe('server-2');
  });

  test('prepares server route data and maps route errors', async () => {
    const server: ServerConfig = {
      id: 'server-1',
      label: 'Server',
      public: true,
      createdAt: new Date(),
    };
    findServerByIdMock.mockResolvedValueOnce(server);
    ensurePluginDataForServerMock.mockResolvedValueOnce(undefined);

    await expect(prepareServerRoute({ params: { id: 'server-1' } } as unknown as Request))
      .resolves.toBe(server);
    expect(ensurePluginDataForServerMock).toHaveBeenCalledWith(server);

    await expect(prepareServerRoute({ params: {} } as Request)).resolves.toBeUndefined();

    findServerByIdMock.mockResolvedValueOnce(undefined);
    await expect(prepareServerRoute({ params: { id: 'missing' } } as unknown as Request))
      .rejects.toThrow('SERVER_NOT_FOUND');

    expect(serverRouteError(new Error('SERVER_NOT_FOUND'))).toEqual({
      status: 404,
      error: 'server not found',
    });
    expect(serverRouteError(new Error('boom'))).toEqual({ status: 500, error: 'boom' });
    expect(serverRouteError('unknown')).toEqual({ status: 500, error: 'UNKNOWN_ERROR' });
  });
});
