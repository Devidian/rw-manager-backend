import { duplicateGroups } from '../src/service/server-duplicate-service.js';
import type { ServerConfig } from '../src/interfaces/server-config.js';

function server(id: string, firstSeen: string, name = 'Server', overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id, label: id, name, ip: `192.0.2.${id.length}`, port: 4255,
    queryUrl: 'http://query.example', public: true,
    createdAt: new Date(firstSeen), firstSeen,
    data: { name, map: 'World', gamemode: 0, os: 'Linux' },
    info: { shortname: 'Short' }, ...overrides,
  };
}

describe('server duplicate candidates', () => {
  test('keeps the earliest observation as target and distinguishes name changes', () => {
    const groups = duplicateGroups([
      server('new', '2026-11-02T00:00:00Z', 'Renamed'),
      server('old', '2026-11-01T00:00:00Z'),
      server('same', '2026-11-03T00:00:00Z'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].targetId).toBe('old');
    expect(groups[0].entries.map((entry) => [entry.id, entry.strength])).toEqual([
      ['old', 'strong'], ['new', 'possible'], ['same', 'strong'],
    ]);
  });

  test('excludes incomplete, user-owned, and distinct-map records', () => {
    expect(duplicateGroups([
      server('a', '2026-11-01T00:00:00Z'),
      server('missing', '2026-11-02T00:00:00Z', 'Server', { info: {} }),
      server('private', '2026-11-02T00:00:00Z', 'Server', { userId: 'user' }),
      server('other', '2026-11-02T00:00:00Z', 'Server', { data: { name: 'Server', map: 'Other', gamemode: 0, os: 'Linux' } }),
    ])).toEqual([]);
  });

  test('normalizes display text and uses the master name when query data has no name', () => {
    const groups = duplicateGroups([
      server('a', '2026-11-01T00:00:00Z', 'Server', { data: { map: 'World', gamemode: 0, os: 'Linux' } }),
      server('b', '2026-11-02T00:00:00Z', 'Changed', {
        data: { name: ' CHANGED ', map: ' world ', gamemode: 0, os: 'LINUX' },
        info: { shortname: ' short ' },
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries[1]).toMatchObject({ name: 'CHANGED', strength: 'possible' });
  });

  test('does not infer identity from missing or malformed game-mode and OS data', () => {
    expect(duplicateGroups([
      server('a', '2026-11-01T00:00:00Z'),
      server('bad-mode', '2026-11-02T00:00:00Z', 'Server', { data: { name: 'Server', map: 'World', gamemode: '0', os: 'Linux' } }),
      server('bad-os', '2026-11-02T00:00:00Z', 'Server', { data: { name: 'Server', map: 'World', gamemode: 0, os: '' } }),
      server('hidden', '2026-11-02T00:00:00Z', 'Server', { public: false }),
    ])).toEqual([]);
  });
});
