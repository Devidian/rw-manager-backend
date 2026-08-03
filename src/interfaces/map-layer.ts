export interface MapLayerCapabilities {
  schemaVersion: 1;
  worldName: string;
  sectorSizeChunks: 256;
  chunkSizeBlocks: 32;
  sectorSizeBlocks: 8192;
  recentPlayerDays: number;
  claims: boolean;
  claimSales: boolean;
  renewZones: boolean;
  marketplace: boolean;
  shop: boolean;
  players: boolean;
  gpsGlobalMarkers: boolean;
}

export interface MapClaim {
  areaId: number;
  name: string;
  permission: string;
  minX: number;
  minZ: number;
  width: number;
  depth: number;
  ownerName?: string;
  createdAt?: string;
  borderColor: string;
  fillColor: string;
  forSale: boolean;
  salePrice?: number;
  renewZone: boolean;
  nextRenewalAt?: string;
  marketplace: boolean;
  shop: boolean;
}

export interface MapPlayer {
  id: string;
  name: string;
  x: number;
  z: number;
  state: 'online' | 'recent-offline' | 'long-term-offline';
  lastSeen: string;
}

export interface MapGpsMarker {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  icon: string;
  color: string;
  createdAt: string;
}

export interface MapMarketplaceOffer {
  id: number;
  itemName: string;
  itemVariant: number;
  amount: number;
  price: number;
  currency: string;
  sellerName: string;
  createdAt: string;
}

export interface MapLiveSnapshot {
  capabilities: MapLayerCapabilities;
  claims: MapClaim[];
  players: MapPlayer[];
  gpsGlobalMarkers: MapGpsMarker[];
  marketplaceOffers: Record<string, MapMarketplaceOffer[]>;
}
