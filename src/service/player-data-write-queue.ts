const queues = new Map<string, Promise<unknown>>();

/** Orders exports and erasures for each game server without blocking other servers. */
export async function serializePlayerDataWrite<T>(serverId: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(serverId) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(action);
  queues.set(serverId, pending);
  try {
    return await pending;
  } finally {
    if (queues.get(serverId) === pending) queues.delete(serverId);
  }
}
