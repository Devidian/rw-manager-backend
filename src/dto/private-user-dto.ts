import { Format } from 'typia/lib/tags/Format.js';
import type { PublicUserDto } from './public-user-dto.js';

export interface PrivateUserDto extends PublicUserDto {
  email: string & Format<'email'>;
}
