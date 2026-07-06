import type { ServerStatisticsBucket } from '../interfaces/server-statistics.js';

export interface GlobalStatisticsPlayer {
  uid: string;
  name?: string;
}

export interface GlobalStatisticsResponse {
  from?: string;
  to?: string;
  buckets: ServerStatisticsBucket[];
  players: GlobalStatisticsPlayer[];
}
