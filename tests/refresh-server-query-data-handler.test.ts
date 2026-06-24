import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const refreshAllServerQueryDataMock = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/master-server-list-service.js', () => ({
  refreshAllServerQueryData: refreshAllServerQueryDataMock,
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
    refreshAllServerQueryDataMock.mockReset().mockResolvedValue({ updated: 1 });
  });

  afterAll(() => {
    restoreEnv(originalEnv);
  });

  test('rejects missing and non-superadmin users', async () => {
    const missingUserResponse = createResponse();
    await refreshServerQueryDataHandler(request(), missingUserResponse.res);
    expect(missingUserResponse.status).toHaveBeenCalledWith(403);
    expect(refreshAllServerQueryDataMock).not.toHaveBeenCalled();

    const regularUserResponse = createResponse();
    await refreshServerQueryDataHandler(
      request({ steamId: 'regular-user' }),
      regularUserResponse.res,
    );
    expect(regularUserResponse.status).toHaveBeenCalledWith(403);
    expect(refreshAllServerQueryDataMock).not.toHaveBeenCalled();
  });

  test('allows the configured superadmin to refresh query data', async () => {
    const response = createResponse();
    await refreshServerQueryDataHandler(request({ steamId: 'steam-admin' }), response.res);

    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(1);
    expect(response.json).toHaveBeenCalledWith({ result: { updated: 1 } });
  });
});

function request(user?: { steamId: string }) {
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
