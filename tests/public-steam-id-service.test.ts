import { jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';

const getUserFromBearerToken = jest.fn<(authorization: string | undefined) => Promise<object | null>>();
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({ getUserFromBearerToken }));
const { maskPublicSteamIds, maskGuestSteamIds, requirePlayerProfileAuth } = await import('../src/service/public-steam-id-service.js');

const id = '76561198000000000';
const masked = '7***************0';
const originalEnableAuth = process.env.ENABLE_AUTH;

beforeEach(() => { process.env.ENABLE_AUTH = 'true'; });
afterAll(() => {
  if (originalEnableAuth === undefined) delete process.env.ENABLE_AUTH;
  else process.env.ENABLE_AUTH = originalEnableAuth;
});

test('masks Steam IDs in nested public responses without changing source data', () => {
  const source = { servers: [{ onlinePlayers: [{ uid: id, name: 'Ada' }], queryData: { steamid: id } }],
    buckets: [{ onlinePlayerUids: [id] }], map: { playerId: id }, standalone: 'standalone-player-uid' };
  expect(maskPublicSteamIds(source)).toEqual({ servers: [{ onlinePlayers: [{ uid: masked, name: 'Ada' }], queryData: { steamid: masked } }],
    buckets: [{ onlinePlayerUids: [masked] }], map: { playerId: masked }, standalone: 'standalone-player-uid' });
  expect(source.servers[0].onlinePlayers[0].uid).toBe(id);
});

test('shares the dependency-free mask and preserves legacy values', async () => {
  const { maskPublicSteamIds: mask } = await import('../src/utils/mask-public-steam-ids.js');
  expect(maskPublicSteamIds).toBe(mask);
  const createdAt = new Date(0);
  const source = { STEAMID: 76561198000000000, count: 1, createdAt, longer: `${id}1` };
  expect(mask(source)).toEqual({ ...source, STEAMID: masked });
  expect(mask(createdAt)).toBe(createdAt);
});

test('REST projection removes Steam IDs for guests and unrelated authenticated users', async () => {
  const json = jest.fn<(body: unknown) => Response>();
  const next = jest.fn<NextFunction>();
  const response = { json, vary: jest.fn(), setHeader: jest.fn() } as unknown as Response;
  json.mockReturnValue(response);
  getUserFromBearerToken.mockResolvedValueOnce(null);
  await maskGuestSteamIds({ method: 'GET', header: () => undefined } as unknown as Request, response, next);
  response.json({ uid: id, name: 'Ada' });
  await new Promise(setImmediate);
  expect(json).toHaveBeenCalledWith({ name: 'Ada' });
  expect(response.vary).toHaveBeenCalledWith('Authorization');
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');

  const authenticatedJson = jest.fn<(body: unknown) => Response>().mockReturnValue(response);
  const authenticatedResponse = { json: authenticatedJson, vary: jest.fn(), setHeader: jest.fn() } as unknown as Response;
  getUserFromBearerToken.mockResolvedValueOnce({ id: 'user' });
  await maskGuestSteamIds({ method: 'GET', header: () => 'Bearer valid' } as unknown as Request, authenticatedResponse, next);
  authenticatedResponse.json({ uid: id, name: 'Ada' });
  await new Promise(setImmediate);
  expect(authenticatedJson).toHaveBeenCalledWith({ name: 'Ada' });
});

test('profile history requires a valid session', async () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const next = jest.fn<NextFunction>();
  getUserFromBearerToken.mockResolvedValueOnce(null);
  await requirePlayerProfileAuth({ header: () => undefined } as unknown as Request, { status } as unknown as Response, next);
  expect(status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
  getUserFromBearerToken.mockResolvedValueOnce({ id: 'user' });
  await requirePlayerProfileAuth({ header: () => 'Bearer valid' } as unknown as Request, { status } as unknown as Response, next);
  expect(next).toHaveBeenCalledTimes(1);
});

test('profile history stays closed when authentication is disabled', async () => {
  process.env.ENABLE_AUTH = 'false';
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const next = jest.fn<NextFunction>();
  await requirePlayerProfileAuth({ header: () => 'Bearer old-token' } as unknown as Request, { status } as unknown as Response, next);
  expect(status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});
