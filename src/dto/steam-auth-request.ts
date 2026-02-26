export interface SteamAuthRequest {
  openId?: string;
  'openid.ns'?: string;
  'openid.mode'?: string;
  'openid.claimed_id'?: string;
  'openid.identity'?: string;
  'openid.return_to'?: string;
  'openid.response_nonce'?: string;
  'openid.assoc_handle'?: string;
  'openid.signed'?: string;
  'openid.sig'?: string;
}
