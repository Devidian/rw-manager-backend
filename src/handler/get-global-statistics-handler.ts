import { Request, Response } from 'express';
import typia from 'typia';
import type { GlobalStatisticsResponse } from '../dto/global-statistics-response.js';
import { getGlobalStatistics } from '../service/server-statistics-service.js';

export async function getGlobalStatisticsHandler(req: Request, res: Response) {
  try {
    const response = await getGlobalStatistics({
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(typia.assert<GlobalStatisticsResponse>(response));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
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
