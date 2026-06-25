import { Request, Response } from 'express';
import typia from 'typia';
import type { ServerStatisticsResponse } from '../dto/server-statistics-response.js';
import { getServerStatistics } from '../service/server-statistics-service.js';

export async function getServerStatisticsHandler(req: Request, res: Response) {
  try {
    const serverId =
      typeof req.params.id === 'string'
        ? req.params.id
        : req.params.id[0];
    const response = await getServerStatistics({
      serverId,
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(typia.assert<ServerStatisticsResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (message === 'SERVER_NOT_FOUND') {
      return res.status(404).json({ error: 'server not found' });
    }
    if (
      message === 'FROM_INVALID' ||
      message === 'TO_INVALID' ||
      message === 'DATE_RANGE_INVALID'
    ) {
      return res.status(400).json({ error: message });
    }
    return res.status(400).json({ error: message });
  }
}
