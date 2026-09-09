import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { ImportLimitError } from '../services/import-service';
import { AppError, ProviderError } from '../lib/errors';
import { loadEnv } from '../config/env';

/**
 * Uniform error responses.
 *
 * Clients always receive `{ error, message, details?, requestId }`. Internal details
 * (stack traces, SQL, provider payloads) never cross the boundary in production.
 */
export default fp(async function errorHandlerPlugin(app: FastifyInstance) {
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id;
    const isProd = loadEnv().NODE_ENV === 'production';

    if (error instanceof AppError) {
      request.log.debug({ err: error, requestId }, 'application error');
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
        details: error.details,
        requestId,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: 'The request body or query is invalid',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        requestId,
      });
    }

    // An upload that exceeds a limit is the user's to fix, and the message already
    // says which limit and what to do about it — so it goes back verbatim as a 413.
    if (error instanceof ImportLimitError) {
      return reply.status(413).send({ error: 'IMPORT_LIMIT', message: error.message });
    }

    if (error instanceof ProviderError) {
      request.log.warn({ err: error, provider: error.providerKey }, 'provider failure');
      return reply.status(502).send({
        error: 'PROVIDER_ERROR',
        message: `The "${error.providerKey}" provider failed: ${error.message}`,
        requestId,
      });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return reply.status(409).send({
          error: 'CONFLICT',
          message: 'A record with these unique values already exists',
          details: isProd ? undefined : error.meta,
          requestId,
        });
      }
      if (error.code === 'P2025') {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Record not found', requestId });
      }
      request.log.error({ err: error }, 'database error');
      return reply.status(500).send({ error: 'DATABASE_ERROR', message: 'A database error occurred', requestId });
    }

    // Fastify's own validation and rate-limit errors carry a statusCode.
    const fallback = error as { statusCode?: number; code?: string; message?: string };
    const status = fallback.statusCode;
    if (status && status < 500) {
      return reply.status(status).send({
        error: fallback.code ?? 'REQUEST_ERROR',
        message: fallback.message ?? 'Request rejected',
        requestId,
      });
    }

    request.log.error({ err: error, requestId }, 'unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: isProd ? 'An unexpected error occurred' : (fallback.message ?? 'Unexpected error'),
      requestId,
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'NOT_FOUND',
      message: `No route for ${request.method} ${request.url}`,
      requestId: request.id,
    });
  });
});
