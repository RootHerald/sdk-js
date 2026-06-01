/**
 * Express-compatible attestation enforcement middleware factory.
 *
 * Works with Express v4/v5, Fastify compatibility mode, and raw Node http
 * servers — depends only on Node's built-in `IncomingMessage` / `ServerResponse`.
 *
 * See README for the TypeScript module augmentation snippet to type `req.attestation`.
 *
 * ACR enforcement follows RFC 9470 "OAuth 2.0 Step Up Authentication Challenge
 * Protocol". Insufficient ACR or stale auth_time returns HTTP 401 with a
 * `WWW-Authenticate: Bearer error="insufficient_user_authentication"` header.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AcrUrn, AssuranceLevel } from '@rootherald/contracts';
import {
  RootHeraldError,
  InsufficientAssuranceError,
  StaleAttestationError,
  InsufficientAcrError,
  AuthenticationTooOldError,
} from '@rootherald/contracts';
import { verifyAttestationToken } from './verify.js';
import type { VerifyOptions } from './verify.js';
import { acrRank, acrMeets } from './acrRank.js';

export interface RequireAttestationMiddlewareOptions extends VerifyOptions {
  /**
   * @deprecated Use `acrValues` instead.
   * Minimum assurance level required.
   */
  minLevel?: AssuranceLevel;
  /** Required ACR URN(s). The session ACR must meet at least one of these. */
  acrValues?: AcrUrn[];
  /** Reject tokens where auth_time is older than this many seconds. */
  maxAgeSeconds?: number;
  /**
   * Custom token extractor. Receives the raw IncomingMessage and returns the
   * JWT string, or null to trigger a 401.
   * Default: parse `Authorization: Bearer <jwt>` header.
   */
  tokenExtractor?: (req: IncomingMessage) => string | null;
  /**
   * Custom error handler. Called after the HTTP response has been written.
   * Use this for logging or side effects — do NOT write to res inside this hook.
   */
  onError?: (err: Error, req: IncomingMessage, res: ServerResponse) => void;
}

// Legacy assurance level → minimum equivalent ACR URN.
const ASSURANCE_ORDER: Record<AssuranceLevel, number> = {
  unverified: 0,
  reduced: 1,
  high: 2,
};

// Map legacy AssuranceLevel to a rough ACR rank for comparison.
const ASSURANCE_TO_ACR_RANK: Record<AssuranceLevel, number> = {
  unverified: 0, // urn:rootherald:device:any
  reduced: 1,    // urn:rootherald:device:high
  high: 4,       // urn:rootherald:user:phr (mfa + device)
};

function defaultTokenExtractor(req: IncomingMessage): string | null {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice(7).trim() || null;
}

