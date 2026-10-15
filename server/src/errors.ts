import type { ZodError } from 'zod';

// Format d'erreur défini dans docs/api.md (§ Erreurs).
export function errorBody(code: string, message: string, details?: unknown) {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}

// Erreur attendue (mauvais rôle, compte bloqué…) : renvoyée telle quelle au client.
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function validationError(error: ZodError): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', 'Invalid request body', {
    fields: error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
  });
}
