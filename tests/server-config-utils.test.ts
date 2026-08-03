import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ServerConfig } from '../src/utils/server-config.js';

describe('ServerConfig utility', () => {
  const originalServerRoot = process.env.SERVER_ROOT;

  afterEach(() => {
    if (originalServerRoot === undefined) delete process.env.SERVER_ROOT;
    else process.env.SERVER_ROOT = originalServerRoot;
  });

  test('masks password properties and keeps raw admin strings', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-manager-config-'));
    await writeFile(
      path.join(root, 'server.properties'),
      [
        'World_Name=Config World',
        'Server_Admins=12345',
        'Server_Password=secret',
        'RCON_Password=admin-secret',
      ].join('\n'),
    );

    expect(ServerConfig.getProperties(root)).toMatchObject({
      World_Name: 'Config World',
      Server_Admins: '12345',
      Server_Password: '***',
      RCON_Password: '***',
    });
    expect(ServerConfig.getWorldName(root)).toBe('Config World');
  });

  test('throws when the server properties file is missing', () => {
    expect(() => ServerConfig.getProperties('/missing/root')).toThrow(
      'Config file not found',
    );
  });

  test('keeps string admin values and falls back to default world name', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-manager-config-'));
    await writeFile(
      path.join(root, 'server.properties'),
      'Server_Admins=steam-1;steam-2\n',
    );

    expect(ServerConfig.getProperties(root)).toMatchObject({
      Server_Admins: 'steam-1;steam-2',
    });
    expect(ServerConfig.getWorldName(root)).toBe('default');
  });

  test('uses the configured server root when no explicit path is provided', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-manager-config-'));
    await writeFile(path.join(root, 'server.properties'), 'World_Name=Default Root World\n');
    process.env.SERVER_ROOT = root;

    expect(ServerConfig.getProperties()).toMatchObject({ World_Name: 'Default Root World' });
    expect(ServerConfig.getWorldName()).toBe('Default Root World');
  });
});
