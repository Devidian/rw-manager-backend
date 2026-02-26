import type { Format } from 'typia/lib/tags/Format.js';

export interface RegisterLocalUserRequest {
  username?: string;
  email: string & Format<'email'>;
  password: string;
  steamId?: string;
}
