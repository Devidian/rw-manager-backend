import { Format } from "typia/lib/tags/Format.js";

export type UserRole = 'guest' | 'user' | 'admin';
export type UserState = 'new' | 'verified' | 'closed';

// public user interface
export interface PublicUser {
  id: string;
  username: string;
  state: UserState;
  role: UserRole;
  steamId?: string;
  pinnedServers: string[];
  createdAt: Date;
}

// private user interface (own profile, the user himself)
export interface PrivateUser extends PublicUser {
  email: string & Format<'email'>;
}

// internal user interface using josn db
export interface JsonDbUser extends PrivateUser {
  id: string & Format<'uuid'>;
  passwordHash: string;
  salt: string;
  apiTokenHash?: string;
  apiTokenSalt?: string;
  apiTokenCreatedAt?: Date;
  createdAt: Date;
}
