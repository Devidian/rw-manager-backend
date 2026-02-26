import type { UserRole, UserState } from '../interfaces/app-user.js';

export interface UpdateStorageUserRequest {
  state?: UserState;
  role?: UserRole;
}
