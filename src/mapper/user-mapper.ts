import type { PrivateUserDto } from '../dto/private-user-dto.js';
import type { PublicUserDto } from '../dto/public-user-dto.js';
import type { PrivateUser, PublicUser } from '../interfaces/app-user.js';
import { mapDateTimeString } from './date-time-mapper.js';

export function mapPublicUserToDto(user: PublicUser): PublicUserDto {
  return {
    id: user.id,
    username: user.username,
    state: user.state,
    role: user.role,
    steamId: user.steamId,
    createdAt: mapDateTimeString(user.createdAt) as PublicUserDto['createdAt'],
  };
}

export function mapPrivateUserToDto(user: PrivateUser): PrivateUserDto {
  return {
    ...mapPublicUserToDto(user),
    email: user.email as PrivateUserDto['email'],
  };
}
