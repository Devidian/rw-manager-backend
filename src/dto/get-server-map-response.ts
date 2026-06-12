import type { MapMetadata } from '../interfaces/map-metadata.js';

export interface GetServerMapAvailableResponse {
  available: true;
  metadata: MapMetadata;
}

export interface GetServerMapUnavailableResponse {
  available: false;
}

export type GetServerMapResponse =
  | GetServerMapAvailableResponse
  | GetServerMapUnavailableResponse;
