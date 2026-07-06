import {
  mergeKnownPlayers,
  observedPlayerFromValue,
  observedPlayersFromValues,
  platformFromUid,
} from '../src/service/observed-player-service.js';

describe('observed player service', () => {
  test('normalizes observed live player records', () => {
    expect(platformFromUid('76561198000000000')).toBe('Steam');
    expect(platformFromUid('standalone-player')).toBe('Standalone');
    expect(observedPlayerFromValue(null, '2026-06-24T12:00:00.000Z')).toBeNull();
    expect(observedPlayerFromValue({ Name: 'No UID' }, '2026-06-24T12:00:00.000Z')).toBeNull();

    expect(observedPlayerFromValue({
      UID: '76561198000000000',
      Name: ' Steam Player ',
      id: 42,
    }, '2026-06-24T12:00:00.000Z')).toEqual({
      uid: '76561198000000000',
      name: 'Steam Player',
      id: 42,
      platform: 'Steam',
      firstseen: 1782302400,
      lastseen: 1782302400,
    });

    expect(observedPlayerFromValue({
      uid: 'standalone-player',
      id: Number.NaN,
    }, 'not-a-date')).toEqual({
      uid: 'standalone-player',
      platform: 'Standalone',
    });
  });

  test('filters invalid observed players and merges them with known players', () => {
    expect(observedPlayersFromValues(undefined, new Date())).toEqual([]);
    expect(observedPlayersFromValues([
      { uid: 'live-1', name: 'Live One' },
      { name: 'missing uid' },
    ], '2026-06-24T12:00:00.000Z')).toMatchObject([
      { uid: 'live-1', name: 'Live One' },
    ]);

    expect(mergeKnownPlayers(undefined, [])).toBeUndefined();
    expect(mergeKnownPlayers([
      { uid: 'known-1', name: 'Known', firstseen: 1 },
      { uid: '', name: 'Invalid' },
    ], [
      { uid: 'known-1', lastseen: 2 },
      { uid: 'live-1', name: 'Live', firstseen: 3 },
    ])).toEqual([
      { uid: 'known-1', name: 'Known', firstseen: 1, lastseen: 2 },
      { uid: 'live-1', name: 'Live', firstseen: 3 },
    ]);
  });
});
