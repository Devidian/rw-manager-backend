import { AppConfig } from '../utils/app-config.js';
import type { SteamAuthRequest } from '../dto/steam-auth-request.js';

const STEAM_OPENID_URL = 'https://steamcommunity.com/openid/login';
const CLAIMED_ID = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;
const NONCE_TTL_MS = 10 * 60 * 1000;
const usedNonces = new Map<string, number>();
const pendingNonces = new Set<string>();

/** Verify Steam's signed OpenID response before trusting a claimed Steam ID. */
export async function verifySteamOpenId(input: SteamAuthRequest): Promise<string> {
  const claimedId = input['openid.claimed_id'];
  const identity = input['openid.identity'];
  const steamId = claimedId && CLAIMED_ID.exec(claimedId)?.[1];
  const origin = AppConfig.steamOpenIdReturnOrigin;
  if (!steamId || identity !== claimedId || !origin ||
      input['openid.ns'] !== 'http://specs.openid.net/auth/2.0' ||
      input['openid.mode'] !== 'id_res' ||
      input['openid.op_endpoint'] !== STEAM_OPENID_URL ||
      typeof input['openid.sig'] !== 'string' || !input['openid.sig'] ||
      typeof input['openid.assoc_handle'] !== 'string' ||
      typeof input['openid.signed'] !== 'string') {
    throw new Error('OPEN_ID_INVALID');
  }

  const signed = new Set(input['openid.signed'].split(','));
  if (['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']
    .some((field) => !signed.has(field))) {
    throw new Error('OPEN_ID_INVALID');
  }

  const returnTo = input['openid.return_to'];
  try {
    const url = new URL(returnTo ?? '');
    if (url.origin !== origin || !url.pathname.endsWith('/auth/steam/callback') || url.search) {
      throw new Error('OPEN_ID_INVALID');
    }
  } catch {
    throw new Error('OPEN_ID_INVALID');
  }

  const nonce = input['openid.response_nonce'];
  if (!nonce || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z.+$/.test(nonce)) {
    throw new Error('OPEN_ID_INVALID');
  }
  const nonceTime = Date.parse(nonce.slice(0, 20));
  const now = Date.now();
  if (!Number.isFinite(nonceTime) || nonceTime < now - NONCE_TTL_MS || nonceTime > now + 60_000) {
    throw new Error('OPEN_ID_INVALID');
  }
  for (const [key, expiry] of usedNonces) {
    if (expiry <= now) usedNonces.delete(key);
  }
  if (usedNonces.has(nonce) || pendingNonces.has(nonce)) throw new Error('OPEN_ID_INVALID');
  pendingNonces.add(nonce);

  try {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith('openid.') && typeof value === 'string') form.set(key, value);
    }
    form.set('openid.mode', 'check_authentication');
    const response = await fetch(STEAM_OPENID_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !(await response.text()).split(/\r?\n/).includes('is_valid:true')) {
      throw new Error('OPEN_ID_INVALID');
    }
    usedNonces.set(nonce, now + NONCE_TTL_MS);
    return steamId;
  } catch {
    throw new Error('OPEN_ID_INVALID');
  } finally {
    pendingNonces.delete(nonce);
  }
}
