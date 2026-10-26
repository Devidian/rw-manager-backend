import { jest } from '@jest/globals';
import type { Request, Response } from 'express';

const listVisibleServers = jest.fn<() => Promise<Array<{ id: string }>>>();
const listStoredServers = jest.fn<() => Promise<unknown[]>>();
jest.unstable_mockModule('typia', () => ({ default: { assert: (value: unknown) => value } }));
jest.unstable_mockModule('../src/service/storage-service.js', () => ({ listServers: listVisibleServers }));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ listServers: listStoredServers }));
const { getPlayerServerHistoryHandler } = await import('../src/handler/get-player-server-history-handler.js');

test('returns stored visits only for servers visible in the public server list', async () => {
  listVisibleServers.mockResolvedValue([{ id: 'current' }, { id: 'offline' }]);
  listStoredServers.mockResolvedValue([
    { id: 'current', label: 'Current', status: 'online', public: true, knownPlayers: [{ uid: 'ada', playtime: 7200, lastseen: 20 }] },
    { id: 'offline', label: 'Offline', status: 'offline', public: true, knownPlayers: [{ uid: 'ada', lastseen: 10 }] },
    { id: 'blocked', label: 'Blocked', status: 'online', knownPlayers: [{ uid: 'ada', playtime: 999 }] },
  ]);
  const json = jest.fn();
  const res = { json } as unknown as Response;
  await getPlayerServerHistoryHandler({ params: { uid: 'ada' } } as unknown as Request, res);
  expect(json).toHaveBeenCalledWith({ uid: 'ada', items: [
    { serverId: 'current', label: 'Current', status: 'online', playtime: 7200, lastseen: 20 },
    { serverId: 'offline', label: 'Offline', status: 'offline', lastseen: 10 },
  ] });
});
