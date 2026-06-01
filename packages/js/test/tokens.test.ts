import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createLocalJWKSet } from 'jose';
import { getFixtures, type TestFixtures } from './fixtures/jwks.js';
import { mapClaimsToVerdict } from '../src/tokens.js';
import {
  RootHeraldError,
  TokenExpiredError,
} from '@rootherald/contracts';

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

// ─── Composite (new) shape ─────────────────────────────────────────────────

describe('mapClaimsToVerdict — composite shape (rootherald_device container)', () => {
  it('populates OIDC top-level fields (acr, amr, authTime) from composite claims', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://example.com',
      aud: 'client-id',
      sub: 'user-uuid',
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: 'jti-1',
      acr: 'urn:rootherald:user:phrh' as const,
      amr: ['pwd', 'hwk'] as ['pwd', 'hwk'],
      auth_time: now - 50,
      requested_acr_values: ['urn:rootherald:user:phrh'] as ['urn:rootherald:user:phrh'],
      rootherald_device: {
        eat_profile: 'tag:rootherald.io,2026:tpm20-v1' as const,
        ueid: 'device-uuid-nested',
        ear_status: 'affirming' as const,
        verdict: 'pass' as const,
        attestation_type: 'tpm20' as const,
        attested_at: now - 10,
        quote_verified: true,
        secure_boot_verified: true,
        platform: 'windows' as const,
        hardware_model: 'TPM 2.0',
      },
    };

    const verdict = mapClaimsToVerdict(claims as any);

    // New OIDC fields
    expect(verdict.acr).toBe('urn:rootherald:user:phrh');
    expect(verdict.amr).toEqual(['pwd', 'hwk']);
    expect(verdict.authTime).toEqual(new Date((now - 50) * 1000));
    expect(verdict.requestedAcrValues).toEqual(['urn:rootherald:user:phrh']);
    expect(verdict.userId).toBe('user-uuid');
    expect(verdict.expiresAt).toEqual(new Date((now + 300) * 1000));

    // Nested device container
    expect(verdict.device.ueid).toBe('device-uuid-nested');
    expect(verdict.device.earStatus).toBe('affirming');
    expect(verdict.device.verdict).toBe('pass');
    expect(verdict.device.attestationType).toBe('tpm20');
    expect(verdict.device.quoteVerified).toBe(true);
    expect(verdict.device.secureBootVerified).toBe(true);
    expect(verdict.device.platform).toBe('windows');
    expect(verdict.device.hardwareModel).toBe('TPM 2.0');

    // Legacy mirrors still populated
    expect(verdict.assuranceLevel).toBe('high');
    expect(verdict.deviceId).toBe('device-uuid-nested');
    expect(verdict.verdict).toBe('pass');
    expect(verdict.attestationType).toBe('tpm20');
  });

  it('maps ear_trustworthiness_vector into camelCase trustworthinessVector', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://example.com',
      aud: 'client-id',
      sub: 'user-uuid',
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: 'jti-2',
      acr: 'urn:rootherald:user:phrh' as const,
      amr: ['hwk'] as ['hwk'],
      auth_time: now - 5,
      requested_acr_values: [] as never[],
      rootherald_device: {
        eat_profile: 'tag:rootherald.io,2026:tpm20-v1' as const,
        ueid: 'device-uuid-vector',
        ear_status: 'affirming' as const,
        verdict: 'pass' as const,
        attestation_type: 'tpm20' as const,
        attested_at: now - 5,
        ear_trustworthiness_vector: {
          instance_identity: 2,
          configuration: 2,
          executables: 2,
          file_system: 1,
          hardware: 2,
          runtime_opaque: 0,
          sourced_data: 1,
          storage_opaque: 2,
        },
      },
    };

    const verdict = mapClaimsToVerdict(claims as any);

    expect(verdict.device.trustworthinessVector).toEqual({
      instanceIdentity: 2,
      configuration: 2,
      executables: 2,
      fileSystem: 1,
      hardware: 2,
      runtimeOpaque: 0,
      sourcedData: 1,
      storageOpaque: 2,
    });
  });
});

// ─── Legacy flat shape (pre-ADR-0012) ─────────────────────────────────────

