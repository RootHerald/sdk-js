import { describe, it, expect, beforeAll, vi } from "vitest";
import { createLocalJWKSet } from "jose";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getFixtures, type TestFixtures } from "./fixtures/jwks.js";
import { requireAttestation } from "../src/requireAttestation.js";
import { RootHeraldError } from "@rootherald/contracts";

let fixtures: TestFixtures;

beforeAll(async () => {
  fixtures = await getFixtures();
});

function makeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    method: "GET",
  } as unknown as IncomingMessage;
}

interface FakeRes {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function makeRes(): ServerResponse & FakeRes {
  const res: FakeRes = {
    statusCode: 200,
    body: "",
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body?: string) {
      if (body) this.body = body;
    },
  };
  return res as unknown as ServerResponse & FakeRes;
}

const baseOptions = (jwks: ReturnType<typeof createLocalJWKSet>) => ({
  issuer: "https://rootherald.example.com",
  audience: "my-client",
  _jwks: jwks,
});

describe("requireAttestation", () => {
  it("happy path: valid token sets req.attestation and calls next()", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
    });
    const middleware = requireAttestation(
      baseOptions(createLocalJWKSet(fixtures.publicJwks)) as any,
    );

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as Record<string, unknown>)["attestation"]).toBeDefined();
  });

  it("no token: responds 401 and next(err)", async () => {
    const middleware = requireAttestation(
      baseOptions(createLocalJWKSet(fixtures.publicJwks)) as any,
    );

    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(RootHeraldError);
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("UNAUTHENTICATED");
  });

  it("invalid token: responds 401 and next(err)", async () => {
    const middleware = requireAttestation(
      baseOptions(createLocalJWKSet(fixtures.publicJwks)) as any,
    );

    const req = makeReq("Bearer not-a-real-jwt");
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(next.mock.calls[0]![0]).toBeInstanceOf(RootHeraldError);
  });

  it("ACR insufficient: 401 with RFC 9470 WWW-Authenticate challenge", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:user:phrh:fresh"], // higher than the fixture's phr
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain("insufficient_user_authentication");
    expect(res.headers["WWW-Authenticate"]).toContain("acr_values");
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("INSUFFICIENT_ACR");
  });

  it("auth_time too old: 401 with step-up challenge", async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      auth_time: now - 3600, // 1 hour old
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      maxAgeSeconds: 60,
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain("insufficient_user_authentication");
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("AUTH_TOO_OLD");
  });

  // ── ACR cross-track separation (node-sdk-acr-cross-track-bypass) ──────────
  // The device-only and user tiers are SEPARATE tracks (acr-values.md
  // "Hierarchy and Subsumption"): a user-track ACR must never satisfy a
  // device-track requirement, and device:high requires the evidence booleans.

  it("SECURITY: user:1fa token does NOT satisfy a device:high requirement (cross-track)", async () => {
    // A pure user-auth token, with NO high-assurance device evidence.
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      acr: "urn:rootherald:user:1fa",
      amr: ["pwd"],
      rootherald_device: {
        quote_verified: false,
        secure_boot_verified: false,
        event_log_verified: false,
      },
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:device:high"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    // Must fail CLOSED with the RFC 9470 step-up challenge.
    expect(res.statusCode).toBe(401);
    expect(res.headers["WWW-Authenticate"]).toContain("insufficient_user_authentication");
    expect(res.headers["WWW-Authenticate"]).toContain("acr_values");
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("INSUFFICIENT_ACR");
  });

  it("proper device:high token (quote + secure_boot + event_log verified) satisfies device:high", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "device-uuid-1",
      acr: "urn:rootherald:device:high",
      amr: [],
      rootherald_device: {
        quote_verified: true,
        secure_boot_verified: true,
        event_log_verified: true,
      },
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:device:high"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as Record<string, unknown>)["attestation"]).toBeDefined();
  });

  it("device:high token MISSING the evidence booleans is REJECTED", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "device-uuid-1",
      acr: "urn:rootherald:device:high",
      amr: [],
      rootherald_device: {
        // ACR claims device:high, but the evidence is absent — the ACR string
        // alone must not be trusted.
        quote_verified: true,
        secure_boot_verified: false,
        event_log_verified: false,
      },
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:device:high"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("INSUFFICIENT_ACR");
  });

  it("same-track laddering: device:high satisfies a device:any requirement", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "device-uuid-1",
      acr: "urn:rootherald:device:high",
      amr: [],
      rootherald_device: {
        ear_status: "affirming",
        quote_verified: true,
        secure_boot_verified: true,
        event_log_verified: true,
      },
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:device:any"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as Record<string, unknown>)["attestation"]).toBeDefined();
  });

  it("same-track laddering: a higher user tier satisfies a lower user requirement", async () => {
    // Fixture default acr is user:phr; request the lower user:1fa.
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "user-uuid-1",
      acr: "urn:rootherald:user:phrh",
      amr: ["pwd", "hwk", "user", "mfa"],
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:user:1fa"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as Record<string, unknown>)["attestation"]).toBeDefined();
  });

  it("device:any token does NOT satisfy a user:1fa requirement (cross-track, reverse)", async () => {
    const token = await fixtures.signToken({
      iss: "https://rootherald.example.com",
      aud: "my-client",
      sub: "device-uuid-1",
      acr: "urn:rootherald:device:any",
      amr: [],
    });
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      acrValues: ["urn:rootherald:user:1fa"],
    } as any);

    const req = makeReq(`Bearer ${token}`);
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect((next.mock.calls[0]![0] as RootHeraldError).code).toBe("INSUFFICIENT_ACR");
  });

  it("calls onError hook when token verification fails", async () => {
    const onError = vi.fn();
    const middleware = requireAttestation({
      ...baseOptions(createLocalJWKSet(fixtures.publicJwks)),
      onError,
    } as any);

    const req = makeReq("Bearer not-a-real-jwt");
    const res = makeRes();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
  });
});
