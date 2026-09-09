import { afterEach, describe, expect, it, jest } from '@jest/globals';

const warn = jest.fn();
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  defaultLogger: { warn },
}));

const { getCachedOZPluginLatestVersions, refreshOZPluginLatestVersions } = await import('../src/service/oz-plugin-release-service.js');

describe('OZ plugin release inventory', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    warn.mockClear();
  });

  it('caches valid public release tags and ignores unavailable or malformed releases', async () => {
    const fetchMock = jest.fn<typeof fetch>()
      .mockResolvedValueOnce(response({ tag_name: 'v0.24.1' }))
      .mockResolvedValueOnce(response({ tag_name: '   ' }))
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({}, 404))
      .mockRejectedValueOnce(new Error('network unavailable'));
    jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock);

    await refreshOZPluginLatestVersions();

    expect(fetchMock).toHaveBeenCalledTimes(12);
    expect(getCachedOZPluginLatestVersions()).toEqual({ 'OZ - Tools': '0.24.1' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('retains the last good inventory and warns when no repository returns a usable release', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(response({}, 503));

    await refreshOZPluginLatestVersions();

    expect(getCachedOZPluginLatestVersions()).toEqual({ 'OZ - Tools': '0.24.1' });
    expect(warn).toHaveBeenCalledWith('OZ plugin release inventory refresh did not return a release');
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}
