/**
 * Express-compatible CAEP SET JWT receiver middleware.
 *
 * Verifies the incoming SET JWT signature against the issuer's JWKS,
 * extracts the single CAEP event from the `events` map, and dispatches
 * it to the caller-supplied `onEvent` handler.
 *
 * Responds 202 on success. 400 on verification failure. 405 for non-POST.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { CaepEvent } from '@rootherald/contracts';
import { WebhookSignatureError } from '@rootherald/contracts';

// Shared JWKS cache (same pattern as verify.ts)
const _jwksSets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Clears the CAEP JWKS cache. Exposed for testing only. */
export function _clearCaepJwksCache(): void {
  _jwksSets.clear();
}

function getCaepJwksSet(
  jwksUri: string,
): ReturnType<typeof createRemoteJWKSet> {
  const existing = _jwksSets.get(jwksUri);
  if (existing) return existing;
  const set = createRemoteJWKSet(new URL(jwksUri), {
    cooldownDuration: 30_000,
    cacheMaxAge: 3_600_000,
  });
  _jwksSets.set(jwksUri, set);
  return set;
}

export interface ParsedCaepEvent {
  /** The CAEP event type URI (the key in the SET `events` map). */
  type: string;
  /** The event-specific payload object. */
  payload: Record<string, unknown>;
}

export interface ReceiveCaepEventOptions {
  /** Expected issuer URL. JWKS is fetched from `${issuer}/api/v1/.well-known/jwks.json`. */
  issuer: string;
  /**
   * Callback invoked for each successfully verified CAEP event.
   * Awaited before writing 202. Throwing here causes a 400 response.
   */
  onEvent: (
    event: CaepEvent | ParsedCaepEvent,
    raw: { jti: string; iat: number; sub_id: { format: string; id: string } },
  ) => Promise<void> | void;
  /** Override JWKS endpoint URL. Default: `${issuer}/api/v1/.well-known/jwks.json`. */
  jwksUri?: string;
  /** Clock skew tolerance in seconds. Defaults to 30. */
  clockTolerance?: number;
  /** Optional: validate the SET `aud` matches this value (e.g. your stream_id). */
  audience?: string;
  /**
   * Inject a pre-built JWKS resolver for testing.
   * When provided, jwksUri is not fetched.
   */
  _jwks?: JWTVerifyGetKey;
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  // If Express (or another framework) already parsed the body, use it.
  const preparsed = (req as unknown as Record<string, unknown>)['body'];
  if (typeof preparsed === 'string') return preparsed;
  if (Buffer.isBuffer(preparsed)) return preparsed.toString('utf8');

  // Otherwise stream-read
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function writeJsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Factory that returns an Express-compatible `(req, res, next?)` middleware.
 *
 * The `next` parameter is optional — the middleware can be used standalone
 * without a framework, responding directly to the HTTP request.
 */
export function receiveCaepEvent(
  options: ReceiveCaepEventOptions,
): (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (err?: unknown) => void,
) => Promise<void> {
  const jwksUri =
    options.jwksUri ?? `${options.issuer}/api/v1/.well-known/jwks.json`;

  return async (req, res, next) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Allow', 'POST');
      res.end();
      return;
    }

    let rawBody: string;
    try {
      rawBody = (await readRawBody(req)).trim();
    } catch (err) {
      writeJsonResponse(res, 400, { error: 'Failed to read request body' });
      next?.(err);
      return;
    }

    // Basic shape check: compact JWT is three dot-separated segments
    if (rawBody.split('.').length !== 3) {
      const err = new WebhookSignatureError(new Error('Body is not a compact JWT'));
      writeJsonResponse(res, 400, { error: 'invalid_set', code: err.code });
      next?.(err);
      return;
    }

    const jwks = options._jwks ?? getCaepJwksSet(jwksUri);

    let payload: Record<string, unknown>;
    try {
      const verifyOpts: Parameters<typeof jwtVerify>[2] = {
        issuer: options.issuer,
        clockTolerance: options.clockTolerance ?? 30,
        typ: 'secevent+jwt',
      };
      if (options.audience) verifyOpts.audience = options.audience;
      const result = await jwtVerify(rawBody, jwks, verifyOpts);
      payload = result.payload as Record<string, unknown>;
    } catch (err) {
      const error = new WebhookSignatureError(err);
      writeJsonResponse(res, 400, { error: 'signature_invalid', code: error.code });
      next?.(error);
      return;
    }

    // Extract the single event from the `events` map
    const eventsMap = payload['events'];
    if (!eventsMap || typeof eventsMap !== 'object' || Array.isArray(eventsMap)) {
      const err = new WebhookSignatureError(new Error('SET missing events map'));
      writeJsonResponse(res, 400, { error: 'invalid_set', code: err.code });
      next?.(err);
      return;
    }

    const eventTypes = Object.keys(eventsMap as Record<string, unknown>);
    if (eventTypes.length === 0) {
      const err = new WebhookSignatureError(new Error('SET events map is empty'));
      writeJsonResponse(res, 400, { error: 'invalid_set', code: err.code });
      next?.(err);
      return;
    }

    // Dispatch the first (and expected only) event — receiver is not responsible for
    // event type validation beyond extracting the type URI and payload.
    const eventType = eventTypes[0]!;
    const eventPayload = (eventsMap as Record<string, unknown>)[eventType] as Record<string, unknown>;

    const parsedEvent: ParsedCaepEvent = { type: eventType, payload: eventPayload };
    const rawEnvelope = {
      jti: (payload['jti'] as string) ?? '',
      iat: (payload['iat'] as number) ?? 0,
      sub_id: (payload['sub_id'] as { format: string; id: string }) ?? { format: 'opaque', id: '' },
    };

    try {
      await options.onEvent(parsedEvent as unknown as CaepEvent, rawEnvelope);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      writeJsonResponse(res, 400, { error: 'handler_error' });
      next?.(error);
      return;
    }

    res.statusCode = 202;
    res.end();
  };
}
