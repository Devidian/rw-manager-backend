import { findServerById } from '../db/manager-store.js';

const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function getServerHeader(serverId: string) {
  const server = await findServerById(serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');
  const url = new URL(`${server.queryUrl.replace(/\/+$/, '')}/images/header`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('HEADER_UNAVAILABLE');
  }
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
    headers: { Accept: [...IMAGE_TYPES].join(', ') },
  });
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!response.ok || !contentType || !IMAGE_TYPES.has(contentType)
    || Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('HEADER_UNAVAILABLE');
  }
  if (!response.body) throw new Error('HEADER_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('HEADER_UNAVAILABLE');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  if (!size) throw new Error('HEADER_UNAVAILABLE');
  return { contentType, body: Buffer.concat(chunks) };
}
