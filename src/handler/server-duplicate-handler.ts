import type { Request, Response } from 'express';
import type { RequestWithUser } from '../interfaces/request-with-user.js';
import {
  listDuplicateGroups, mergeServers, previewServerMerge, resolveServerId,
  type MergeSelection,
} from '../service/server-duplicate-service.js';

function steamId(req: Request): string { return (req as RequestWithUser).user?.steamId ?? ''; }
function selection(value: unknown): MergeSelection {
  if (!value || typeof value !== 'object') throw new Error('MERGE_SELECTION_INVALID');
  const body = value as Record<string, unknown>;
  if (typeof body.targetId !== 'string' || !body.targetId.trim() || body.targetId.length > 200
    || !Array.isArray(body.sourceIds) || !body.sourceIds.every((id) => typeof id === 'string' && id.length <= 200)) {
    throw new Error('MERGE_SELECTION_INVALID');
  }
  return { targetId: body.targetId, sourceIds: body.sourceIds };
}
function failure(res: Response, error: unknown): Response {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
  return res.status(message === 'FORBIDDEN' ? 403 : message === 'MERGE_SELECTION_STALE' ? 409 : 400)
    .json({ error: message });
}
export async function listServerDuplicatesHandler(req: Request, res: Response) {
  try { return res.json({ groups: await listDuplicateGroups(steamId(req)) }); }
  catch (error) { return failure(res, error); }
}
export async function previewServerMergeHandler(req: Request, res: Response) {
  try { return res.json(await previewServerMerge(selection(req.body), steamId(req))); }
  catch (error) { return failure(res, error); }
}
export async function mergeServersHandler(req: Request, res: Response) {
  try { return res.json(await mergeServers(selection(req.body), steamId(req))); }
  catch (error) { return failure(res, error); }
}
export async function resolveServerIdHandler(req: Request, res: Response) {
  const id = typeof req.params.id === 'string' ? req.params.id : req.params.id?.[0];
  const canonicalId = id ? await resolveServerId(id) : undefined;
  return canonicalId ? res.json({ canonicalId }) : res.status(404).json({ error: 'SERVER_NOT_FOUND' });
}
