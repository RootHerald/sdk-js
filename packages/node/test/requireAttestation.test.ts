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
