import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import {
  refreshAllServerQueryData,
  refreshMasterServerList,
} from './master-server-list-service.js';
import { refreshPluginDataForOnlineServers } from './plugin-data-cache-service.js';
import { refreshOZPluginLatestVersions } from './oz-plugin-release-service.js';

export interface ManagerRefreshScheduler {
  stop: () => void;
}

export function startManagerRefreshScheduler(): ManagerRefreshScheduler | null {
  if (!AppConfig.enableStorage) return null;

  const master = startLoop(
    'master server list',
    AppConfig.masterServerListRefreshIntervalMs,
    () => refreshMasterServerList({ refreshQueryData: false }),
  );
  const query = startLoop(
    'server query data',
    AppConfig.serverQueryRefreshIntervalMs,
    () => refreshAllServerQueryData(),
  );
  const pluginData = startLoop(
    'plugin data',
    AppConfig.pluginDataRefreshIntervalMs,
    async () => {
      await refreshPluginDataForOnlineServers();
      const { reconcileManagerAccounts } = await import('./manager-access-service.js');
      await reconcileManagerAccounts();
    },
  );
  const pluginReleases = startLoop(
    'OZ plugin releases',
    10 * 60_000,
    refreshOZPluginLatestVersions,
  );

  return {
    stop: () => {
      master.stop();
      query.stop();
      pluginData.stop();
      pluginReleases.stop();
    },
  };
}

function startLoop(
  name: string,
  intervalMs: number,
  task: () => Promise<unknown>,
): ManagerRefreshScheduler {
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = () => {
    if (!stopped) {
      timer = setTimeout(run, intervalMs);
    }
  };

  const run = () => {
    if (stopped) return;
    if (running) {
      defaultLogger.warn(`Manager refresh ${name} skipped because previous run is still active`);
      schedule();
      return;
    }
    running = true;
    void task()
      .catch((error) => {
        defaultLogger.error(`Manager refresh ${name} failed:`, error);
      })
      .finally(() => {
        running = false;
        schedule();
      });
  };

  run();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
