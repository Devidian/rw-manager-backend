export interface GlobalPlayerSample {
  sampledAt: string;
  playerCount: number;
}

export interface GlobalPlayerHour {
  hourStart: string;
  samples: GlobalPlayerSample[];
}

export interface GlobalPlayerBucket {
  hourStart: string;
  sampleCount: number;
  minPlayers: number;
  maxPlayers: number;
  averagePlayers: number;
}
