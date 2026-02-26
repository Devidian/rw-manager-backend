export interface DbPlayer {
  id: number;
  uid: string;
  name: string;
  posx: number;
  posy: number;
  posz: number;
  rotx: number;
  roty: number;
  rotz: number;
  rotw: number;
  platform: string;
  permissiongroup: string;
  health: number;
  hunger: number;
  thirst: number;
  brokenbones: number;
  temperature: number;
  dead: number;
  flying: number;
  clothes: string; // hex-Buffer
  primaryspawn: string; // hex-Buffer
  secondaryspawn: string; // hex-Buffer
  tertiaryspawn: string; // hex-Buffer
  lastspawn: number;
  lastusedmount: number;
  lastusedvehicle: number;
  playtime: number;
  firstseen: number;
  lastseen: number;
}
