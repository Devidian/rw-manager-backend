export interface ServerStatisticsBucket {
  id: string;
  serverId: string;
  hourStart: string;
  sampleCount: number;
  onlineSampleCount: number;
  playerSampleTotal: number;
  maxPlayers: number;
  averagePlayers: number;
  availability: number;
  onlinePlayerUids: string[];
  updatedAt: string;
}

export interface ServerStatisticsSample {
  serverId: string;
  sampledAt: Date;
  online: boolean;
  playerCount: number;
  onlinePlayerUids?: string[];
}
