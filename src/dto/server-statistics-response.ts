import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

export interface ServerStatisticsResponse {
  serverId: string;
  from?: string;
  to?: string;
  buckets: ServerStatisticsBucket[];
}
