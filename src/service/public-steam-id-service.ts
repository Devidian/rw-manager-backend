import type { RequestHandler } from 'express';
import { getUserFromBearerToken } from './auth-token-service.js';
import { AppConfig } from '../utils/app-config.js';

const STEAM_ID = /(?<!\d)\d{17}(?!\d)/g;

export function maskPublicSteamIds(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(STEAM_ID, (id) => `${id[0]}${'*'.repeat(id.length - 2)}${id.at(-1)}`);
  }
  if (Array.isArray(value)) return value.map(maskPublicSteamIds);
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      key.toLowerCase() === 'steamid' && typeof item === 'number'
        ? maskPublicSteamIds(String(item))
        : maskPublicSteamIds(item),
    ]));
  }
  return value;
}

export const maskGuestSteamIds: RequestHandler = async (req, res, next) => {
  if (req.method !== 'GET') return next();
  try {
    const user = AppConfig.enableAuth
      ? await getUserFromBearerToken(req.header('authorization'))
      : null;
    const json = res.json.bind(res);
    res.json = ((body: unknown) => {
      res.vary('Authorization');
      res.setHeader('Cache-Control', 'private, no-store');
      return json(user ? body : maskPublicSteamIds(body));
    }) as typeof res.json;
    next();
  } catch (error) {
    next(error);
  }
};

export const requirePlayerProfileAuth: RequestHandler = async (req, res, next) => {
  try {
    const user = AppConfig.enableAuth
      ? await getUserFromBearerToken(req.header('authorization'))
      : null;
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  } catch (error) {
    next(error);
  }
};
