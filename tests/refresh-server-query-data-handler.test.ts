import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const refreshMasterServerListMock = jest.fn<(options?: { refreshQueryData?: boolean }) => Promise<unknown>>();
const listServersMock = jest.fn<() => Promise<unknown[]>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/master-server-list-service.js', () => ({
  refreshMasterServerList: refreshMasterServerListMock,
}));
jest.unstable_mockModule('../src/service/storage-service.js', () => ({
  listServers: listServersMock,
}));

const { refreshServerQueryDataHandler } = await import(
  '../src/handler/refresh-server-query-data-handler.js'
);

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('refresh-server-query-data-handler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.SUPER_ADMIN_ID = 'steam-admin';
    refreshMasterServerListMock.mockReset().mockResolvedValue({ updated: 1 });
    listServersMock.mockReset().mockResolvedValue([{ id: 'server-1' }]);
  });

  afterAll(() => {
    restoreEnv(originalEnv);
  });

  test('rejects missing and non-superadmin users', async () => {
    const missingUserResponse = createResponse();
    await refreshServerQueryDataHandler(request(), missingUserResponse.res);
    expect(missingUserResponse.status).toHaveBeenCalledWith(403);
    expect(refreshMasterServerListMock).not.toHaveBeenCalled();

    const regularUserResponse = createResponse();
    await refreshServerQueryDataHandler(
      request({ steamId: 'regular-user' }),
      regularUserResponse.res,
    );
    expect(regularUserResponse.status).toHaveBeenCalledWith(403);
    expect(refreshMasterServerListMock).not.toHaveBeenCalled();
  });

  test('allows the configured superadmin to refresh query data', async () => {
    const response = createResponse();
    await refreshServerQueryDataHandler(request({ id: 'user-1', steamId: 'steam-admin' }), response.res);

    expect(refreshMasterServerListMock).toHaveBeenCalledWith({ refreshQueryData: false });
    expect(listServersMock).toHaveBeenCalledWith({ userId: 'user-1', userSteamId: 'steam-admin' });
    expect(response.json).toHaveBeenCalledWith({
      result: { updated: 1 },
      servers: [{ id: 'server-1' }],
    });
  });

  test('returns current backend data when refresh fails', async () => {
    refreshMasterServerListMock.mockRejectedValueOnce(new Error('refresh failed'));
    const response = createResponse();
    await refreshServerQueryDataHandler(request({ steamId: 'steam-admin' }), response.res);

    expect(response.status).not.toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      result: { fetched: 0, inserted: 0, updated: 0, refreshed: 0 },
      servers: [{ id: 'server-1' }],
      errorMessage: 'refresh failed',
    });

    refreshMasterServerListMock.mockRejectedValueOnce('unknown');
    const unknownResponse = createResponse();
    await refreshServerQueryDataHandler(request({ steamId: 'steam-admin' }), unknownResponse.res);

    expect(unknownResponse.status).not.toHaveBeenCalledWith(400);
    expect(unknownResponse.json).toHaveBeenCalledWith({
      result: { fetched: 0, inserted: 0, updated: 0, refreshed: 0 },
      servers: [{ id: 'server-1' }],
      errorMessage: 'UNKNOWN_ERROR',
    });
  });
});

function request(user?: { id?: string; steamId: string }) {
  return { user } as unknown as Request;
}

function createResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