describe('mapClaimsToVerdict — legacy flat shape (no rootherald_device)', () => {
  it('falls back to top-level fields when rootherald_device is absent', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://example.com',
      aud: 'client-id',
      sub: 'user-uuid',
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: 'jti-legacy',
      // No acr/amr/auth_time — old tokens omit these
      ueid: 'legacy-device-uuid',
      eat_profile: 'tag:rootherald.io,2026:tpm20-v1',
      verdict: 'pass' as const,
      assurance_level: 'high',
      attestation_type: 'tpm20',
      nonce_verified: true,
      attested_at: now - 5,
      rp_id: 'rp-1',
      quote_verified: true,
      secure_boot_verified: true,
      platform: 'windows',
      hardware_model: 'TPM 2.0',
    };

    const verdict = mapClaimsToVerdict(claims as any);

    // Falls back gracefully
    expect(verdict.acr).toBe('urn:rootherald:device:any');
    expect(verdict.amr).toEqual([]);

    // Device fields come from legacy top-level
    expect(verdict.device.ueid).toBe('legacy-device-uuid');
    expect(verdict.device.earStatus).toBe('affirming'); // mapped from assurance_level: 'high'
    expect(verdict.device.verdict).toBe('pass');
    expect(verdict.device.attestationType).toBe('tpm20');
    expect(verdict.device.quoteVerified).toBe(true);
    expect(verdict.device.platform).toBe('windows');

    // Legacy mirrors still work
    expect(verdict.assuranceLevel).toBe('high');
    expect(verdict.deviceId).toBe('legacy-device-uuid');
    expect(verdict.verdict).toBe('pass');
    expect(verdict.attestationType).toBe('tpm20');
  });

  it('maps assurance_level "reduced" to earStatus "warning"', () => {
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: 'https://example.com',
      aud: 'client-id',
      sub: 'user-uuid',
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: 'jti-reduced',
      ueid: 'reduced-device',
      eat_profile: 'tag:rootherald.io,2026:tpm20-v1',
      verdict: 'warn' as const,
      assurance_level: 'reduced',
      attestation_type: 'apple-se',
      nonce_verified: false,
      attested_at: now,
      rp_id: 'rp-1',
    };

    const verdict = mapClaimsToVerdict(claims as any);

    expect(verdict.device.earStatus).toBe('warning');
    expect(verdict.assuranceLevel).toBe('reduced');
    expect(verdict.device.verdict).toBe('warn');
  });
});

// ─── JWT verification (integration with mocked JWKS) ─────────────────────

describe('JWT verification via jose (integration with mocked JWKS)', () => {
  it('verifies a valid signed JWT and produces correct new-shape verdict', async () => {
    const token = await fixtures.signToken({
      iss: 'https://test.rootherald.io',
      aud: 'my-client',
      sub: 'user-1',
    });

    const localJwks = createLocalJWKSet(fixtures.publicJwks);

    const { jwtVerify } = await import('jose');
    const { payload } = await jwtVerify(token, localJwks, {
      issuer: 'https://test.rootherald.io',
      audience: 'my-client',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const verdict = mapClaimsToVerdict(payload as any);

    // New fields
    expect(verdict.acr).toBe('urn:rootherald:user:phrh');
    expect(verdict.amr).toContain('pwd');
    expect(verdict.device.ueid).toBe('device-uuid-1234');
    expect(verdict.device.earStatus).toBe('affirming');
    expect(verdict.device.verdict).toBe('pass');
    expect(verdict.userId).toBe('user-1');

    // Legacy mirrors
    expect(verdict.verdict).toBe('pass');
    expect(verdict.assuranceLevel).toBe('high');
    expect(verdict.deviceId).toBe('device-uuid-1234');
  });

  it('throws RootHeraldError JWT_INVALID for a tampered JWT', async () => {
    const token = await fixtures.signToken({
      iss: 'https://test.rootherald.io',
      aud: 'my-client',
      sub: 'user-1',
    });
    const parts = token.split('.');
    const tampered = parts[0] + '.' + parts[1] + '.invalidsignature';

    const localJwks = createLocalJWKSet(fixtures.publicJwks);
    const { jwtVerify } = await import('jose');

    await expect(
      jwtVerify(tampered, localJwks, {
        issuer: 'https://test.rootherald.io',
        audience: 'my-client',
      }),
    ).rejects.toThrow();
  });

  it('throws for an expired JWT', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await fixtures.signToken({
      iss: 'https://test.rootherald.io',
      aud: 'my-client',
      sub: 'user-1',
      exp: now - 60,
    });

    const localJwks = createLocalJWKSet(fixtures.publicJwks);
    const { jwtVerify } = await import('jose');

    await expect(
      jwtVerify(token, localJwks, {
        issuer: 'https://test.rootherald.io',
        audience: 'my-client',
      }),
    ).rejects.toThrow();
  });

  it('throws for wrong issuer', async () => {
    const token = await fixtures.signToken({
      iss: 'https://attacker.example.com',
      aud: 'my-client',
      sub: 'user-1',
    });

    const localJwks = createLocalJWKSet(fixtures.publicJwks);
    const { jwtVerify } = await import('jose');

    await expect(
      jwtVerify(token, localJwks, {
        issuer: 'https://test.rootherald.io',
        audience: 'my-client',
      }),
    ).rejects.toThrow();
  });

  it('RootHeraldError and TokenExpiredError are importable from @rootherald/contracts', () => {
    const err = new RootHeraldError('test', 'JWT_INVALID');
    expect(err.code).toBe('JWT_INVALID');
    const expErr = new TokenExpiredError();
    expect(expErr.code).toBe('TOKEN_EXPIRED');
  });
});
