import { jest } from '@jest/globals';

const durable = new Set<string>();
let useMongo = false;
const mongo = { suppressedServers: {
  findOne: jest.fn(async ({ endpoint }: { endpoint: { $in: string[] } }) =>
    endpoint.$in.some((key) => durable.has(key)) ? { endpoint: endpoint.$in[0] } : null),
  updateOne: jest.fn(async ({ endpoint }: { endpoint: string }) => { durable.add(endpoint); }),
  deleteMany: jest.fn(async ({ endpoint }: { endpoint: { $in: string[] } }) => {
    endpoint.$in.forEach((key) => durable.delete(key));
  }),
} };
jest.unstable_mockModule('../src/db/mongodb.js', () => ({ getMongoCollections: () => useMongo ? mongo : undefined }));
const suppression = await import('../src/service/server-suppression-service.js');

test('deleted endpoints stay suppressed until the owner approves them again', async () => {
  await suppression.suppressServer('192.0.2.12', 4255, 'http://192.0.2.12:4254/');
  expect(await suppression.isServerSuppressed('192.0.2.12', 4255)).toBe(true);
  expect(await suppression.isServerSuppressed(undefined, undefined, 'http://192.0.2.12:4254')).toBe(true);
  expect(await suppression.isServerSuppressed('192.0.2.13', 4255)).toBe(false);
  await suppression.unsuppressServer('192.0.2.12', 4255, 'http://192.0.2.12:4254');
  expect(await suppression.isServerSuppressed('192.0.2.12', 4255)).toBe(false);
});

test('Mongo suppression is recorded durably and can be lifted', async () => {
  useMongo = true;
  try {
    await suppression.suppressServer('192.0.2.22', 4255, 'http://192.0.2.22:4254');
    expect(durable.size).toBe(2);
    expect(await suppression.isServerSuppressed('192.0.2.22', 4255)).toBe(true);
    await suppression.unsuppressServer('192.0.2.22', 4255, 'http://192.0.2.22:4254');
    expect(await suppression.isServerSuppressed('192.0.2.22', 4255)).toBe(false);
  } finally {
    useMongo = false;
    durable.clear();
  }
});
