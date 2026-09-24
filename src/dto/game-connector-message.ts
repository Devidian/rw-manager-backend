/** Versioned inbound contract for the game-server connector. */
export interface ConnectorProvisionRequest {
  type: 'connector.provision';
  schemaVersion: 1;
  gamePort: number;
}

export interface ConnectorAuthenticateRequest {
  type: 'connector.authenticate';
  schemaVersion: 1;
  credential: string;
}

export interface ConnectorFeaturesRequest {
  type: 'connector.features';
  schemaVersion: 1;
  events: string[];
}

export interface ConnectorEventRequest {
  type: 'connector.event';
  schemaVersion: 1;
  event: string;
  sequence: number;
  data: unknown;
}

export type ConnectorFirstMessage = ConnectorProvisionRequest | ConnectorAuthenticateRequest;
export type ConnectorSessionMessage = ConnectorFeaturesRequest | ConnectorEventRequest;
