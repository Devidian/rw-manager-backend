import type { PrivateUserDto } from './private-user-dto.js';

export interface AuthUserTokenResponse {
  user: PrivateUserDto;
  token: string;
}
