import passport from 'passport';
import { Strategy as LocalStrategy } from 'passport-local';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  findUserById,
  findUserByUsername,
  toPrivateUser,
  verifyUserPassword,
} from '../db/json.js';
import { AppConfig } from '../utils/app-config.js';
import { defaultLogger } from '../utils/logger.js';

type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

type Base64Input = Buffer | string;

function toBase64Url(input: Base64Input): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(`${padded}${'='.repeat(padLength)}`, 'base64');
}

function signTokenPart(header: string, payload: string): string {
  return toBase64Url(
    createHmac('sha256', AppConfig.authSessionSecret)
      .update(`${header}.${payload}`)
      .digest(),
  );
}

passport.use(
  new LocalStrategy(
    (
      username: string,
      password: string,
      done: (
        error: Error | null,
        user?: Express.User & { id?: string },
        options?: { message: string },
      ) => void,
    ) => {
      const user = findUserByUsername(username);
      if (!user || !verifyUserPassword(user, password)) {
        return done(null, false, { message: 'Invalid username or password' });
      }
      return done(null, toPrivateUser(user));
    },
  ),
);

export function createAuthToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = {
    sub: userId,
    iat: now,
    exp: now + 60 * 60 * 24 * 7,
  };
  const encodedHeader = toBase64Url(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  );
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signTokenPart(encodedHeader, encodedPayload);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function getUserFromBearerToken(
  authorization: string | undefined,
): ReturnType<typeof toPrivateUser> | null {
  if (!authorization) return null;
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!bearerMatch) return null;

  const [encodedHeader, encodedPayload, signature] = bearerMatch[1].split('.');
  if (!encodedHeader || !encodedPayload || !signature) return null;

  const expectedSignature = signTokenPart(encodedHeader, encodedPayload);
  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    return null;
  }

  try {
    const header = JSON.parse(fromBase64Url(encodedHeader).toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;

    const payload = JSON.parse(
      fromBase64Url(encodedPayload).toString('utf8'),
    ) as JwtPayload;
    if (!payload?.sub || typeof payload.exp !== 'number') return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    defaultLogger.debug(payload);
    const user = findUserById(payload.sub);
    return user ? toPrivateUser(user) : null;
  } catch {
    return null;
  }
}

export const authMiddleware = [passport.initialize()];

export { passport };
