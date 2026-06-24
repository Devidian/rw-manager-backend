import type { Format } from 'typia/lib/tags/Format.js';
import type { UserRole, UserState } from '../interfaces/app-user.js';

export interface PublicUserDto {
  id: string;
  username: string;
  state: UserState;
  role: UserRole;
  steamId?: string | undefined;
  pinnedServers: string[];
  createdAt: string & Format<'date-time'>;
}
