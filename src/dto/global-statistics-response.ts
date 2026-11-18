import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

export interface GlobalStatisticsResponse {
  from?: string;
  to?: string;
  buckets: Array<Omit<ServerStatisticsBucket, 'onlinePlayerUids' | 'onlinePlayerIds'>>;
}
