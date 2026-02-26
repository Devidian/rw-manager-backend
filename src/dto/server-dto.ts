import type { Format } from 'typia/lib/tags/Format.js';

export interface ServerDto {
  id: string;
  label: string;
  queryUrl: string & Format<'url'>;
  backendUrl?: (string & Format<'url'>) | undefined;
  public: boolean;
  createdAt: string & Format<'date-time'>;
  userId?: string | undefined;
}
