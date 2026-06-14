/**
 * Regression test for the default JWKS URL.
 *
 * Every other test in this suite injects a local JWKS via the private `_jwks`
 * option, which means the default `jwksUri` derivation in verify.ts was never
 * actually exercised. That masked a bug: the default pointed at
 * `${issuer}/api/v1/.well-known/jwks.json`, but the real backend serves the
 * JWKS at `${issuer}/.well-known/jwks.json` (standard OIDC discovery shape).
 *
 * This test takes the real default path: NO `_jwks` injection. It intercepts
 * jose's `createRemoteJWKSet` to (a) capture the exact URL the SDK derives and
 * (b) hand back a local key resolver so the rest of verification runs for real.
 * It asserts the SDK targets `${issuer}/.well-known/jwks.json` (and NOT the
 * `/api/v1/...` variant) and that end-to-end verification succeeds.
 */

import { describe, it, expect, beforeAll, vi } from "vitest";
import { createLocalJWKSet } from "jose";
import { getFixtures, type TestFixtures } from "./fixtures/jwks.js";

const ISSUER = "https://default-jwks.rootherald.example.com";
const EXPECTED_JWKS_URL = `${ISSUER}/.well-known/jwks.json`;
const WRONG_JWKS_PATH = "/api/v1/.well-known/jwks.json";

// Capture every URL the SDK passes to createRemoteJWKSet, and substitute a
// local (offline) key resolver built from the test fixtures' public JWKS.
const requestedJwksUrls: string[] = [];

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    createRemoteJWKSet: (url: URL) => {
      requestedJwksUrls.push(url.href);
      // jwks is filled in beforeAll; resolve lazily so the closure stays valid.
      return actual.createLocalJWKSet(localJwks!);
    },
  };
});

let localJwks: { keys: object[] } | null = null;
let fixtures: TestFixtures;

// verify.ts caches the JWKSet per URL at module level; import after the mock is
// registered so the mocked createRemoteJWKSet is the one captured.
const { verifyAttestationToken } = await import("../src/verify.js");

beforeAll(async () => {
  fixtures = await getFixtures();
  localJwks = fixtures.publicJwks;
});

describe("verifyAttestationToken — default jwksUri (no _jwks injection)", () => {
  it("derives ${issuer}/.well-known/jwks.json and verifies successfully", async () => {
    // Sanity check the mock surface is the one the SDK will use.
    expect(typeof createLocalJWKSet).toBe("function");

    const token = await fixtures.signToken({
      iss: ISSUER,
      aud: "my-client",
      sub: "user-uuid-default-jwks",
    });

    // No _jwks — forces the SDK to derive + use the default JWKS URL.
    const verdict = await verifyAttestationToken(token, {
      issuer: ISSUER,
      audience: "my-client",
    });

    // End-to-end verification succeeded against the served key set.
    expect(verdict.userId).toBe("user-uuid-default-jwks");
    expect(verdict.device.ueid).toBe("device-uuid-1234");

    // The SDK targeted the correct OIDC discovery path...
    expect(requestedJwksUrls).toContain(EXPECTED_JWKS_URL);
    // ...and never the buggy /api/v1/... variant.
    expect(requestedJwksUrls.some((u) => u.includes(WRONG_JWKS_PATH))).toBe(
      false,
    );
  });
});
