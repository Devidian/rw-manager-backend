import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listInstalledPlugins } from '../src/service/plugin-inventory-service.js';

describe('plugin inventory service', () => {
  test('returns an empty inventory when Plugins is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-empty-'));

    await expect(listInstalledPlugins(root)).resolves.toEqual([]);
  });

  test('lists valid and malformed plugin manifests deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-'));
    await mkdir(path.join(root, 'Plugins', 'Broken'), { recursive: true });
    await mkdir(path.join(root, 'Plugins', 'OZAdminUtils'), { recursive: true });
    await writeFile(
      path.join(root, 'Plugins', 'Broken', 'plugin.yml'),
      'name: Missing Version\n',
    );
    await writeFile(
      path.join(root, 'Plugins', 'OZAdminUtils', 'plugin.yml'),
      'name: "OZ - Admin Utils"\nversion: "0.6.0"\n',
    );

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      { directory: 'Broken', valid: false },
      {
        directory: 'OZAdminUtils',
        name: 'OZ - Admin Utils',
        version: '0.6.0',
        valid: true,
      },
    ]);
  });

  test('rejects non-missing filesystem errors and tolerates invalid YAML', async () => {
    const invalidRoot = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-file-'));
    await writeFile(path.join(invalidRoot, 'Plugins'), 'not a directory');
    await expect(listInstalledPlugins(invalidRoot)).rejects.toMatchObject({
      code: 'ENOTDIR',
    });

    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-yaml-'));
    await mkdir(path.join(root, 'Plugins', 'Broken'), { recursive: true });
    await writeFile(
      path.join(root, 'Plugins', 'Broken', 'plugin.yml'),
      'name: [broken',
    );
    await expect(listInstalledPlugins(root)).resolves.toEqual([
      { directory: 'Broken', valid: false },
    ]);
  });
});
