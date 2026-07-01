/**
 * Test RSA keypair + fixture helpers for the @rootherald/node test suite.
 *
 * Call `getFixtures()` once in a `beforeAll` block to avoid redundant key generation.
 *
 * Tokens are emitted in the ADR-0012 composite shape:
 *   - OIDC standard claims (acr, amr, auth_time, …) at the top level
 *   - Device attestation claims inside `rootherald_device`
 *   - Legacy top-level fields preserved for backward-compat tests
 */

import {
  generateKeyPair,
  exportJWK,
  SignJWT,
  type KeyLike,
} from 'jose';
import type { AcrUrn } from '@rootherald/contracts';

/** Minimal JWT claim shape accepted by signToken. */
export interface SignTokenClaims {
  iss: string;
  aud: string;
  sub: string;
  iat?: number;
  nbf?: number;
  exp?: number;
  jti?: string;

  // OIDC top-level claims
  acr?: AcrUrn;
  amr?: string[];
  auth_time?: number;
  requested_acr_values?: string[];

  // Device container overrides (merged into rootherald_device)
  rootherald_device?: Record<string, unknown>;

  // Legacy top-level device fields (for back-compat tests)
  ueid?: string;
  assurance_level?: string;
  verdict?: string;
  attestation_type?: string;
  attested_at?: number;
  eat_profile?: string;
  nonce_verified?: boolean;
  quote_verified?: boolean;
  secure_boot_verified?: boolean;
  platform?: string;
  hardware_model?: string;
  rp_id?: string;
}

export interface TestFixtures {
  privateKey: KeyLike;
  publicJwks: { keys: object[] };
  /** Signs a composite EAT token with caller-supplied claim overrides. */
  signToken(claims: SignTokenClaims): Promise<string>;
  /** Signs a SET JWT (for CAEP) with caller-supplied envelope claims. */
  signSet(
    envelope: {
      iss: string;
      aud?: string;
      jti?: string;
      iat?: number;
      sub_id?: { format: string; id: string };
      events: Record<string, unknown>;
    },
  ): Promise<string>;
}

let _cached: TestFixtures | null = null;

export async function getFixtures(): Promise<TestFixtures> {
  if (_cached) return _cached;

  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    modulusLength: 2048,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  const publicJwks = { keys: [publicJwk] };

  const signToken = async (claims: SignTokenClaims): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);

    // Default device container (composite shape).
    const defaultDevice: Record<string, unknown> = {
      eat_profile: claims.rootherald_device?.['eat_profile'] ?? 'tag:rootherald.io,2026:tpm20-v1',
      ueid: claims.rootherald_device?.['ueid'] ?? claims.ueid ?? 'device-uuid-1234',
      ear_status: claims.rootherald_device?.['ear_status'] ?? 'affirming',
      verdict: claims.rootherald_device?.['verdict'] ?? claims.verdict ?? 'pass',
      attestation_type: claims.rootherald_device?.['attestation_type'] ?? claims.attestation_type ?? 'tpm20',
      attested_at: claims.rootherald_device?.['attested_at'] ?? claims.attested_at ?? (now - 10),
      quote_verified: claims.rootherald_device?.['quote_verified'] ?? claims.quote_verified ?? true,
      secure_boot_verified: claims.rootherald_device?.['secure_boot_verified'] ?? claims.secure_boot_verified ?? true,
      event_log_verified: claims.rootherald_device?.['event_log_verified'] ?? true,
      platform: claims.rootherald_device?.['platform'] ?? claims.platform ?? 'windows',
      hardware_model: claims.rootherald_device?.['hardware_model'] ?? claims.hardware_model ?? 'TPM 2.0',
    };

    const fullClaims: Record<string, unknown> = {
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      iat: claims.iat ?? now,
      nbf: claims.nbf ?? now,
      exp: claims.exp ?? now + 300,
      jti: claims.jti ?? 'jti-' + Math.random().toString(36).slice(2),

      // OIDC top-level claims
      acr: claims.acr ?? 'urn:rootherald:user:phr',
      amr: claims.amr ?? ['pwd', 'hwk', 'user', 'mfa'],
      auth_time: claims.auth_time ?? now - 30,
      requested_acr_values: claims.requested_acr_values ?? ['urn:rootherald:user:phr'],

      // Composite device container (preferred path)
      rootherald_device: defaultDevice,

      // Legacy top-level mirrors (back-compat)
      ueid: claims.ueid ?? 'device-uuid-1234',
      assurance_level: claims.assurance_level ?? 'high',
      verdict: claims.verdict ?? 'pass',
      attestation_type: claims.attestation_type ?? 'tpm20',
      nonce_verified: claims.nonce_verified ?? true,
      attested_at: claims.attested_at ?? (now - 10),
      rp_id: claims.rp_id ?? 'test-rp',
      quote_verified: claims.quote_verified ?? true,
      secure_boot_verified: claims.secure_boot_verified ?? true,
      platform: claims.platform ?? 'windows',
      hardware_model: claims.hardware_model ?? 'TPM 2.0',
    };

    return new SignJWT(fullClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .sign(privateKey);
  };

  const signSet = async (envelope: {
    iss: string;
    aud?: string;
    jti?: string;
    iat?: number;
    sub_id?: { format: string; id: string };
    events: Record<string, unknown>;
  }): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: envelope.iss,
      iat: envelope.iat ?? now,
      jti: envelope.jti ?? 'set-jti-' + Math.random().toString(36).slice(2),
      ...(envelope.aud ? { aud: envelope.aud } : {}),
      sub_id: envelope.sub_id ?? { format: 'opaque', id: 'device-uuid-1234' },
      events: envelope.events,
    };

    return new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'secevent+jwt' })
      .sign(privateKey);
  };

  _cached = { privateKey, publicJwks, signToken, signSet };
  return _cached;
}

/** Resets fixture cache — call in afterAll when isolation is needed. */
export function resetFixtures(): void {
  _cached = null;
}
