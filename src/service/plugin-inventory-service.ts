import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { PluginInfo } from '../interfaces/plugin-info.js';
import { AppConfig } from '../utils/app-config.js';

interface PluginManifest {
  name?: unknown;
  version?: unknown;
}

export async function listInstalledPlugins(
  rootPath: string = AppConfig.rootPath,
): Promise<PluginInfo[]> {
  const pluginsPath = path.join(rootPath, 'Plugins');
  let entries;
  try {
    entries = await readdir(pluginsPath, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));

  return Promise.all(
    directories.map(async (entry): Promise<PluginInfo> => {
      const plugin: PluginInfo = { directory: entry.name, valid: false };
      try {
        const yaml = await readFile(
          path.join(pluginsPath, entry.name, 'plugin.yml'),
          'utf8',
        );
        const manifest = parse(yaml) as PluginManifest | null;
        if (
          manifest === null ||
          typeof manifest !== 'object' ||
          typeof manifest.name !== 'string' ||
          manifest.name.trim() === '' ||
          typeof manifest.version !== 'string' ||
          manifest.version.trim() === ''
        ) {
          return plugin;
        }
        return {
          directory: entry.name,
          name: manifest.name.trim(),
          version: manifest.version.trim(),
          valid: true,
        };
      } catch {
        return plugin;
      }
    }),
  );
}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
