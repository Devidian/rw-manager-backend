import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const listVisibleServers = jest.fn<() => Promise<Array<{ id: string; masterOnly?: boolean }>>>();
const listStoredServers = jest.fn<() => Promise<any[]>>();
const findServerById = jest.fn<(id: string) => Promise<any>>();
const getCachedServerAdminList = jest.fn<(id: string) => string[]>();
const getUserFromBearerToken = jest.fn(async () => ({ steamId: 'ada', steamVerifiedAt: new Date() }));
jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));
jest.unstable_mockModule('../src/service/storage-service.js', () => ({ listServers: listVisibleServers }));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ listServers: listStoredServers, findServerById }));
jest.unstable_mockModule('../src/service/server-plugin-data-service.js', () => ({ getCachedServerAdminList }));
jest.unstable_mockModule('../src/service/auth-token-service.js', () => ({ getUserFromBearerToken }));
const { getPlayerServerHistoryHandler } = await import('../src/handler/get-player-server-history-handler.js');

beforeEach(() => {
  jest.clearAllMocks();
  getUserFromBearerToken.mockResolvedValue({ steamId: 'ada', steamVerifiedAt: new Date() });
  getCachedServerAdminList.mockReturnValue([]);
  findServerById.mockResolvedValue({ id: 'current', knownPlayers: [{ id: 4, uid: 'ada' }] });
  listVisibleServers.mockResolvedValue([{ id: 'current' }, { id: 'offline' }]);
  listStoredServers.mockResolvedValue([
    { id: 'current', label: 'Current', status: 'online', public: true,
      knownPlayers: [{ id: 4, uid: 'ada', playtime: 7200, lastseen: 20 }] },
    { id: 'offline', label: 'Offline', status: 'offline', public: true,
      knownPlayers: [{ id: 7, uid: 'ada', lastseen: 10 }] },
    { id: 'blocked', label: 'Blocked', status: 'online', public: true,
      knownPlayers: [{ id: 8, uid: 'ada', playtime: 999 }] },
  ]);
});

function request(id: string): Request {
  return { params: { id }, header: () => 'Bearer token' } as unknown as Request;
}

test('returns stored visits for a verified player with a server-local DBID', async () => {
  const json = jest.fn();
  await getPlayerServerHistoryHandler(request('current:4'), { json } as unknown as Response);
  expect(json).toHaveBeenCalledWith({ id: 'current:4', items: [
    { serverId: 'current', label: 'Current', status: 'online', playtime: 7200, lastseen: 20 },
    { serverId: 'offline', label: 'Offline', status: 'offline', lastseen: 10 },
  ] });
});

test('rejects internal ObjectIds and unrelated accounts', async () => {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const res = { json, status } as unknown as Response;
  await getPlayerServerHistoryHandler(request('aaaaaaaaaaaaaaaaaaaaaaaa'), res);
  expect(status).toHaveBeenCalledWith(400);
  getUserFromBearerToken.mockResolvedValueOnce({ steamId: 'other', steamVerifiedAt: new Date() });
  await getPlayerServerHistoryHandler(request('current:4'), res);
  expect(status).toHaveBeenCalledWith(403);
});

test('allows an owner to inspect history for a player known on their server', async () => {
  getUserFromBearerToken.mockResolvedValueOnce({ steamId: 'owner', steamVerifiedAt: new Date() });
  getCachedServerAdminList.mockImplementation((id) => id === 'current' ? ['owner'] : []);
  const json = jest.fn();
  await getPlayerServerHistoryHandler(request('current:4'), { json } as unknown as Response);
  expect(json).toHaveBeenCalledWith(expect.objectContaining({ id: 'current:4', items: expect.any(Array) }));
});
