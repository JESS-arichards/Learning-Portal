import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { MulterError } from 'multer';
import pino from 'pino';
import { isTransientSqlError } from './availability.js';

export const logger = pino({ redact: ['req.headers.cookie', 'req.headers.authorization', 'req.body', 'password', 'token'] });
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function createErrorHandler(serverless = false): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) { logger.error({ err: error }, 'Response stream failed'); next(error); return; }
    if (error instanceof ZodError) { res.status(400).json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }); return; }
    if (error instanceof MulterError) { res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the upload size limit.' : error.message }); return; }
    if (error instanceof HttpError) {
      if (error.status === 503) res.setHeader('Retry-After', '10');
      res.status(error.status).json({ error: error.message }); return;
    }
    if (serverless && isTransientSqlError(error)) {
      logger.warn({ err: error }, 'Learning SQL temporarily unavailable');
      res.setHeader('Retry-After', '10');
      res.status(503).json({ error: 'Learning data is temporarily unavailable. Please try again shortly. If you were saving, check whether your change was saved before resubmitting.' });
      return;
    }
    if (error instanceof Error && 'type' in error && ['entity.parse.failed', 'entity.too.large'].includes(String(error.type))) {
      res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'Invalid or oversized request body.' }); return;
    }
    logger.error({ err: error }, 'Learning API failed');
    res.status(500).json({ error: 'An unexpected error occurred. Please contact support.' });
  };
}
export const errorHandler = createErrorHandler();
