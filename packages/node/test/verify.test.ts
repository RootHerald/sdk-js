import { describe, it, expect, beforeAll } from "vitest";
import { createLocalJWKSet, SignJWT } from "jose";
import { getFixtures, type TestFixtures } from "./fixtures/jwks.js";
import { verifyAttestationToken } from "../src/verify.js";
import {
  InvalidTokenError,
  RootHeraldError,
  TokenExpiredError,
} from "@rootherald/contracts";

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

describe("verifyAttestationToken", () => {
  it("happy path: verifies a composite EAT JWT and maps claims to AttestationVerdict", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
    });

    const verdict = await verifyAttestationToken(token, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    });

    // OIDC top-level claims
    expect(verdict.acr).toBe("urn:rootherald:user:phr");
    expect(verdict.amr).toEqual(["pwd", "hwk", "user", "mfa"]);
    expect(verdict.authTime).toBeInstanceOf(Date);
    expect(verdict.userId).toBe("user-uuid-1");
    expect(verdict.expiresAt).toBeInstanceOf(Date);

    // Nested device verdict
    expect(verdict.device.ueid).toBe("device-uuid-1234");
    expect(verdict.device.earStatus).toBe("affirming");
    expect(verdict.device.verdict).toBe("pass");
    expect(verdict.device.attestationType).toBe("tpm20");
    expect(verdict.device.attestedAt).toBeInstanceOf(Date);
    expect(verdict.device.quoteVerified).toBe(true);
    expect(verdict.device.platform).toBe("windows");
    expect(verdict.device.hardwareModel).toBe("TPM 2.0");

    expect(verdict.raw).toBeDefined();
  });

  it("throws TokenExpiredError for an expired token", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      exp: now - 120, // expired 2 minutes ago
    });

    await expect(
      verifyAttestationToken(token, {
        issuer: "https://rootherald.example.com",
        audience: "my-client",
        _jwks: createLocalJWKSet(fixtures.publicJwks),
      }),
    ).rejects.toThrow(TokenExpiredError);
  });

  it("throws InvalidTokenError for a tampered signature", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
    });
    const parts = token.split(".");
    const tampered = parts[0] + "." + parts[1] + ".badsignatureXXXXXXXXX";

    const err = await verifyAttestationToken(tampered, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect((err as RootHeraldError).code).toBe("INVALID_TOKEN");
  });

  it("throws InvalidTokenError when acr claim is missing", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: "jti-no-acr",
      // acr intentionally omitted
      amr: ["pwd"],
      auth_time: now - 30,
      rootherald_device: {
        eat_profile: "tag:rootherald.io,2026:tpm20-v1",
        ueid: "device-uuid-1234",
        ear_status: "affirming",
        verdict: "pass",
        attestation_type: "tpm20",
        attested_at: now - 10,
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .sign(fixtures.privateKey);

    const err = await verifyAttestationToken(token, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect((err as RootHeraldError).message).toMatch(/missing oidc claim: acr/i);
  });

  it("throws InvalidTokenError when amr claim is missing", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: "jti-no-amr",
      acr: "urn:rootherald:user:phr",
      // amr intentionally omitted
      auth_time: now - 30,
      rootherald_device: {
        eat_profile: "tag:rootherald.io,2026:tpm20-v1",
        ueid: "device-uuid-1234",
        ear_status: "affirming",
        verdict: "pass",
        attestation_type: "tpm20",
        attested_at: now - 10,
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .sign(fixtures.privateKey);

    const err = await verifyAttestationToken(token, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect((err as RootHeraldError).message).toMatch(/missing oidc claim: amr/i);
  });

  it("throws InvalidTokenError for a wrong eat_profile", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: "jti-wrong-profile",
      acr: "urn:rootherald:user:phr",
      amr: ["pwd"],
      auth_time: now - 30,
      rootherald_device: {
        eat_profile: "tag:other.io,2023:wrong-profile",
        ueid: "device-uuid-1234",
        ear_status: "affirming",
        verdict: "pass",
        attestation_type: "tpm20",
        attested_at: now - 10,
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .sign(fixtures.privateKey);

    const err = await verifyAttestationToken(token, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect((err as RootHeraldError).message).toMatch(/eat_profile/i);
  });

  it("throws InvalidTokenError when ueid is absent", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      iat: now,
      nbf: now,
      exp: now + 300,
      jti: "jti-no-ueid",
      acr: "urn:rootherald:user:phr",
      amr: ["pwd"],
      auth_time: now - 30,
      rootherald_device: {
        // ueid intentionally omitted
        eat_profile: "tag:rootherald.io,2026:tpm20-v1",
        ear_status: "affirming",
        verdict: "pass",
        attestation_type: "tpm20",
        attested_at: now - 10,
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .sign(fixtures.privateKey);

    const err = await verifyAttestationToken(token, {
      issuer: "https://rootherald.example.com",
      audience: "my-client",
      _jwks: createLocalJWKSet(fixtures.publicJwks),
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InvalidTokenError);
    expect((err as RootHeraldError).message).toMatch(/ueid/i);
  });

  it("throws for a wrong audience", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
    });

    await expect(
      verifyAttestationToken(token, {
        issuer: "https://rootherald.example.com",
        audience: "wrong-audience",
        _jwks: createLocalJWKSet(fixtures.publicJwks),
      }),
    ).rejects.toThrow(InvalidTokenError);
  });
});
