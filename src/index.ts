import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { defaultLogger } from './utils/logger.js';
import api from './router/api-router.js';
import { db } from './db/sqlite.js';
import { AppConfig } from './utils/app-config.js';
import { startMapRenderer } from './service/map-render-runtime.js';

const main = () => {
  const app = express();
  const database = db;
  if (AppConfig.enableData && !database.initializeIfAvailable()) {
    defaultLogger.debug('Rising World player database unavailable; player data API disabled');
  }
  const mapRenderer = startMapRenderer();
  if (mapRenderer) {
    const stopMapRenderer = () => mapRenderer.stop();
    process.once('SIGINT', stopMapRenderer);
    process.once('SIGTERM', stopMapRenderer);
  }

  app.use(express.json());

  // debugger middleware
  app.use((req, res, next) => {
    defaultLogger.debug(`${req.method} ${req.url}}`);
    next();
  });

  app.use('/api', api);

  app.get('/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/', (req, res) => {
    const services: string[] = [];
    if (AppConfig.enableStorage) services.push('storage');
    if (AppConfig.enableData) services.push('data');
    if (AppConfig.enableAuth) services.push('auth');
    if (AppConfig.forceAuth) services.push('forceAuth');

    res.json({ ok: true, services, version: 1 });
  });

  const useSSL =
    existsSync('./cert/server.key') && existsSync('./cert/server.crt');

  const options = !useSSL
    ? {}
    : {
        key: readFileSync('./cert/server.key'),
        cert: readFileSync('./cert/server.crt'),
      };

  if (!useSSL) {
    http.createServer(app).listen(3000, () => {
      defaultLogger.log(`HTTP server running on http://localhost:3000`);
    });
  } else
    https.createServer(options, app).listen(3000, () => {
      defaultLogger.log(`HTTPS server running on https://localhost:3000`);
    });
};

process.on('unhandledRejection', function (error: Error) {
  error = error instanceof Error ? error : new Error('UnhandledRejection');
  error.message = '(UnhandledRejection) ' + error.message;
  defaultLogger.critical(error, error.stack);
});

process.on('uncaughtException', function (error) {
  error = error instanceof Error ? error : new Error('UnhandledException');
  error.message = '(UnhandledException) ' + error.message;
  defaultLogger.critical(error, error.stack);
});

try {
  main();
} catch (error) {
  defaultLogger.critical(error);
}
