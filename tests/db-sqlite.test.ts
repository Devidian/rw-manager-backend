import { jest } from '@jest/globals';

const readdirSyncMock = jest.fn<(path: string) => string[]>();
const existsSyncMock = jest.fn<(path: string) => boolean>();
const resolveMock = jest.fn<(path: string) => string>();
const getWorldNameMock = jest.fn<(rootPath?: string) => string>();
const bufferToPositionMock = jest.fn<(value: Buffer | undefined) => unknown>();
const databasePrepareMock = jest.fn<(query: string) => { all: () => unknown[] }>();
const databaseConstructorMock = jest.fn<(path: string) => { prepare: typeof databasePrepareMock }>();

jest.unstable_mockModule('node:fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
}));

jest.unstable_mockModule('node:path', () => ({
  resolve: resolveMock,
}));

jest.unstable_mockModule('../src/utils/server-config.js', () => ({
  ServerConfig: {
    getWorldName: getWorldNameMock,
  },
}));

jest.unstable_mockModule('../src/utils/spawn-packet-decoder.js', () => ({
  bufferToPosition: bufferToPositionMock,
}));

jest.unstable_mockModule('better-sqlite3', () => ({
  default: databaseConstructorMock,
}));

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

async function loadDbModule() {
  jest.resetModules();
  return import('../src/db/sqlite.js');
}

describe('db/sqlite', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    restoreEnv(originalEnv);
    process.env.SERVER_ROOT = '/srv/rw';
    readdirSyncMock.mockReset();
    existsSyncMock.mockReset().mockReturnValue(true);
    resolveMock.mockImplementation((value: string) => value);
    getWorldNameMock.mockReset().mockReturnValue('world-1');
    bufferToPositionMock.mockReset()
      .mockReturnValueOnce({ x: 1, y: 2, z: 3 })
      .mockReturnValueOnce({ x: 4, y: 5, z: 6 })
      .mockReturnValueOnce({ x: 7, y: 8, z: 9 });
    databasePrepareMock.mockReset();
    databaseConstructorMock.mockReset().mockImplementation(() => ({
      prepare: databasePrepareMock,
    }));
  });

  afterAll(() => {
    restoreEnv(originalEnv);
  });

  test('exposes rootPath and worldName from config', async () => {
    const { db } = await loadDbModule();

    expect(db.rootPath).toBe('/srv/rw');
    expect(db.worldName).toBe('world-1');
  });

  test('initialize validates the configured world and opens the player database', async () => {
    const { db } = await loadDbModule();
    readdirSyncMock.mockReturnValue(['world-1']);

    db.initialize();

    expect(readdirSyncMock).toHaveBeenCalledWith('/srv/rw/Worlds');
    expect(databaseConstructorMock).toHaveBeenCalledWith(
      '/srv/rw/Worlds/world-1/Player.db',
    );
  });

  test('initialize throws when the world does not exist', async () => {
    const { db } = await loadDbModule();
    readdirSyncMock.mockReturnValue(['other-world']);

    expect(() => db.initialize()).toThrow('World world-1 does not exist');
  });

  test('optional initialization tolerates missing server assets and opens an existing player database read-only', async () => {
    const { db } = await loadDbModule();
    existsSyncMock.mockReturnValue(false);
    expect(db.initializeIfAvailable()).toBe(false);
    expect(databaseConstructorMock).not.toHaveBeenCalled();

    existsSyncMock.mockReturnValue(true);
    expect(db.initializeIfAvailable()).toBe(true);
    expect(databaseConstructorMock).toHaveBeenCalledWith(
      '/srv/rw/Worlds/world-1/Player.db',
      { readonly: true },
    );

    getWorldNameMock.mockImplementation(() => {
      throw new Error('invalid server config');
    });
    expect(db.initializeIfAvailable()).toBe(false);
  });

  test('getPlayers requires initialization and maps sqlite rows', async () => {
    const { db } = await loadDbModule();
    const rows = [
      {
        platform: 2,
        clothes: Buffer.from('clothes'),
        primaryspawn: Buffer.from('primary'),
        secondaryspawn: Buffer.from('secondary'),
        tertiaryspawn: Buffer.from('tertiary'),
      },
    ];

    expect(() => db.getPlayers()).toThrow('Player database not initialized');

    readdirSyncMock.mockReturnValue(['world-1']);
    databasePrepareMock.mockReturnValue({
      all: () => rows,
    });

    db.initialize();

    expect(db.getPlayers()).toEqual([
      {
        platform: 'Steam',
        clothes: Buffer.from('clothes').toString('hex'),
        primaryspawn: { x: 1, y: 2, z: 3 },
        secondaryspawn: { x: 4, y: 5, z: 6 },
        tertiaryspawn: { x: 7, y: 8, z: 9 },
      },
    ]);
  });
});
