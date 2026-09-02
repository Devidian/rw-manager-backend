import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';
import {
  refreshAllServerQueryData,
  refreshMasterServerList,
} from './master-server-list-service.js';
import { refreshDueServerPlayerLists } from './server-live-status-service.js';
import { refreshPluginDataForOnlineServers } from './plugin-data-cache-service.js';

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
  const playerList = startLoop(
    'player list',
    AppConfig.activePlayerListRefreshIntervalMs,
    refreshDueServerPlayerLists,
  );
  const pluginData = startLoop(
    'plugin data',
    AppConfig.pluginDataRefreshIntervalMs,
    () => refreshPluginDataForOnlineServers(),
  );

  return {
    stop: () => {
      master.stop();
      query.stop();
      playerList.stop();
      pluginData.stop();
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
