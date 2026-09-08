import { defaultLogger } from '../utils/logger.js';

const GITHUB_API = 'https://api.github.com/repos/Devidian';

const repositories: Record<string, string> = {
  'OZ - Tools': 'rw-plugin-oz-tools',
  'OZ - Admin Utils': 'rw-plugin-oz-admin-utils',
  'OZ - Wallet': 'rw-plugin-oz-wallet',
  'OZ - Shop': 'rw-plugin-oz-shop',
  'OZ - GPS': 'rw-plugin-oz-gps',
  'OZ - Land Claim': 'rw-plugin-oz-land-claim',
  'OZ - Marketplace': 'rw-plugin-oz-marketplace',
  'OZ - Mail': 'rw-plugin-oz-mail',
  'OZ - Rewards': 'rw-plugin-oz-rewards',
  'OZ - Bosses': 'rw-plugin-oz-bosses',
  'OZ - Discord Connect': 'rw-plugin-oz-discord-connect',
  'OZ - Global Intercom': 'rw-plugin-oz-global-intercom',
};

let latestVersions: Record<string, string> = {};

/** Returns the last successful public-release inventory without waiting on GitHub. */
export function getCachedOZPluginLatestVersions(): Record<string, string> {
  return { ...latestVersions };
}

/** Refreshes every known OZ plugin independently; a single unavailable release does not erase cache. */
export async function refreshOZPluginLatestVersions(): Promise<void> {
  const results = await Promise.all(Object.entries(repositories).map(async ([name, repository]) => {
    try {
      const response = await fetch(`${GITHUB_API}/${repository}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return undefined;
      const body: unknown = await response.json();
      const tagName = body && typeof body === 'object' ? (body as { tag_name?: unknown }).tag_name : undefined;
      return typeof tagName === 'string' && tagName.trim()
        ? ([name, tagName.replace(/^v/, '')] as const)
        : undefined;
    } catch {
      return undefined;
    }
  }));
  const updated = Object.fromEntries(results.filter((value): value is readonly [string, string] => value !== undefined));
  if (Object.keys(updated).length > 0) latestVersions = { ...latestVersions, ...updated };
  else defaultLogger.warn('OZ plugin release inventory refresh did not return a release');
}
