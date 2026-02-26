import { Request, Response } from 'express';
import type { OkResponse } from '../dto/ok-response.js';

export function logoutHandler(_req: Request, res: Response) {
  const response: OkResponse = { ok: true };
  return res.json(response);
}
