import { jest } from '@jest/globals';
import type { ServerConfig } from '../src/interfaces/server-config.js';
import type { ServerStatisticsBucket } from '../src/interfaces/server-statistics.js';

const old: ServerConfig = {
  id: 'old', label: 'Original', ip: '192.0.2.1', port: 4255, queryUrl: 'http://192.0.2.1:4254',
  public: true, status: 'offline', createdAt: new Date('2026-11-01T00:00:00Z'), firstSeen: '2026-11-01T00:00:00Z', lastSeen: '2026-11-01T01:00:00Z',
  data: { name: 'Server', map: 'World', gamemode: 0, os: 'Linux' }, info: { shortname: 'Short' },
};
const newer: ServerConfig = {
  ...old, id: 'new', label: 'New', status: 'online', ip: '192.0.2.2', queryUrl: 'http://192.0.2.2:4254',
  createdAt: new Date('2026-11-02T00:00:00Z'), firstSeen: '2026-11-02T00:00:00Z', lastSeen: '2026-11-02T01:00:00Z',
  data: { name: 'Renamed', map: 'World', gamemode: 0, os: 'Linux' },
};
function bucket(serverId: string, hourStart: string, sampleCount: number): ServerStatisticsBucket {
  return {
    id: `${serverId}:${hourStart}`, serverId, hourStart, sampleCount, onlineSampleCount: sampleCount,
    playerSampleTotal: sampleCount, maxPlayers: 1, averagePlayers: 1, availability: 100,
    onlinePlayerUids: ['player'], updatedAt: hourStart,
  };
}
let servers: ServerConfig[];
let statistics: ServerStatisticsBucket[];
let users: Array<{ id: string; pinnedServers: string[] }>;
let conflictingId = false;
let mongoAvailable = true;
const closeSession = jest.fn(async () => undefined);
const session = { withTransaction: async (callback: () => Promise<void>) => callback(), endSession: closeSession };
const collections = {
  servers: {
    find: () => ({ toArray: async () => servers }),
    findOne: async () => conflictingId ? { id: 'occupied' } : null,
    deleteMany: async ({ id }: { id: { $in: string[] } }) => { servers = servers.filter((server) => !id.$in.includes(server.id)); },
    replaceOne: async ({ id }: { id: string }, value: ServerConfig) => { servers = servers.map((server) => server.id === id ? value : server); },
  },
  serverStatistics: {
    find: () => ({ toArray: async () => statistics }),
    distinct: async () => [...new Set(statistics.map((item) => item.hourStart))],
    deleteMany: async () => { statistics = []; },
    insertMany: async (values: ServerStatisticsBucket[]) => { statistics.push(...values); },
  },
  users: {
    find: () => ({ toArray: async () => users }),
    countDocuments: async () => users.length,
    updateOne: async ({ id }: { id: string }, update: { $set: { pinnedServers: string[] } }) => {
      users = users.map((user) => user.id === id ? { ...user, pinnedServers: update.$set.pinnedServers } : user);
    },
  },
};
jest.unstable_mockModule('../src/db/mongodb.js', () => ({
  getMongoCollections: () => mongoAvailable ? collections : undefined,
  getMongoClient: () => ({ startSession: () => session }),
}));
jest.unstable_mockModule('../src/db/manager-store.js', () => ({
  listServers: async () => servers, findServerById: async (id: string) => servers.find((server) => server.id === id || server.alternateIds?.includes(id)),
}));
jest.unstable_mockModule('../src/service/server-live-status-service.js', () => ({ clearServerLiveStatusCacheEntry: jest.fn() }));
jest.unstable_mockModule('../src/service/game-connector-websocket-service.js', () => ({ closeGameConnectorSession: jest.fn() }));
const { mergeServers, previewServerMerge, resolveServerId } = await import('../src/service/server-duplicate-service.js');

describe('server merge', () => {
  beforeEach(() => {
    process.env.SUPER_ADMIN_ID = 'admin';
    servers = [{ ...old }, { ...newer }];
    statistics = [
      bucket('old', '2026-11-01T00:00:00Z', 3),
      bucket('new', '2026-11-01T00:00:00Z', 5),
      bucket('new', '2026-11-02T00:00:00Z', 2),
    ];
    users = [{ id: 'user', pinnedServers: ['old', 'new'] }];
    conflictingId = false;
    mongoAvailable = true;
  });
  afterAll(() => { delete process.env.SUPER_ADMIN_ID; });

  test('keeps the oldest ID, current endpoint, favorites and one bucket per hour', async () => {
    await mergeServers({ targetId: 'old', sourceIds: ['new'] }, 'admin');
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ id: 'old', alternateIds: ['new'], ip: '192.0.2.2', catalogIdPinned: true });
    expect(users[0].pinnedServers).toEqual(['old']);
    expect(statistics.map((item) => [item.serverId, item.sampleCount])).toEqual([['old', 5], ['old', 2]]);
    await expect(resolveServerId('new')).resolves.toBe('old');
    expect(closeSession).toHaveBeenCalled();
  });
  test('rejects unauthorized and stale selections before writing', async () => {
    await expect(mergeServers({ targetId: 'old', sourceIds: ['new'] }, 'other')).rejects.toThrow('FORBIDDEN');
    await expect(mergeServers({ targetId: 'new', sourceIds: ['old'] }, 'admin')).rejects.toThrow('MERGE_SELECTION_STALE');
    expect(servers).toHaveLength(2);
  });
  test('rejects duplicate source IDs and an alias conflict before deleting records', async () => {
    await expect(mergeServers({ targetId: 'old', sourceIds: ['new', 'new'] }, 'admin')).rejects.toThrow('MERGE_SELECTION_INVALID');
    conflictingId = true;
    await expect(mergeServers({ targetId: 'old', sourceIds: ['new'] }, 'admin')).rejects.toThrow('MERGE_ID_CONFLICT');
    expect(servers).toHaveLength(2);
    expect(users[0].pinnedServers).toEqual(['old', 'new']);
  });
  test('previews without MongoDB but requires it before any merge', async () => {
    mongoAvailable = false;
    await expect(previewServerMerge({ targetId: 'old', sourceIds: ['new'] }, 'admin'))
      .resolves.toMatchObject({ affectedFavorites: 0, statisticHours: 0 });
    await expect(mergeServers({ targetId: 'old', sourceIds: ['new'] }, 'admin')).rejects.toThrow('MERGE_REQUIRES_MONGODB');
    expect(servers).toHaveLength(2);
  });
  test('merges records that have no statistics or pinned users', async () => {
    statistics = [];
    users = [];
    await mergeServers({ targetId: 'old', sourceIds: ['new'] }, 'admin');
    expect(servers).toHaveLength(1);
    expect(statistics).toEqual([]);
  });
});
