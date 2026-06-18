export interface MapLayerCapabilities {
  schemaVersion: 1;
  worldName: string;
  sectorSizeChunks: 32;
  chunkSizeBlocks: 32;
  sectorSizeBlocks: 1024;
  recentPlayerDays: number;
  claims: boolean;
  claimSales: boolean;
  marketplace: boolean;
  shop: boolean;
  players: boolean;
  onlinePlayers: boolean;
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
