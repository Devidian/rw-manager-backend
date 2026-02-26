import type { Format } from 'typia/lib/tags/Format.js';

export interface CreateServerRequest {
  label: string;
  queryUrl: string & Format<'url'>;
  backendUrl?: (string & Format<'url'>) | undefined;
  public?: boolean;
}
