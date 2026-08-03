import { AppConfig } from '../utils/app-config.js';

export interface BackendInfo {
  ok: true;
  limits: {
    maxPinnedServers: number;
  };
  services: string[];
  version: 1;
}

export function getBackendInfo(): BackendInfo {
  const services: string[] = [];
  if (AppConfig.enableStorage) services.push('storage');
  if (AppConfig.enableData) services.push('data');
  if (AppConfig.enableAuth) services.push('auth');
  if (AppConfig.forceAuth) services.push('forceAuth');
  return {
    ok: true,
    limits: { maxPinnedServers: AppConfig.maxPinnedServers },
    services,
    version: 1,
  };
}
