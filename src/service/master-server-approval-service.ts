import { findServerById, insertMasterServerIfAbsent } from '../db/manager-store.js';
import { mapServerToDto } from '../mapper/server-mapper.js';
import { AppConfig } from '../utils/app-config.js';
import { cachedMasterById, removeCachedMasterEndpoint } from './master-only-cache-service.js';
import { isServerSuppressed } from './server-suppression-service.js';

export class MasterServerApprovalError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export async function approveMasterServer(id: string, verifiedSteamId: string) {
  const candidate = cachedMasterById(id);
  if (!candidate?.queryUrl || !candidate.ip || !candidate.port) {
    if (await findServerById(id)) throw new MasterServerApprovalError(409, 'SERVER_ALREADY_APPROVED');
    throw new MasterServerApprovalError(404, 'MASTER_SERVER_NO_LONGER_LISTED');
  }

  let info: { contact?: unknown; name?: unknown };
  try {
    const response = await fetch(new URL('info', candidate.queryUrl.replace(/\/+$/, '') + '/'), {
      signal: AbortSignal.timeout(AppConfig.liveQueryProxyTimeoutMs),
      redirect: 'error',
    });
    if (!response.ok) throw new Error('Invalid info response');
    info = await response.json();
    if (!info || typeof info !== 'object' || Array.isArray(info)) throw new Error('Invalid info payload');
  } catch {
    throw new MasterServerApprovalError(502, 'SERVER_INFO_UNAVAILABLE');
  }
  if (info.contact !== verifiedSteamId) throw new MasterServerApprovalError(403, 'SERVER_CONTACT_MISMATCH');
  if (await isServerSuppressed(candidate.ip, candidate.port, candidate.queryUrl)) {
    throw new MasterServerApprovalError(409, 'SERVER_SUPPRESSED');
  }

  const approved = {
    ...candidate,
    label: typeof info.name === 'string' && info.name.trim() ? info.name.trim() : candidate.label,
    info,
    public: true,
  };
  if (!await insertMasterServerIfAbsent(approved, candidate.ip, candidate.port)) {
    throw new MasterServerApprovalError(409, 'SERVER_ALREADY_APPROVED');
  }
  removeCachedMasterEndpoint(candidate.ip, candidate.port);
  return { ...mapServerToDto(approved), dashboardVisible: true, canDelete: true };
}
