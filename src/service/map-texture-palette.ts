export type MapColor = [number, number, number, number];

const naturalColors: Record<number, MapColor> = {
  0: color('#1b586c'),
  1: color('#777b78'),
  2: color('#8a867c'),
  3: color('#9a9994'),
  4: color('#716d64'),
  5: color('#66513a'),
  6: color('#4c4638'),
  7: color('#705232'),
  8: color('#59462f'),
  9: color('#4d4932'),
  10: color('#554b34'),
  11: color('#5c4e35'),
  12: color('#4e5936'),
  13: color('#393735'),
  14: color('#25222b'),
  15: color('#6a3030'),
  16: color('#8a6844'),
  17: color('#d2b76f'),
  18: color('#d9c58a'),
  19: color('#a9a17c'),
  20: color('#9b7954'),
  21: color('#b48b56'),
  22: color('#c4a06a'),
  23: color('#9b5440'),
  24: color('#7b7266'),
  25: color('#edf2f2'),
  26: color('#a7d2dc'),
  27: color('#446c6b'),
  28: color('#8b7662'),
  29: color('#4c302d'),
  30: color('#a6492f'),
  31: color('#77746b'),
  32: color('#555555'),
  33: color('#313332'),
  34: color('#b5a44d'),
  35: color('#80776d'),
  36: color('#a5aaa8'),
  37: color('#676b70'),
  38: color('#b99a45'),
  39: color('#777777'),
  40: color('#777777'),
  41: color('#52763b'),
  42: color('#71834a'),
  43: color('#8b874d'),
  44: color('#77745a'),
  45: color('#869c91'),
  46: color('#3f6338'),
  47: color('#376b36'),
  48: color('#47745d'),
  49: color('#3d6654'),
  50: color('#586c3f'),
};

const fallback = color('#7a7468');
const water = color('#496f73');

const lodSurfaceColors: Record<number, MapColor> = {
  100: color('#6f7548'),
  105: color('#77784b'),
  107: color('#858553'),
  110: color('#686d46'),
  112: color('#697548'),
};

export function textureColor(textureId: number, height?: number): MapColor {
  if (height !== undefined && height <= 92) return water;
  const natural = naturalColors[textureId];
  if (natural) return natural;
  const lodSurface = lodSurfaceColors[textureId];
  if (lodSurface) return lodSurface;
  if (textureId >= 100 && textureId < 200) {
    return vary(color('#765333'), textureId, 18);
  }
  if (textureId >= 200) {
    return vary(color('#777875'), textureId, 14);
  }
  return fallback;
}

function color(hex: `#${string}`): MapColor {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
    255,
  ];
}

function vary(base: MapColor, id: number, range: number): MapColor {
  const offset = ((id * 37) % (range * 2 + 1)) - range;
  return [
    clamp(base[0] + offset),
    clamp(base[1] + offset),
    clamp(base[2] + offset),
    base[3],
  ];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, value));
}
