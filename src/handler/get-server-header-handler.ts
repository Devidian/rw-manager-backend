import type { Request, Response } from 'express';
import { getServerHeader } from '../service/server-header-service.js';
import { serverIdFromRequest } from './server-route-context.js';

export async function getServerHeaderHandler(req: Request, res: Response) {
  try {
    const image = await getServerHeader(serverIdFromRequest(req) ?? '');
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.send(image.body);
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    const missing = error instanceof Error && error.message === 'SERVER_NOT_FOUND';
    return res.status(missing ? 404 : 502).json({ error: missing ? 'server not found' : 'header unavailable' });
  }
}
