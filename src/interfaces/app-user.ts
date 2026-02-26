import { Pattern } from "typia/lib/tags/Pattern.js";

export type UserRole = 'guest' | 'user' | 'admin';
export type UserState = 'new' | 'verified' | 'closed';

// public user interface
export interface PublicUser {
  id: string;
  username: string;
  state: UserState;
  role: UserRole;
  steamId?: string;
  createdAt: Date;
}

// private user interface (own profile, the user himself)
export interface PrivateUser extends PublicUser {
  email: string & Pattern<'email'>;
}

// internal user interface using josn db
export interface JsonDbUser extends PrivateUser {
  id: string & Pattern<'uuid'>;
  passwordHash: string;
  salt: string;
  createdAt: Date;
}