import { parseNativeAdminUtilsInfo } from '../src/service/native-admin-utils-info.js';

describe('native Admin Utils info', () => {
  test('validates and normalizes public metadata', () => {
    expect(parseNativeAdminUtilsInfo({
      schemaVersion: 1,
      mapUrl: 'https://map.example.com/main/',
      adminUid: '76561198000000000',
      admins: ['76561198000000001', '76561198000000000', 'invalid'],
    })).toEqual({
      mapUrl: 'https://map.example.com/main/',
      adminUid: '76561198000000000',
      admins: ['76561198000000000', '76561198000000001'],
    });
  });

  test('rejects incomplete, invalid, and unsupported data', () => {
    expect(parseNativeAdminUtilsInfo({ schemaVersion: 2 })).toBeUndefined();
    expect(parseNativeAdminUtilsInfo({
      schemaVersion: 1,
      mapUrl: 'file:///server',
      adminUid: '1',
      admins: [],
    })).toBeUndefined();
    expect(parseNativeAdminUtilsInfo({
      schemaVersion: 1,
      mapUrl: 'https://map.example.com',
      adminUid: '18446744073709551616',
      admins: [],
    })).toBeUndefined();
  });
});