function writeJsonError(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

/**
 * Builds an RFC 9470-compliant WWW-Authenticate: Bearer challenge header value.
 *
 * Example output:
 *   Bearer realm="", error="insufficient_user_authentication",
 *     error_description="...", acr_values="urn:rootherald:user:phr", max_age="60"
 */
function buildStepUpChallenge(options: {
  acrValues?: AcrUrn[];
  maxAgeSeconds?: number;
  errorDescription: string;
}): string {
  const parts = ['Bearer'];
  parts.push('realm=""');
  parts.push('error="insufficient_user_authentication"');
  parts.push(`error_description="${options.errorDescription.replace(/"/g, '\\"')}"`);
  if (options.acrValues && options.acrValues.length > 0) {
    parts.push(`acr_values="${options.acrValues.join(' ')}"`);
  }
  if (options.maxAgeSeconds !== undefined) {
    parts.push(`max_age="${options.maxAgeSeconds}"`);
  }
  return parts.join(', ');
}

/**
 * Factory that returns an Express-compatible `(req, res, next)` middleware.
 *
 * On success, attaches the verified verdict to `(req as any).attestation`.
 * On failure, writes a JSON error response and calls `next(err)`.
 *
 * ACR/freshness failures return 401 with RFC 9470 WWW-Authenticate challenge.
 * Other failures (missing/invalid token) return plain 401.
 */
export function requireAttestation(
  options: RequireAttestationMiddlewareOptions,
): (
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
) => Promise<void> {
  const extractor = options.tokenExtractor ?? defaultTokenExtractor;

  return async (req, res, next) => {
    const token = extractor(req);

    if (!token) {
      const err = new RootHeraldError('No attestation token provided', 'UNAUTHENTICATED');
      writeJsonError(res, 401, { error: 'unauthenticated', code: err.code });
      options.onError?.(err, req, res);
      next(err);
      return;
    }

    let verdict;
    try {
      verdict = await verifyAttestationToken(token, options);
    } catch (err) {
      const error = err instanceof Error ? err : new RootHeraldError(String(err), 'JWT_INVALID');
      writeJsonError(res, 401, {
        error: 'unauthorized',
        code: error instanceof RootHeraldError ? error.code : 'JWT_INVALID',
      });
      options.onError?.(error, req, res);
      next(error);
      return;
    }

    try {
      // ---- ACR enforcement (new — RFC 9470) ----
      if (options.acrValues && options.acrValues.length > 0) {
        if (!acrMeets(verdict.acr, options.acrValues)) {
          throw new InsufficientAcrError(
            options.acrValues.join(', '),
            verdict.acr,
          );
        }
      }

      // ---- Device attestation freshness check (legacy — 403 StaleAttestationError) ----
      // Checks attested_at (device attestation age). Preserved for backward compat
      // with pre-RFC-9470 callers that relied on 403 for maxAgeSeconds violations.
      if (options.maxAgeSeconds !== undefined) {
        const deviceAgeSeconds = (Date.now() - verdict.device.attestedAt.getTime()) / 1000;
        if (deviceAgeSeconds > options.maxAgeSeconds) {
          throw new StaleAttestationError();
        }
      }

      // ---- auth_time freshness check (new — RFC 9470, 401 AuthenticationTooOldError) ----
      // Checks auth_time (user authentication age). Only fired when maxAgeSeconds is set
      // AND the device attestation is still fresh (above check passed). This separates
      // the two freshness domains: device re-attestation (403) vs. user step-up auth (401).
      if (options.maxAgeSeconds !== undefined) {
        const authAgeSeconds = (Date.now() - verdict.authTime.getTime()) / 1000;
        if (authAgeSeconds > options.maxAgeSeconds) {
          throw new AuthenticationTooOldError(
            Math.floor(verdict.authTime.getTime() / 1000),
            options.maxAgeSeconds,
          );
        }
      }

      // ---- Legacy minLevel check (deprecated — kept for backward compat) ----
      if (options.minLevel !== undefined) {
        const required = ASSURANCE_ORDER[options.minLevel];
        const actual = ASSURANCE_ORDER[verdict.assuranceLevel ?? 'unverified'];
        if (actual < required) {
          throw new InsufficientAssuranceError();
        }
      }

    } catch (err) {
      if (err instanceof InsufficientAcrError || err instanceof AuthenticationTooOldError) {
        // RFC 9470 step-up challenge — 401 + WWW-Authenticate
        res.statusCode = 401;
        res.setHeader(
          'WWW-Authenticate',
          buildStepUpChallenge({
            acrValues: options.acrValues,
            maxAgeSeconds: options.maxAgeSeconds,
            errorDescription: err.message,
          }),
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: 'insufficient_user_authentication',
            error_description: err.message,
            acr_values: options.acrValues,
            max_age: options.maxAgeSeconds,
          }),
        );
        options.onError?.(err, req, res);
        next(err);
        return;
      }

      if (err instanceof StaleAttestationError || err instanceof InsufficientAssuranceError) {
        // Legacy paths — preserve existing 403 behaviour.
        writeJsonError(res, 403, { error: 'forbidden', code: err.code });
        options.onError?.(err, req, res);
        next(err);
        return;
      }

      // Re-throw anything unexpected.
      throw err;
    }

    // Attach to request for downstream handlers
    (req as unknown as Record<string, unknown>)['attestation'] = verdict;
    next();
  };
}
