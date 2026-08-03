import express from 'express';
import { existsSync, readFileSync } from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { defaultLogger } from './utils/logger.js';
import api from './router/api-router.js';
import { startManagerRefreshScheduler } from './service/manager-refresh-scheduler.js';
import { bootstrapMongoDb, closeMongoDb } from './db/mongodb.js';
import { getBackendInfo } from './service/backend-info-service.js';
import { attachMapLiveService } from './service/map-live-service.js';

const main = async () => {
  const app = express();
  await bootstrapMongoDb();
  const refreshScheduler = startManagerRefreshScheduler();
  if (refreshScheduler) {
    const stopRefreshScheduler = () => refreshScheduler.stop();
    process.once('SIGINT', stopRefreshScheduler);
    process.once('SIGTERM', stopRefreshScheduler);
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
    res.json(getBackendInfo());
  });

  const useSSL =
    existsSync('./cert/server.key') && existsSync('./cert/server.crt');

  const options = !useSSL
    ? {}
    : {
        key: readFileSync('./cert/server.key'),
        cert: readFileSync('./cert/server.crt'),
      };

  const server = !useSSL
    ? http.createServer(app)
    : https.createServer(options, app);
  const mapLiveService = attachMapLiveService(server);
  const stopMapLiveService = () => mapLiveService.close();
  process.once('SIGINT', stopMapLiveService);
  process.once('SIGTERM', stopMapLiveService);

  if (!useSSL) {
    server.listen(3000, () => {
      defaultLogger.log(`HTTP server running on http://localhost:3000`);
    });
  } else
    server.listen(3000, () => {
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

main().catch((error) => {
  defaultLogger.critical(error);
});

process.once('SIGINT', () => {
  void closeMongoDb();
});
process.once('SIGTERM', () => {
  void closeMongoDb();
});
