import { jest } from '@jest/globals';

const refreshMasterServerListMock =
  jest.fn<(options?: { refreshQueryData?: boolean }) => Promise<unknown>>();
const refreshAllServerQueryDataMock =
  jest.fn<() => Promise<unknown>>();
const refreshPluginDataForOnlineServersMock =
  jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule('../src/service/master-server-list-service.js', () => ({
  refreshMasterServerList: refreshMasterServerListMock,
  refreshAllServerQueryData: refreshAllServerQueryDataMock,
}));
jest.unstable_mockModule('../src/service/plugin-data-cache-service.js', () => ({
  refreshPluginDataForOnlineServers: refreshPluginDataForOnlineServersMock,
}));

const { startManagerRefreshScheduler } = await import(
  '../src/service/manager-refresh-scheduler.js'
);

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

describe('manager refresh scheduler', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    restoreEnv(originalEnv);
    jest.useFakeTimers();
    refreshMasterServerListMock.mockReset().mockResolvedValue({});
    refreshAllServerQueryDataMock.mockReset().mockResolvedValue({});
    refreshPluginDataForOnlineServersMock.mockReset().mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    restoreEnv(originalEnv);
  });

  test('does not start when storage is disabled', () => {
    process.env.ENABLE_STORAGE = 'false';

    expect(startManagerRefreshScheduler()).toBeNull();
    expect(refreshMasterServerListMock).not.toHaveBeenCalled();
    expect(refreshAllServerQueryDataMock).not.toHaveBeenCalled();
    expect(refreshPluginDataForOnlineServersMock).not.toHaveBeenCalled();
  });

  test('runs master-list and query refresh loops independently', async () => {
    process.env.ENABLE_STORAGE = 'true';
    process.env.MASTER_SERVER_LIST_REFRESH_INTERVAL_MS = '60000';
    process.env.SERVER_QUERY_REFRESH_INTERVAL_MS = '120000';
    process.env.PLUGIN_DATA_REFRESH_INTERVAL_MS = '30000';

    const scheduler = startManagerRefreshScheduler();
    await jest.advanceTimersByTimeAsync(0);

    expect(refreshMasterServerListMock).toHaveBeenCalledWith({ refreshQueryData: false });
    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(1);
    expect(refreshPluginDataForOnlineServersMock).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30000);
    expect(refreshMasterServerListMock).toHaveBeenCalledTimes(1);
    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(1);
    expect(refreshPluginDataForOnlineServersMock).toHaveBeenCalledTimes(2);

    await jest.advanceTimersByTimeAsync(30000);
    expect(refreshMasterServerListMock).toHaveBeenCalledTimes(2);
    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(1);
    expect(refreshPluginDataForOnlineServersMock).toHaveBeenCalledTimes(3);

    await jest.advanceTimersByTimeAsync(60000);
    expect(refreshMasterServerListMock).toHaveBeenCalledTimes(3);
    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(2);
    expect(refreshPluginDataForOnlineServersMock).toHaveBeenCalledTimes(5);

    scheduler?.stop();
    await jest.advanceTimersByTimeAsync(120000);
    expect(refreshMasterServerListMock).toHaveBeenCalledTimes(3);
    expect(refreshAllServerQueryDataMock).toHaveBeenCalledTimes(2);
    expect(refreshPluginDataForOnlineServersMock).toHaveBeenCalledTimes(5);
  });
});
