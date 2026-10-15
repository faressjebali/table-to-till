import express, { type ErrorRequestHandler, type Express } from 'express';

// Format d'erreur défini dans docs/api.md (§ Erreurs).
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function createApp(): Express {
  const app = express();
  app.use(express.json());

  const api = express.Router();
  // Les routes de docs/api.md seront montées ici.
  app.use('/api', api);

  app.use((_req, res) => {
    res.status(404).json(errorBody('NOT_FOUND', 'Not found'));
  });

  const onError: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
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
