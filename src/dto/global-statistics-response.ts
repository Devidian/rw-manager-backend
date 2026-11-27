import type { GlobalPlayerBucket } from '../interfaces/global-player-statistics.js';
import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

export interface GlobalStatisticsResponse {
  globalPlayerBuckets?: GlobalPlayerBucket[];
  from?: string;
  to?: string;
  buckets: Array<Omit<ServerStatisticsBucket, 'onlinePlayerUids' | 'onlinePlayerIds'>>;
}
