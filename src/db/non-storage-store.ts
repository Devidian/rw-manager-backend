import type { JsonDbUser } from '../interfaces/app-user.js';
import type { ServerConfig } from '../interfaces/server-config.js';
import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

/**
 * Deliberately ephemeral state for deployments with ENABLE_STORAGE=false.
 * Persistent manager data is MongoDB-only; this keeps optional API features
 * usable in development without creating a second on-disk data format.
 */
export const nonStorageDb: {
  data: {
    servers: ServerConfig[];
    users: JsonDbUser[];
    serverStatistics?: ServerStatisticsBucket[];
  };
  write: () => Promise<void>;
} = {
  data: { servers: [], users: [], serverStatistics: [] },
  write: async () => undefined,
};
