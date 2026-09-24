import type { PluginInfo } from '../interfaces/plugin-info.js';

export interface ListServerPluginsResponse {
  available: boolean;
  nativeAccess: 'available' | 'noAccess' | 'unavailable';
  items: PluginInfo[];
  latestVersions: Record<string, string>;
}
