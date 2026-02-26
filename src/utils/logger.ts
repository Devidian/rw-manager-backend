import { Console } from 'node:console';
import { createRequire } from 'node:module';
import { format, formatWithOptions } from 'node:util';
import { AppConfig } from './app-config.js';

const require = createRequire(import.meta.url);
const { name: packageName = '', version: packageVersion = '' } =
  require('../../package.json') as {
    name?: string;
    version?: string;
  };

export class Logger extends Console {
  private readonly style = AppConfig.logStyle;
  private readonly enableColors = AppConfig.enableLogColors;
  private readonly logLevel = Logger.normalizeLogLevel(AppConfig.logLevel);
  private static readonly appName = `[${packageName}@${packageVersion}]`;
  private static readonly levelWeight: Record<LoggerLevel, number> = {
    DEBUG: 10,
    INFO: 20,
    WARN: 30,
    ERROR: 40,
    CRITICAL: 50,
  };

  get app() {
    return Logger.appName;
  }

  get nameColorized() {
    if (!this.enableColors) return `[${this.name}]`;
    return '\x1b[33m' + `[${this.name}]` + '\x1b[0m';
  }

  constructor(private readonly name = '') {
    super({
      stdout: process.stdout,
      stderr: process.stderr,
      colorMode: AppConfig.enableLogColors,
    });

    this.log(
      `Log style: ${this.style}, colors: ${this.enableColors}, level: ${AppConfig.logLevel}`,
    );
  }

  private formatMessage(args: unknown[]): string {
    if (this.enableColors) {
      return formatWithOptions({ colors: true }, ...args);
    }
    return format(...args);
  }

  private static normalizeLogLevel(
    level: (typeof AppConfig)['logLevel'],
  ): NormalizedLogLevel {
    switch (level) {
      case 'all':
      case 'verbose':
      case 'debug':
        return 'debug';
      case 'info':
      case 'warn':
      case 'error':
      case 'critical':
      case 'off':
        return level;
      default:
        return 'debug';
    }
  }

  private shouldLog(level: LoggerLevel): boolean {
    if (this.logLevel === 'off') return false;
    if (this.logLevel === 'debug') return true;
    if (this.logLevel === 'info') return level !== 'DEBUG';
    if (this.logLevel === 'warn') {
      return level === 'WARN' || level === 'ERROR' || level === 'CRITICAL';
    }
    if (this.logLevel === 'error')
      return level === 'ERROR' || level === 'CRITICAL';
    if (this.logLevel === 'critical') return level === 'CRITICAL';
    return Logger.levelWeight[level] >= Logger.levelWeight.INFO;
  }

  private levelColor(level: LoggerLevel, text: string): string {
    if (!this.enableColors) return text;
    switch (level) {
      case 'DEBUG':
        return '\x1b[36m' + text + '\x1b[0m';
      case 'INFO':
        return '\x1b[32m' + text + '\x1b[0m';
      case 'WARN':
        return '\x1b[33m' + text + '\x1b[0m';
      case 'ERROR':
        return '\x1b[31m' + text + '\x1b[0m';
      case 'CRITICAL':
        return '\x1b[35m' + text + '\x1b[0m';
    }
  }

  private writeByLevel(level: LoggerLevel, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    if (this.style === 'default') {
      switch (level) {
        case 'DEBUG':
          super.debug(...args);
          return;
        case 'INFO':
          super.info(...args);
          return;
        case 'WARN':
          super.warn(...args);
          return;
        case 'ERROR':
          super.error(...args);
          return;
        case 'CRITICAL':
          super.error(...args);
          return;
      }
    }

    const message = this.formatMessage(args);
    if (this.style === 'gcp') {
      const payload = JSON.stringify({
        severity: level,
        message,
        time: new Date().toISOString(),
        pid: process.pid,
      });
      if (level === 'WARN') {
        super.warn(payload);
      } else if (level === 'ERROR' || level === 'CRITICAL') {
        super.error(payload);
      } else {
        super.log(payload);
      }
      return;
    }

    const paddedLevel = level.padStart(8);
    const output = `${this.levelColor(level, this.app)} ${this.levelColor(level, process.pid + '')} - ${new Date().toISOString()} ${this.levelColor(level, paddedLevel)} ${this.nameColorized} ${this.levelColor(level, message)}`;
    if (level === 'WARN') {
      super.warn(output);
    } else if (level === 'ERROR' || level === 'CRITICAL') {
      super.error(output);
    } else {
      super.log(output);
    }
  }

  override log(...args: unknown[]): void {
    this.writeByLevel('INFO', args);
  }

  override info(...args: unknown[]): void {
    this.writeByLevel('INFO', args);
  }

  override debug(...args: unknown[]): void {
    this.writeByLevel('DEBUG', args);
  }

  override warn(...args: unknown[]): void {
    this.writeByLevel('WARN', args);
  }

  override error(...args: unknown[]): void {
    this.writeByLevel('ERROR', args);
  }

  critical(...args: unknown[]): void {
    this.writeByLevel('CRITICAL', args);
  }
}

export const defaultLogger = new Logger('default');

type NormalizedLogLevel =
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'critical'
  | 'off';
type LoggerLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';
