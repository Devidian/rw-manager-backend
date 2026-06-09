import { jest } from '@jest/globals';

const getPlayersMock = jest.fn<() => string[]>();
const getPropertiesMock = jest.fn<(rootPath?: string) => Record<string, unknown>>();

jest.unstable_mockModule('../src/db/sqlite.js', () => ({
  db: {
    rootPath: '/srv/world',
    getPlayers: getPlayersMock,
  },
}));

jest.unstable_mockModule('../src/utils/server-config.js', () => ({
  ServerConfig: {
    getProperties: getPropertiesMock,
  },
}));

const { getAllPlayers } = await import('../src/service/player-service.js');
const {
  getServerAdminList,
  getServerConfig,
  getServerName,
} = await import('../src/service/server-config-service.js');

describe('server-config and player services', () => {
  beforeEach(() => {
    getPlayersMock.mockReset();
    getPropertiesMock.mockReset();
  });

  test('getAllPlayers delegates to the sqlite db', () => {
    getPlayersMock.mockReturnValue(['player-1']);

    expect(getAllPlayers()).toEqual(['player-1']);
  });

  test('getServerConfig returns all properties from the server config utility', () => {
    getPropertiesMock.mockReturnValue({
      Server_Name: 'Example',
      Server_Admins: 'one;two',
    });

    expect(getServerConfig()).toEqual({
      Server_Name: 'Example',
      Server_Admins: 'one;two',
    });
    expect(getPropertiesMock).toHaveBeenCalledWith('/srv/world');
  });

  test('getServerAdminList and getServerName normalize missing properties', () => {
    getPropertiesMock
      .mockReturnValueOnce({ Server_Admins: 'one;two' })
      .mockReturnValueOnce({})
      .mockReturnValueOnce({ Server_Name: 'Named Server' })
      .mockReturnValueOnce({});

    expect(getServerAdminList()).toEqual(['one', 'two']);
    expect(getServerAdminList()).toEqual([]);
    expect(getServerName()).toBe('Named Server');
    expect(getServerName()).toBe('');
  });
});
