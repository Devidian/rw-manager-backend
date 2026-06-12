import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import type { PluginInfo } from '../interfaces/plugin-info.js';
import { AppConfig } from '../utils/app-config.js';

const pluginManifestPath = 'resources/plugin.yml';
const maximumManifestBytes = 64 * 1024;

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
        const pluginPath = path.join(pluginsPath, entry.name);
        const yaml = await readPluginManifest(pluginPath, entry.name);
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

async function readPluginManifest(
  pluginPath: string,
  directory: string,
): Promise<string> {
  const entries = await readdir(pluginPath, { withFileTypes: true });
  const jars = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.jar'))
    .map((entry) => entry.name)
    .sort((left, right) => {
      const expected = `${directory}.jar`;
      if (left === expected) return -1;
      if (right === expected) return 1;
      return left.localeCompare(right);
    });

  for (const jar of jars) {
    try {
      return await readJarEntry(path.join(pluginPath, jar), pluginManifestPath);
    } catch (error) {
      if (!(error instanceof JarEntryNotFoundError)) throw error;
    }
  }

  return readFile(path.join(pluginPath, 'plugin.yml'), 'utf8');
}

function readJarEntry(jarPath: string, entryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.open(jarPath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error(`Unable to open JAR: ${jarPath}`));
        return;
      }
      readZipEntry(zipFile, entryPath).then(resolve, reject);
    });
  });
}

function readZipEntry(zipFile: ZipFile, entryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      zipFile.close();
      reject(error);
    };
    zipFile.on('error', fail);
    zipFile.on('end', () => fail(new JarEntryNotFoundError(entryPath)));
    zipFile.on('entry', (entry: Entry) => {
      if (entry.fileName !== entryPath) {
        zipFile.readEntry();
        return;
      }
      if (entry.uncompressedSize > maximumManifestBytes) {
        fail(new Error(`Plugin manifest exceeds ${maximumManifestBytes} bytes`));
        return;
      }
      zipFile.openReadStream(entry, (streamError, stream) => {
        if (streamError || !stream) {
          fail(streamError ?? new Error(`Unable to read JAR entry: ${entryPath}`));
          return;
        }
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(chunk));
        stream.on('error', fail);
        stream.on('end', () => {
          zipFile.close();
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
    });
    zipFile.readEntry();
  });
}

class JarEntryNotFoundError extends Error {}

function isMissing(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
