import { jest } from '@jest/globals';

const findServerById = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule('../src/db/manager-store.js', () => ({ findServerById }));
const { getServerHeader } = await import('../src/service/server-header-service.js');
const originalFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();

beforeEach(() => {
  findServerById.mockResolvedValue({ queryUrl: 'http://game.example:4255/prefix/' });
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterAll(() => { global.fetch = originalFetch; });

test('proxies binary images using the stored URL and disables redirects', async () => {
  fetchMock.mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }));
  const result = await getServerHeader('server-1');
  expect(result.body).toEqual(Buffer.from([137, 80, 78, 71]));
  expect(result.contentType).toBe('image/png');
  expect(String(fetchMock.mock.calls[0][0])).toBe('http://game.example:4255/prefix/images/header');
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
});

test('does not fetch for unknown servers', async () => {
  findServerById.mockResolvedValue(undefined);
  await expect(getServerHeader('missing')).rejects.toThrow('SERVER_NOT_FOUND');
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(['text/html', 'image/svg+xml'])('rejects active content %s', async (type) => {
  fetchMock.mockResolvedValue(new Response('<html/>', { headers: { 'Content-Type': type } }));
  await expect(getServerHeader('server-1')).rejects.toThrow('HEADER_UNAVAILABLE');
});

test('rejects oversized streamed images without content-length', async () => {
  fetchMock.mockResolvedValue(new Response(new Uint8Array(5 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }));
  await expect(getServerHeader('server-1')).rejects.toThrow('HEADER_UNAVAILABLE');
});

test('rejects upstream errors', async () => {
  fetchMock.mockResolvedValue(new Response('missing', { status: 404 }));
  await expect(getServerHeader('server-1')).rejects.toThrow('HEADER_UNAVAILABLE');
});
