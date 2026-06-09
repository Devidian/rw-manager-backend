import { jest } from '@jest/globals';
import { Console } from 'node:console';

function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }
  Object.assign(process.env, snapshot);
}

async function loadLoggerModule(envOverrides: NodeJS.ProcessEnv = {}) {
  restoreEnv(originalEnv);
  Object.assign(process.env, envOverrides);
  jest.resetModules();
  return import('../src/utils/logger.js');
}

const originalEnv = { ...process.env };

describe('logger', () => {
  let logSpy: jest.SpiedFunction<typeof Console.prototype.log>;
  let infoSpy: jest.SpiedFunction<typeof Console.prototype.info>;
  let debugSpy: jest.SpiedFunction<typeof Console.prototype.debug>;
  let warnSpy: jest.SpiedFunction<typeof Console.prototype.warn>;
  let errorSpy: jest.SpiedFunction<typeof Console.prototype.error>;

  beforeEach(() => {
    logSpy = jest.spyOn(Console.prototype, 'log').mockImplementation(() => {});
    infoSpy = jest.spyOn(Console.prototype, 'info').mockImplementation(() => {});
    debugSpy = jest.spyOn(Console.prototype, 'debug').mockImplementation(() => {});
    warnSpy = jest.spyOn(Console.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(Console.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    restoreEnv(originalEnv);
  });

  test('logs through default console methods for default style and debug level', async () => {
    const { Logger } = await loadLoggerModule({
      LOG_STYLE: 'default',
      LOG_LEVEL: 'debug',
      ENABLE_LOG_COLORS: 'false',
    });

    const logger = new Logger('test');
    logSpy.mockClear();
    infoSpy.mockClear();
    debugSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();

    expect(logger.app).toContain('rw-manager-backend@');
    expect(logger.nameColorized).toBe('[test]');

    logger.debug('debug');
    logger.info('info');
    logger.warn('warn');
    logger.error('error');
    logger.critical('critical');

    expect(debugSpy).toHaveBeenCalledWith('debug');
    expect(infoSpy).toHaveBeenCalledWith('info');
    expect(warnSpy).toHaveBeenCalledWith('warn');
    expect(errorSpy).toHaveBeenCalledWith('error');
    expect(errorSpy).toHaveBeenCalledWith('critical');
  });

  test('suppresses lower levels according to configured log levels', async () => {
    const { Logger } = await loadLoggerModule({
      LOG_STYLE: 'default',
      LOG_LEVEL: 'warn',
      ENABLE_LOG_COLORS: 'false',
    });

    const warnLogger = new Logger('warn');
    logSpy.mockClear();
    infoSpy.mockClear();
    debugSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
    warnLogger.debug('skip');
    warnLogger.info('skip');
    warnLogger.warn('warn');
    warnLogger.error('error');
    warnLogger.critical('critical');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith('warn');
    expect(errorSpy).toHaveBeenCalledWith('error');
    expect(errorSpy).toHaveBeenCalledWith('critical');

    const { Logger: OffLogger } = await loadLoggerModule({
      LOG_STYLE: 'default',
      LOG_LEVEL: 'off',
      ENABLE_LOG_COLORS: 'false',
    });
    const offLogger = new OffLogger('off');
    logSpy.mockClear();
    offLogger.info('hidden');
    expect(logSpy).not.toHaveBeenCalled();
  });

  test('emits structured gcp payloads and detailed colored logs', async () => {
    const { Logger: GcpLogger } = await loadLoggerModule({
      LOG_STYLE: 'gcp',
      LOG_LEVEL: 'all',
      ENABLE_LOG_COLORS: 'true',
    });

    const gcpLogger = new GcpLogger('gcp');
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();

    gcpLogger.info('hello', { ok: true });
    gcpLogger.warn('warn');
    gcpLogger.error('error');

    const infoPayload = logSpy.mock.calls[0][0];
    expect(typeof infoPayload).toBe('string');
    expect(JSON.parse(String(infoPayload))).toMatchObject({
      severity: 'INFO',
    });
    expect(JSON.parse(String(warnSpy.mock.calls[0][0]))).toMatchObject({
      severity: 'WARN',
    });
    expect(JSON.parse(String(errorSpy.mock.calls[0][0]))).toMatchObject({
      severity: 'ERROR',
    });

    const { Logger: DetailedLogger } = await loadLoggerModule({
      LOG_STYLE: 'detailed',
      LOG_LEVEL: 'debug',
      ENABLE_LOG_COLORS: 'true',
    });

    const detailedLogger = new DetailedLogger('detail');
    logSpy.mockClear();
    warnSpy.mockClear();
    errorSpy.mockClear();
    debugSpy.mockClear();
    infoSpy.mockClear();
    expect(detailedLogger.nameColorized).toContain('\x1b[33m');

    detailedLogger.debug('debug');
    detailedLogger.info('info');
    detailedLogger.warn('warn');
    detailedLogger.error('error');
    detailedLogger.critical('visible');

    expect(logSpy).toHaveBeenCalledTimes(2);
    expect(String(logSpy.mock.calls[0][0])).toContain('\x1b[36m');
    expect(String(logSpy.mock.calls[1][0])).toContain('\x1b[32m');
    expect(String(warnSpy.mock.calls[0][0])).toContain('\x1b[33m');
    expect(String(errorSpy.mock.calls[0][0])).toContain('\x1b[31m');
    expect(String(errorSpy.mock.calls[1][0])).toContain('visible');
    expect(String(errorSpy.mock.calls[1][0])).toContain('\x1b[35m');
  });

  test('covers internal normalization and fallback branches', async () => {
    const { Logger } = await loadLoggerModule({
      LOG_STYLE: 'detailed',
      LOG_LEVEL: 'error',
      ENABLE_LOG_COLORS: 'false',
    });

    const logger = new Logger('detail');
    logSpy.mockClear();
    errorSpy.mockClear();

    logger.error({ message: 'plain' });
    expect(String(errorSpy.mock.calls[0][0])).toContain('plain');

    expect(Logger['normalizeLogLevel']('mystery')).toBe('debug');

    const mutableLogger = logger as unknown as {
      logLevel: string;
      shouldLog: (level: 'INFO') => boolean;
    };
    mutableLogger.logLevel = 'mystery';
    expect(mutableLogger.shouldLog('INFO')).toBe(true);
  });
});
