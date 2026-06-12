import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ZipFile } from 'yazl';
import { listInstalledPlugins } from '../src/service/plugin-inventory-service.js';

describe('plugin inventory service', () => {
  test('uses the configured server root by default', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-default-'));
    const previousRoot = process.env.SERVER_ROOT;
    process.env.SERVER_ROOT = root;
    try {
      await expect(listInstalledPlugins()).resolves.toEqual([]);
    } finally {
      if (previousRoot === undefined) delete process.env.SERVER_ROOT;
      else process.env.SERVER_ROOT = previousRoot;
    }
  });

  test('returns an empty inventory when Plugins is missing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-empty-'));

    await expect(listInstalledPlugins(root)).resolves.toEqual([]);
  });

  test('lists release JAR and loose plugin manifests deterministically', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-'));
    await mkdir(path.join(root, 'Plugins', 'Broken'), { recursive: true });
    await mkdir(path.join(root, 'Plugins', 'InvalidVersion'), { recursive: true });
    await mkdir(path.join(root, 'Plugins', 'OZAdminUtils'), { recursive: true });
    await writeFile(
      path.join(root, 'Plugins', 'Broken', 'plugin.yml'),
      'name: Missing Version\n',
    );
    await writeJar(
      path.join(root, 'Plugins', 'InvalidVersion', 'InvalidVersion.jar'),
      'name: Invalid Version\nversion: 1\n',
    );
    await writeJar(
      path.join(root, 'Plugins', 'OZAdminUtils', 'OZAdminUtils.jar'),
      'name: "OZ - Admin Utils"\nversion: "0.6.0"\n',
    );

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      { directory: 'Broken', valid: false },
      { directory: 'InvalidVersion', valid: false },
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

  test('ignores runtime files and marks JARs without a manifest invalid', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-runtime-'));
    const pluginPath = path.join(root, 'Plugins', 'OZAdminUtils');
    await mkdir(pluginPath, { recursive: true });
    await writeFile(path.join(pluginPath, 'New World.db'), 'runtime');
    await writeFile(path.join(pluginPath, 'settings.properties'), 'runtime=true');
    await writeJar(path.join(pluginPath, 'OZAdminUtils.jar'), null);

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      { directory: 'OZAdminUtils', valid: false },
    ]);
  });

  test('falls back to a loose manifest when JARs contain no manifest', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-fallback-'));
    const pluginPath = path.join(root, 'Plugins', 'Legacy');
    await mkdir(pluginPath, { recursive: true });
    await writeJar(path.join(pluginPath, 'Legacy.jar'), null);
    await writeFile(
      path.join(pluginPath, 'plugin.yml'),
      'name: Legacy Plugin\nversion: 1.0.0\n',
    );

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      {
        directory: 'Legacy',
        name: 'Legacy Plugin',
        version: '1.0.0',
        valid: true,
      },
    ]);
  });

  test('prefers the JAR matching the plugin directory name', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-preferred-'));
    const pluginPath = path.join(root, 'Plugins', 'OZAdminUtils');
    await mkdir(pluginPath, { recursive: true });
    await writeJar(
      path.join(pluginPath, 'A-old.jar'),
      'name: Old Plugin\nversion: 0.1.0\n',
    );
    await writeJar(
      path.join(pluginPath, 'OZAdminUtils.jar'),
      'name: Current Plugin\nversion: 0.6.0\n',
    );

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      {
        directory: 'OZAdminUtils',
        name: 'Current Plugin',
        version: '0.6.0',
        valid: true,
      },
    ]);
  });

  test('marks corrupt JARs and oversized manifests invalid', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rw-plugins-invalid-jars-'));
    const corruptPath = path.join(root, 'Plugins', 'Corrupt');
    const oversizedPath = path.join(root, 'Plugins', 'Oversized');
    await mkdir(corruptPath, { recursive: true });
    await mkdir(oversizedPath, { recursive: true });
    await writeFile(path.join(corruptPath, 'Corrupt.jar'), 'not a jar');
    await writeJar(
      path.join(oversizedPath, 'Oversized.jar'),
      `name: Oversized\nversion: 1.0.0\n${'x'.repeat(64 * 1024)}`,
    );

    await expect(listInstalledPlugins(root)).resolves.toEqual([
      { directory: 'Corrupt', valid: false },
      { directory: 'Oversized', valid: false },
    ]);
  });
});

function writeJar(filePath: string, manifest: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    if (manifest !== null) {
      zip.addBuffer(Buffer.from(manifest), 'resources/plugin.yml');
    } else {
      zip.addBuffer(Buffer.from('class'), 'example/Plugin.class');
    }
    zip.outputStream
      .pipe(createWriteStream(filePath))
      .on('close', resolve)
      .on('error', reject);
    zip.end();
  });
}
