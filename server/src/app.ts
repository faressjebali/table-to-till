import express, { type ErrorRequestHandler, type Express } from 'express';
import { authRoutes } from './auth/routes.js';
import type { Config } from './config.js';
import type { Db } from './db.js';
import { errorBody, HttpError } from './errors.js';
import { menuRoutes } from './menu/routes.js';
import { orderRoutes } from './orders/routes.js';
import { stationRoutes } from './orders/station-routes.js';
import { posRoutes } from './pos/routes.js';
import { pushRoutes } from './push/routes.js';
import { noopPushSender, type PushSender } from './push/send.js';
import { noopRealtime, type Realtime } from './realtime.js';
import { shiftRoutes } from './shifts/routes.js';
import { adminTableRoutes } from './tables/admin-routes.js';
import { tableRoutes } from './tables/routes.js';
import { userRoutes } from './users/routes.js';

export function createApp({
  db,
  config,
  realtime = noopRealtime,
  push = noopPushSender,
}: {
  db: Db;
  config: Config;
  // Absent : rien n'est envoyé en temps réel (tests REST).
  realtime?: Realtime;
  // Absent : aucune notification push (tests, clés VAPID vides).
  push?: PushSender;
}): Express {
  const app = express();
  app.use(express.json());

  const api = express.Router();
  api.use(authRoutes(db, config, realtime));
  api.use(userRoutes(db, config, realtime));
  api.use(menuRoutes(db, config, realtime));
  api.use(shiftRoutes(db, config, realtime));
  api.use(tableRoutes(db, config));
  api.use(adminTableRoutes(db, config));
  api.use(orderRoutes(db, config, realtime, push));
  api.use(stationRoutes(db, config, realtime, push));
  api.use(pushRoutes(db, config));
  api.use(posRoutes(db, config, realtime));
  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json(errorBody('NOT_FOUND', 'Not found'));
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json(errorBody(err.code, err.message, err.details));
      return;
    }
    // JSON mal formé envoyé par le client
    if (err instanceof SyntaxError && 'body' in err) {
      res.status(400).json(errorBody('VALIDATION_ERROR', 'Invalid JSON'));
      return;
    }
    console.error(err);
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Internal error'));
  };
  app.use(onError);

  return app;
}
