import { existsSync } from 'node:fs';
import path from 'node:path';
import { propertiesReader } from 'properties-reader';
import { defaultLogger } from './logger.js';
import { AppConfig } from './app-config.js';

export class ServerConfig {
  static getProperties(rootPath: string = AppConfig.rootPath) {
    const configPath = path.resolve(`${rootPath}/server.properties`);

    if (!existsSync(configPath)) {
      throw new Error(`Config file not found at ${configPath}`);
    }

    const properties = propertiesReader({ sourceFile: configPath });
    const allProperties = Object.fromEntries(
      properties.entries({ parsed: true }),
    );
    for (const sensitiveKey of Object.keys(allProperties).filter((n) =>
      n.toLowerCase().includes('password'),
    )) {
      defaultLogger.debug(`removed sensitive key ${sensitiveKey} from config`);
      allProperties[sensitiveKey] = '***';
    }
    // Force Admins to be string as it should be string with more than 1 admin
    if (typeof allProperties['Server_Admins'] !== 'string')
      allProperties['Server_Admins'] = properties.getRaw('Server_Admins') ?? '';

    return allProperties;
  }

  static getWorldName(rootPath: string = AppConfig.rootPath): string {
    const props = ServerConfig.getProperties(rootPath);
    return props['World_Name']?.toString() ?? 'default';
  }
}
