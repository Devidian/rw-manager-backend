import type { PluginInfo } from '../interfaces/plugin-info.js';

export interface ListServerPluginsResponse {
  available: boolean;
  items: PluginInfo[];
}
