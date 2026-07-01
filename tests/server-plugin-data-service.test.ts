import { jest } from '@jest/globals';

const getCachedPluginDataMock = jest.fn();
const getFirstCachedPluginDataMock = jest.fn();

jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  getCachedPluginData: getCachedPluginDataMock,
  getFirstCachedPluginData: getFirstCachedPluginDataMock,
}));

const {
  getCachedServerAdminList,
  getCachedServerConfig,
  getCachedServerName,
  getCachedServerPlayers,
} = await import('../src/service/server-plugin-data-service.js');

describe('server plugin data service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns empty fallbacks for missing and malformed cached payloads', () => {
    getCachedPluginDataMock.mockReturnValue(undefined);
    expect(getCachedServerPlayers('server-1')).toEqual([]);
    expect(getCachedServerConfig('server-1')).toEqual({});
    expect(getCachedServerAdminList('server-1')).toEqual([]);
    expect(getCachedServerName('server-1')).toBe('');

    getFirstCachedPluginDataMock.mockReturnValue({
      data: {
        'ozadminutils.playerlist': { players: 'bad' },
        'ozadminutils.serverConfig': { config: [] },
      },
    });
    expect(getCachedServerPlayers()).toEqual([]);
    expect(getCachedServerConfig()).toEqual({});
  });

  test('normalizes cached config, admins, names, and players', () => {
    getCachedPluginDataMock.mockReturnValue({
      data: {
        'ozadminutils.serverConfig': {
          config: {
            Server_Admins: ' steam-1 ; ; steam-2 ',
            Server_Name: 'Land of OZ',
          },
        },
        'ozadminutils.playerlist': {
          players: [
            null,
            { id: 'bad' },
            player({
              platform: 1,
              clothes: 'encoded',
              primaryspawn: { x: 1, y: 2, z: 3 },
              secondaryspawn: { x: null, y: 2, z: 3 },
            }),
          ],
        },
      },
    });

    expect(getCachedServerConfig('server-1')).toEqual({
      Server_Admins: ' steam-1 ; ; steam-2 ',
      Server_Name: 'Land of OZ',
    });
    expect(getCachedServerAdminList('server-1')).toEqual(['steam-1', 'steam-2']);
    expect(getCachedServerName('server-1')).toBe('Land of OZ');
    expect(getCachedServerPlayers('server-1')).toEqual([
      expect.objectContaining({
        id: 1,
        uid: 'uid-1',
        platform: 1,
        clothes: 'encoded',
        primaryspawn: { x: 1, y: 2, z: 3 },
      }),
    ]);
    expect(getCachedServerPlayers('server-1')[0]?.secondaryspawn).toBeUndefined();
  });
});

function player(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uid: 'uid-1',
    name: 'Player',
    posx: 1,
    posy: 2,
    posz: 3,
    rotx: 0,
    roty: 0,
    rotz: 0,
    rotw: 1,
    platform: 'Steam',
    permissiongroup: 'default',
    health: 100,
    hunger: 100,
    thirst: 100,
    brokenbones: 0,
    temperature: 37,
    dead: 0,
    flying: 0,
    lastspawn: 0,
    lastusedmount: 0,
    lastusedvehicle: 0,
    playtime: 10,
    firstseen: 1000,
    lastseen: 2000,
    ...overrides,
  };
}
