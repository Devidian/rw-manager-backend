import { nativePluginRouteId, parseNativePluginList } from '../src/service/native-plugin-list.js';

describe('native plugin list', () => {
  test('derives game-owned route IDs without collapsing punctuation', () => {
    expect(nativePluginRouteId('OZ - Admin Utils')).toBe('oz---admin-utils');
    expect(nativePluginRouteId('OZ GPS')).toBe('oz-gps');
  });

  test('normalizes a valid game plugin list without bridge-only fields', () => {
    expect(parseNativePluginList(JSON.stringify({
      plugincount: 2,
      plugins: [
        { name: 'OZ - Admin Utils', version: 'OZ - Admin Utils\nVersion: 1.2.3' },
        { name: 'No Manifest Version', version: 'metadata only' },
      ],
    }))).toEqual([
      { name: 'OZ - Admin Utils', version: '1.2.3', valid: true },
      { name: 'No Manifest Version', version: undefined, valid: true },
    ]);
  });

  test('repairs only literal newlines within JSON strings', () => {
    const raw = '{"plugincount":1,"plugins":[{"name":"OZ - GPS","version":"* Plugin: OZ - GPS\n* Version: 0.8.0\n* Load Order: 1"}]}';
    expect(parseNativePluginList(raw)).toEqual([
      { name: 'OZ - GPS', version: '0.8.0', valid: true },
    ]);
    expect(parseNativePluginList('{"plugins": [}')).toBeUndefined();
  });
});
