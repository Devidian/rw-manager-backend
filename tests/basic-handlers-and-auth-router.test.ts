import { jest } from '@jest/globals';
import type { NextFunction, Request, Response } from 'express';

const getServerNameMock = jest.fn<() => string>();
const getServerConfigMock = jest.fn<() => Record<string, unknown>>();
const getServerAdminListMock = jest.fn<() => string[]>();
const getUserFromBearerTokenMock = jest.fn<() => { id: string } | null>();

jest.unstable_mockModule('typia', () => ({
  default: { assert: (value: unknown) => value },
}));
jest.unstable_mockModule('../src/service/server-config-service.js', () => ({
  getServerName: getServerNameMock,
  getServerConfig: getServerConfigMock,
  getServerAdminList: getServerAdminListMock,
}));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({
  getUserFromBearerToken: getUserFromBearerTokenMock,
}));

const { getServerNameHandler } = await import('../src/handler/get-server-name-handler.js');
const { getServerConfigHandler } = await import('../src/handler/get-server-config-handler.js');
const { getServerAdminListHandler } = await import('../src/handler/get-server-admin-list-handler.js');
const { requireAuth } = await import('../src/router/require-auth.js');

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('basic handlers and auth router guard', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    restoreEnv(originalEnv);
    getServerNameMock.mockReset().mockReturnValue('New World');
    getServerConfigMock.mockReset().mockReturnValue({ Server_Name: 'New World' });
    getServerAdminListMock.mockReset().mockReturnValue(['steam-admin']);
    getUserFromBearerTokenMock.mockReset();
  });

  afterAll(() => {
    restoreEnv(originalEnv);
  });

  test('returns server name, config, and admin list payloads', () => {
    const nameResponse = createResponse();
    getServerNameHandler(request(), nameResponse.res);
    expect(nameResponse.json).toHaveBeenCalledWith({ name: 'New World' });

    const configResponse = createResponse();
    getServerConfigHandler(request(), configResponse.res);
    expect(configResponse.json).toHaveBeenCalledWith({ config: { Server_Name: 'New World' } });

    const adminResponse = createResponse();
    getServerAdminListHandler(request(), adminResponse.res);
    expect(adminResponse.json).toHaveBeenCalledWith({ admins: ['steam-admin'] });
  });

  test('maps server config handler errors to 400 responses', () => {
    getServerNameMock.mockImplementationOnce(() => {
      throw new Error('name failed');
    });
    const nameResponse = createResponse();
    getServerNameHandler(request(), nameResponse.res);
    expect(nameResponse.status).toHaveBeenCalledWith(400);
    expect(nameResponse.json).toHaveBeenCalledWith({ error: 'name failed' });

    getServerNameMock.mockImplementationOnce(() => {
      throw 'unknown';
    });
    const unknownNameResponse = createResponse();
    getServerNameHandler(request(), unknownNameResponse.res);
    expect(unknownNameResponse.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });

    getServerConfigMock.mockImplementationOnce(() => {
      throw 'unknown';
    });
    const configResponse = createResponse();
    getServerConfigHandler(request(), configResponse.res);
    expect(configResponse.status).toHaveBeenCalledWith(400);
    expect(configResponse.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });

    getServerConfigMock.mockImplementationOnce(() => {
      throw new Error('config failed');
    });
    const errorConfigResponse = createResponse();
    getServerConfigHandler(request(), errorConfigResponse.res);
    expect(errorConfigResponse.json).toHaveBeenCalledWith({ error: 'config failed' });

    getServerAdminListMock.mockImplementationOnce(() => {
      throw new Error('admins failed');
    });
    const adminResponse = createResponse();
    getServerAdminListHandler(request(), adminResponse.res);
    expect(adminResponse.status).toHaveBeenCalledWith(400);
    expect(adminResponse.json).toHaveBeenCalledWith({ error: 'admins failed' });

    getServerAdminListMock.mockImplementationOnce(() => {
      throw 'unknown';
    });
    const unknownAdminResponse = createResponse();
    getServerAdminListHandler(request(), unknownAdminResponse.res);
    expect(unknownAdminResponse.json).toHaveBeenCalledWith({ error: 'UNKNOWN_ERROR' });
  });

  test('requireAuth bypasses when auth is disabled and validates bearer users when enabled', async () => {
    const next = jest.fn() as NextFunction;
    process.env.ENABLE_AUTH = 'false';
    await requireAuth(request(), createResponse().res, next);
    expect(next).toHaveBeenCalledTimes(1);

    process.env.ENABLE_AUTH = 'true';
    getUserFromBearerTokenMock.mockReturnValueOnce({ id: 'user-1' });
    const authedRequest = request();
    await requireAuth(authedRequest, createResponse().res, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect((authedRequest as Request & { user?: unknown }).user).toEqual({ id: 'user-1' });

    getUserFromBearerTokenMock.mockReturnValueOnce(null);
    const response = createResponse();
    await requireAuth(request(), response.res, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});

function request() {
  return {
    header: jest.fn().mockReturnValue('Bearer token'),
  } as unknown as Request;
}

function createResponse() {
  const response = {
    json: jest.fn(),
    status: jest.fn(),
  };
  for (const method of Object.values(response)) method.mockReturnValue(response);
  return { ...response, res: response as unknown as Response };
}
