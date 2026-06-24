import type { Format } from 'typia/lib/tags/Format.js';

export interface ServerLiveStatusResponse {
  status: 'online' | 'offline';
  queryData?: unknown;
  infoData?: unknown;
  onlinePlayers?: unknown[];
  lastChecked: string & Format<'date-time'>;
  errorMessage?: string;
}
