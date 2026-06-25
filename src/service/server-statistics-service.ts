import { findServerById } from '../db/manager-store.js';
import { listServerStatisticsBuckets } from '../db/server-statistics-store.js';
import type { ServerStatisticsResponse } from '../dto/server-statistics-response.js';

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field.toUpperCase()}_INVALID`);
  }
  return date;
}

export async function getServerStatistics(params: {
  serverId: string;
  from?: unknown;
  to?: unknown;
}): Promise<ServerStatisticsResponse> {
  const server = await findServerById(params.serverId);
  if (!server) throw new Error('SERVER_NOT_FOUND');

  const from = parseDate(params.from, 'from');
  const to = parseDate(params.to, 'to');
  if (from && to && from >= to) {
    throw new Error('DATE_RANGE_INVALID');
  }

  const buckets = await listServerStatisticsBuckets({
    serverId: params.serverId,
    from,
    to,
  });
  return {
    serverId: params.serverId,
    from: from?.toISOString(),
    to: to?.toISOString(),
    buckets,
  };
}
