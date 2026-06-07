/**
 * Test RSA keypair + fixture helpers.
 * Reused across test suites to avoid expensive key generation per test.
 *
 * Call `getFixtures()` once in a `beforeAll` block.
 */

import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from 'jose';

export interface TestFixtures {
  privateKey: KeyLike;
  publicJwks: { keys: object[] };
  /** Signs a partial claims object and returns a JWT string. */
  signToken(claims: Partial<Record<string, unknown>> & { iss: string; aud: string; sub: string }): Promise<string>;
}

let _cached: TestFixtures | null = null;

export async function getFixtures(): Promise<TestFixtures> {
  if (_cached) return _cached;

  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
  const publicJwk = await exportJWK(publicKey);
  // Add key ID so jose can match it
  publicJwk.kid = 'test-key-1';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  const publicJwks = { keys: [publicJwk] };

  const signToken = async (
    claims: Partial<Record<string, unknown>> & { iss: string; aud: string; sub: string },
  ): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);

    const fullClaims = {
      iss: claims.iss,
      aud: claims.aud,
      sub: claims.sub,
      iat: claims.iat ?? now,
      nbf: claims.nbf ?? now,
      exp: claims.exp ?? now + 300,
      jti: claims.jti ?? 'test-jti-' + Math.random().toString(36).slice(2),
      // OIDC top-level
      acr: claims.acr ?? 'urn:rootherald:user:phrh',
      amr: claims.amr ?? ['pwd', 'hwk'],
      auth_time: claims.auth_time ?? now - 10,
      requested_acr_values: claims.requested_acr_values ?? [],
      // Nested device container (composite shape)
      rootherald_device: (claims.rootherald_device as object | undefined) ?? {
        eat_profile: 'tag:rootherald.io,2026:tpm20-v1',
        ueid: 'device-uuid-1234',
        ear_status: 'affirming',
        verdict: 'pass',
        attestation_type: 'tpm20',
        attested_at: now - 10,
        quote_verified: true,
        secure_boot_verified: true,
        platform: 'windows',
        hardware_model: 'TPM 2.0',
      },
      // Legacy top-level mirrors (kept for backward-compat)
      ...(claims.rootherald_device === undefined && {
        ueid: 'device-uuid-1234',
        eat_profile: 'tag:rootherald.io,2026:tpm20-v1',
        verdict: 'pass',
        assurance_level: 'high',
        attestation_type: 'tpm20',
        nonce_verified: true,
        attested_at: now - 10,
        rp_id: 'test-rp',
        quote_verified: true,
        secure_boot_verified: true,
        platform: 'windows',
        hardware_model: 'TPM 2.0',
      }),
      // Allow arbitrary overrides to bleed through
      ...Object.fromEntries(
        Object.entries(claims).filter(([k]) =>
          !['iss','aud','sub','iat','nbf','exp','jti','acr','amr','auth_time',
            'requested_acr_values','rootherald_device'].includes(k)
        )
      ),
    };

    return new SignJWT({ ...fullClaims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .sign(privateKey);
  };

  _cached = { privateKey, publicJwks, signToken };
  return _cached;
}

/** Resets the cached fixtures (call in afterAll if needed for isolation). */
export function resetFixtures(): void {
  _cached = null;
}
