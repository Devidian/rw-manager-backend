import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { ServerConfig } from '../interfaces/server-config.js';
import { AppConfig } from '../utils/app-config.js';

export function gameConnectorAuthorizationHeader(server: Pick<ServerConfig, 'connectorCredential'>): string | undefined {
  if (!server.connectorCredential || !AppConfig.gameConnectorCredentialKey) return undefined;
  const credential = decryptGameConnectorCredential(server.connectorCredential, AppConfig.gameConnectorCredentialKey);
  return credential ? `Bearer ${credential}` : undefined;
}

export function createGameConnectorCredential(): string {
  return randomBytes(32).toString('base64url');
}

export function encryptGameConnectorCredential(credential: string, secret: string): string {
  const key = createHash('sha256').update(secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptGameConnectorCredential(value: string, secret: string): string | undefined {
  const [version, ivText, tagText, ciphertextText] = value.split(':');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) return undefined;
  try {
    const key = createHash('sha256').update(secret).digest();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return undefined;
  }
}
