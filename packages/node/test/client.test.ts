import { describe, it, expect, vi } from "vitest";
import { RootHeraldClient } from "../src/client.js";
import {
  ActivationRefusedError,
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";
import { RootHeraldError } from "@rootherald/contracts";
import type { AttestationVerdict } from "@rootherald/contracts";

const SK = "rh_sk_test_abc123";
const BASE = "https://api.example.test";

const NONCE = "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY";

const CHALLENGE_WIRE = {
  nonce: NONCE,
  expiresAt: "2026-01-01T00:00:00Z",
  challenge: `rhc1.${NONCE}.eyJhc2siOlsiaWRlbnRpdHkiLCJwb3N0dXJlIl19`,
};

/** Builds a fetch mock that returns the given status/json for the next call. */
function mockFetch(status: number, json: unknown, headers: Record<string, string> = {}): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json", ...headers },
    }),
  ) as unknown as typeof fetch;
}

function calls(fetchMock: typeof fetch): [string, { method: string; headers: Record<string, string>; body: string }][] {
  return (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls as never;
}

/** A minimal but shape-correct AttestationVerdict for verify responses. */
function sampleVerdict(): AttestationVerdict {
  return {
    acr: "urn:rootherald:device:high",
    amr: ["hwk"],
    authTime: new Date(0),
    expiresAt: new Date(0),
    userId: "user-1",
    requestedAcrValues: [],
    device: {
      ueid: "device-uuid-1234",
      earStatus: "affirming",
      verdict: "pass",
      attestationType: "tpm20",
      attestedAt: new Date(0),
      quoteVerified: true,
      secureBootVerified: true,
    },
    // raw is the JWT claim set; not asserted here.
    raw: {} as AttestationVerdict["raw"],
  };
}

describe("RootHeraldClient constructor", () => {
  it("throws when secretKey is missing", () => {
    // @ts-expect-error intentionally omitting secretKey
    expect(() => new RootHeraldClient({})).toThrow(RootHeraldError);
  });

  it("throws when secretKey is not rh_sk_-prefixed", () => {
    expect(() => new RootHeraldClient({ secretKey: "rh_bogus_xyz" })).toThrow(RootHeraldError);
  });

  it("accepts a valid rh_sk_ key", () => {
    expect(() => new RootHeraldClient({ secretKey: SK })).not.toThrow();
  });
});

describe("issueChallenge", () => {
  it("sends the C1 request (URL, Bearer header, body) and returns the whole response", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.issueChallenge({ deviceHint: "laptop-7" });

    expect(out).toEqual(CHALLENGE_WIRE);

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/challenge`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ deviceHint: "laptop-7" });
  });

  it("sends an empty body when no options are given (ask defaults server-side)", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.issueChallenge();

    const [, init] = calls(fetchMock)[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("sends ask and keyPurpose, and never a policy", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.issueChallenge({
      ask: ["identity", "key"],
      keyPurpose: "sign",
    });

    const [, init] = calls(fetchMock)[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({ ask: ["identity", "key"], keyPurpose: "sign" });
    expect("policy" in body).toBe(false);
  });

  it("returns the challenge string verbatim", async () => {
    const fetchMock = mockFetch(200, { ...CHALLENGE_WIRE, challenge: "rhc1.abc.def" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.issueChallenge({ ask: ["posture"] });
    expect(out.challenge).toBe("rhc1.abc.def");
  });

  it("returns only nonce/expiresAt/challenge, dropping anything else the server sends", async () => {
    const fetchMock = mockFetch(200, { ...CHALLENGE_WIRE, challengeId: "legacy" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.issueChallenge();
    expect(out).toEqual(CHALLENGE_WIRE);
    expect("challengeId" in out).toBe(false);
  });

  it("rejects a response without the challenge string", async () => {
    const { challenge: _omitted, ...withoutChallenge } = CHALLENGE_WIRE;
    const fetchMock = mockFetch(200, withoutChallenge);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("rejects a response without the nonce", async () => {
    const { nonce: _omitted, ...withoutNonce } = CHALLENGE_WIRE;
    const fetchMock = mockFetch(200, withoutNonce);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("defaults baseUrl to the canonical rootherald.io host", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, fetch: fetchMock });
    await rh.issueChallenge();

    const [url] = calls(fetchMock)[0];
    expect(url).toBe("https://rootherald.io/api/v1/attest/challenge");
  });
});

describe("verify", () => {
  it("sends the C2 request shape with evidence passed through verbatim", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const evidence = { quote: "AAAA", sig: "BBBB", pcrs: [1, 2, 3], nested: { x: true } };
    await rh.verify(evidence, { nonce: NONCE });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/verify`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    const body = JSON.parse(init.body);
    expect(body.nonce).toBe(NONCE);
    expect("challengeId" in body).toBe(false);
    expect("policy" in body).toBe(false);
    expect(body.evidence).toEqual(evidence); // verbatim pass-through
  });

  it("returns the parsed verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(verdict.device.ueid).toBe("device-uuid-1234");
    expect(verdict.device.verdict).toBe("pass");
    expect(verdict.acr).toBe("urn:rootherald:device:high");
  });

  it("returns a fail verdict (un-enrolled device) as a normal verdict, not an error", async () => {
    const failVerdict = sampleVerdict();
    failVerdict.device.verdict = "fail";
    failVerdict.device.earStatus = "contraindicated";
    const fetchMock = mockFetch(200, { verdict: failVerdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(verdict.device.verdict).toBe("fail");
  });

  it("throws MISSING_NONCE before any fetch when nonce is missing", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally omitting nonce
    const err = await rh.verify({ blob: 1 }, {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
    expect((err as RootHeraldError).code).toBe("MISSING_NONCE");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("throws MISSING_NONCE when nonce is empty", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const err = await rh.verify({ blob: 1 }, { nonce: "" }).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("MISSING_NONCE");
  });

  it("passes cohort fields on verdict.device through verbatim", async () => {
    const verdict = sampleVerdict();
    verdict.device.cohortKey = "tpm20:win11:sb1:abc123";
    verdict.device.cohortScope = "tenant-fleet";
    verdict.device.cohortPrevalence = 0.042;
    verdict.device.cohortPrevalencePerPcr = { "0": 0.9, "7": 0.5 };
    verdict.device.cohortSampleSize = 1287;
    verdict.device.novelProfile = false;
    const fetchMock = mockFetch(200, { verdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(out.device.cohortKey).toBe("tpm20:win11:sb1:abc123");
    expect(out.device.cohortScope).toBe("tenant-fleet");
    expect(out.device.cohortPrevalence).toBe(0.042);
    expect(out.device.cohortPrevalencePerPcr).toEqual({ "0": 0.9, "7": 0.5 });
    expect(out.device.cohortSampleSize).toBe(1287);
    expect(out.device.novelProfile).toBe(false);
  });

  it("parses ISO-8601 string dates from the REAL response shape into Date objects", async () => {
    // The server serializes .NET DateTimeOffset as ISO-8601 STRINGS, not JS
    // Date objects. Build the wire shape exactly as it arrives over HTTP so a
    // naive `as Date` cast would leave strings that throw on `.getTime()`.
    const wireVerdict = {
      acr: "urn:rootherald:device:high",
      amr: ["hwk"],
      authTime: "2026-06-28T12:00:00Z",
      expiresAt: "2026-06-28T12:05:00Z",
      userId: "user-1",
      requestedAcrValues: [],
      device: {
        ueid: "device-uuid-1234",
        earStatus: "affirming",
        verdict: "pass",
        attestationType: "tpm20",
        attestedAt: "2026-06-28T11:59:30Z",
        quoteVerified: true,
        secureBootVerified: true,
      },
      raw: {},
    };
    const fetchMock = mockFetch(200, { verdict: wireVerdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.authTime).toBeInstanceOf(Date);
    expect(out.expiresAt).toBeInstanceOf(Date);
    expect(out.device.attestedAt).toBeInstanceOf(Date);
    expect(() => out.authTime.getTime()).not.toThrow();
    expect(out.authTime.getTime()).toBe(Date.parse("2026-06-28T12:00:00Z"));
    expect(out.expiresAt.getTime()).toBe(Date.parse("2026-06-28T12:05:00Z"));
    expect(out.device.attestedAt.getTime()).toBe(
      Date.parse("2026-06-28T11:59:30Z"),
    );
  });

  it("accepts epoch-number dates and existing Date objects too", async () => {
    const epochMs = Date.UTC(2026, 5, 28, 12, 0, 0);
    const wireVerdict = {
      ...JSON.parse(JSON.stringify(sampleVerdict())),
      authTime: epochMs, // number (epoch ms)
      expiresAt: new Date(epochMs).toISOString(), // ISO string
    };
    const fetchMock = mockFetch(200, { verdict: wireVerdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(out.authTime).toBeInstanceOf(Date);
    expect(out.authTime.getTime()).toBe(epochMs);
    expect(out.expiresAt.getTime()).toBe(epochMs);
  });

  it("refuses a verdict whose device.verdict is null with a typed protocol error", async () => {
    const wire = JSON.parse(JSON.stringify(sampleVerdict()));
    wire.device.verdict = null;
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict: wire }) });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
    expect((err as Error).message).toContain("verdict.device.verdict");
  });

  it("refuses a verdict token outside pass/warn/fail", async () => {
    const wire = JSON.parse(JSON.stringify(sampleVerdict()));
    wire.device.verdict = "allow";
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict: wire }) });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("refuses a verdict without a device object", async () => {
    const { device: _omitted, ...wire } = JSON.parse(JSON.stringify(sampleVerdict()));
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict: wire }) });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it.each([
    ["issuedAt garbage", { authTime: "garbage" }, "verdict.authTime"],
    ["expiresAt missing", { expiresAt: undefined }, "verdict.expiresAt"],
    ["attestedAt object", { device: { ...JSON.parse(JSON.stringify(sampleVerdict())).device, attestedAt: {} } }, "verdict.device.attestedAt"],
  ])("refuses an unparseable timestamp (%s) instead of returning Invalid Date", async (_name, patch, field) => {
    const wire = { ...JSON.parse(JSON.stringify(sampleVerdict())), ...patch };
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict: wire }) });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
    expect((err as Error).message).toContain(field);
  });

  it("leaves cohort fields absent when the server omits them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(out.device.cohortKey).toBeUndefined();
    expect(out.device.cohortPrevalence).toBeUndefined();
    expect(out.device.novelProfile).toBeUndefined();
  });

  it("sends requestedDisclosureClass in the body when supplied", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.verify(
      { blob: 1 },
      { nonce: NONCE, requestedDisclosureClass: "pseudonymous" },
    );

    const [, init] = calls(fetchMock)[0];
    expect(JSON.parse(init.body).requestedDisclosureClass).toBe("pseudonymous");
  });

  it("omits requestedDisclosureClass from the body when not supplied", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.verify({ blob: 1 }, { nonce: NONCE });

    const [, init] = calls(fetchMock)[0];
    expect("requestedDisclosureClass" in JSON.parse(init.body)).toBe(false);
  });

  // ── assuranceClaimsMet / enrollmentRequired / key come from the response ROOT ──
  it("surfaces assuranceClaimsMet + enrollmentRequired from the response root", async () => {
    const fetchMock = mockFetch(200, {
      verdict: sampleVerdict(),
      assuranceClaimsMet: ["device-bound", "fresh-attestation"],
      enrollmentRequired: true,
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.assuranceClaimsMet).toEqual(["device-bound", "fresh-attestation"]);
    expect(out.enrollmentRequired).toBe(true);
    expect(out.device.verdict).toBe("pass");
  });

  it("reads the root-level fields at the ROOT only, never from inside verdict", async () => {
    // Decoy copies nested inside `verdict` with DIFFERENT values must be ignored;
    // only the response-root siblings of `verdict` are surfaced.
    const verdictWithDecoys = {
      ...sampleVerdict(),
      assuranceClaimsMet: ["NESTED-should-be-ignored"],
      enrollmentRequired: false,
      key: { keyId: "NESTED", jwk: { kty: "EC", crv: "P-256", x: "x", y: "y" }, purpose: "sign", certifiedAt: "2026-01-01T00:00:00Z" },
    };
    const fetchMock = mockFetch(200, {
      verdict: verdictWithDecoys,
      assuranceClaimsMet: ["root-claim"],
      enrollmentRequired: true,
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.assuranceClaimsMet).toEqual(["root-claim"]);
    expect(out.enrollmentRequired).toBe(true);
    // The root sent no key, so there is none — the nested decoy is not it.
    expect(out.key).toBeUndefined();
  });

  it("omits assuranceClaimsMet + enrollmentRequired + key when the root does not send them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.assuranceClaimsMet).toBeUndefined();
    expect(out.enrollmentRequired).toBeUndefined();
    expect(out.key).toBeUndefined();
  });

  it("parses the certified key from the response root, with certifiedAt as a Date", async () => {
    const fetchMock = mockFetch(200, {
      verdict: sampleVerdict(),
      key: {
        keyId: "k-9f3a",
        jwk: { kty: "EC", crv: "P-256", x: "eHh4", y: "eXl5" },
        purpose: "sign",
        authPolicy: "cG9saWN5",
        certifiedAt: "2026-06-30T00:01:00Z",
      },
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.key).toBeDefined();
    expect(out.key!.keyId).toBe("k-9f3a");
    expect(out.key!.jwk).toEqual({ kty: "EC", crv: "P-256", x: "eHh4", y: "eXl5" });
    expect(out.key!.purpose).toBe("sign");
    expect(out.key!.authPolicy).toBe("cG9saWN5");
    expect(out.key!.certifiedAt).toBeInstanceOf(Date);
    expect(out.key!.certifiedAt.getTime()).toBe(Date.parse("2026-06-30T00:01:00Z"));
  });

  it("drops a malformed key block rather than surfacing it half-parsed", async () => {
    const fetchMock = mockFetch(200, {
      verdict: sampleVerdict(),
      key: { keyId: "k-1", jwk: { kty: "RSA", n: "…", e: "AQAB" }, purpose: "sign", certifiedAt: "2026-06-30T00:01:00Z" },
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(out.key).toBeUndefined();
  });
});

describe("error mapping", () => {
  const cases: Array<[number, string, new (...args: never[]) => RootHeraldApiError]> = [
    [401, "invalid_secret_key", InvalidSecretKeyError],
    [401, "activation_refused", ActivationRefusedError],
    [422, "unknown_policy", UnknownPolicyError],
    [422, "admission_refused", AdmissionRefusedError],
    [409, "challenge_expired_or_used", ChallengeError],
    [400, "invalid_evidence", InvalidEvidenceError],
    [429, "quota_exceeded", QuotaExceededError],
    [429, "rate_limited", RateLimitedError],
  ];

  for (const [status, errorCode, ErrClass] of cases) {
    it(`maps ${status} ${errorCode} to ${ErrClass.name}`, async () => {
      const fetchMock = mockFetch(status, { error: errorCode });
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

      const err = await rh
        .verify({ blob: 1 }, { nonce: NONCE })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ErrClass);
      expect(err).toBeInstanceOf(RootHeraldApiError);
      expect((err as RootHeraldApiError).status).toBe(status);
      expect((err as RootHeraldApiError).errorCode).toBe(errorCode);
    });
  }

  it("maps a 422 with no body code to UnknownPolicyError", async () => {
    const fetchMock = mockFetch(422, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownPolicyError);
  });

  it("keeps a 422 posture_not_bound generic, with the code preserved", async () => {
    const fetchMock = mockFetch(422, { error: "posture_not_bound", message: "no posture policy" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge({ ask: ["posture"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect(err).not.toBeInstanceOf(UnknownPolicyError);
    expect((err as RootHeraldApiError).status).toBe(422);
    expect((err as RootHeraldApiError).errorCode).toBe("posture_not_bound");
    expect((err as Error).message).toBe("no posture policy");
  });

  it("keeps a 402 plan_lapsed generic, with the code preserved", async () => {
    const fetchMock = mockFetch(402, { error: "plan_lapsed", message: "plan lapsed" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge({ ask: ["posture"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).status).toBe(402);
    expect((err as RootHeraldApiError).errorCode).toBe("plan_lapsed");
  });

  it("maps a 401 activation_refused to ActivationRefusedError, not InvalidSecretKeyError", async () => {
    const fetchMock = mockFetch(401, {
      error: "activation_refused",
      message: "Invalid credential activation response",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActivationRefusedError);
    expect(err).not.toBeInstanceOf(InvalidSecretKeyError);
    expect((err as RootHeraldApiError).errorCode).toBe("activation_refused");
    expect((err as Error).message).toBe("Invalid credential activation response");
  });

  it("maps a bare 401 (no body) to InvalidSecretKeyError", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 401 })) as unknown as typeof fetch;
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretKeyError);
  });

  it("maps a limiter 429 to RateLimitedError with retryAfterSeconds from Retry-After", async () => {
    const fetchMock = mockFetch(
      429,
      { error: "rate_limited", message: "Too many requests", retryAfterSeconds: 60 },
      { "Retry-After": "17" },
    );
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err).not.toBeInstanceOf(QuotaExceededError);
    expect((err as RateLimitedError).retryAfterSeconds).toBe(17);
    expect((err as RateLimitedError).errorCode).toBe("rate_limited");
  });

  it("falls back to the body's retryAfterSeconds when there is no Retry-After header", async () => {
    const fetchMock = mockFetch(429, { error: "rate_limited", retryAfterSeconds: 60 });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBe(60);
  });

  it("maps an empty 429 to RateLimitedError with no retry hint", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 429 })) as unknown as typeof fetch;
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBeUndefined();
  });

  it("maps a 429 carrying X-RootHerald-Quota to QuotaExceededError whatever the body says", async () => {
    const fetchMock = mockFetch(429, {}, { "X-RootHerald-Quota": "device-limit-exceeded" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
  });

  it("carries the server's detail as the message on admission_refused", async () => {
    const fetchMock = mockFetch(422, {
      error: "admission_refused",
      detail: "firmware TPM cannot satisfy discrete-TPM-only policy",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect((err as Error).message).toContain("firmware TPM");
  });

  it("maps an unmapped status (500) to a generic RootHeraldApiError", async () => {
    const fetchMock = mockFetch(500, { error: "internal" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh
      .issueChallenge()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).status).toBe(500);
  });
});

// ── Enroll relay: relayEnroll / relayActivate ──────────────────────────────
describe("relayEnroll", () => {
  const enrollBlob = {
    ekPublicKey: "<base64 ekpub>",
    akPublicArea: "<base64 ak pub area>",
    platform: "windows" as const,
    ekCertPem: "-----BEGIN CERTIFICATE-----\n...",
    tpmSelfReport: { manufacturer: "INTC", vendorString: "Intel" },
  };

  const tpmChallenge = {
    enrollmentId: "enr-uuid-1",
    credentialBlob: "<base64 id-object>",
    encryptedSecret: "<base64 secret>",
  };

  it("201 returns the TPM challenge body as `challenge`, and nothing else", async () => {
    const fetchMock = mockFetch(201, tpmChallenge);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayEnroll(enrollBlob);

    expect(out).toEqual({ challenge: tpmChallenge });
    expect("deviceId" in out).toBe(false);

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/enroll`); // no query string
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual(enrollBlob); // relayed verbatim
  });

  it("201 returns the macOS challenge body (enrollmentId + challengeNonce)", async () => {
    const macChallenge = { enrollmentId: "enr-uuid-2", challengeNonce: "<base64 nonce>" };
    const fetchMock = mockFetch(201, macChallenge);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayEnroll({
      ekPublicKey: "<base64 P-256>",
      akPublicArea: "<base64 P-256>",
      platform: "macos",
    });
    expect(out).toEqual({ challenge: macChallenge });
  });

  it("accepts an empty 201 for an iOS blob and returns an empty challenge", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const iosBlob = {
      platform: "ios" as const,
      iosKeyId: "<base64 key id>",
      iosAttestationObject: "<base64 CBOR>",
      nonce: NONCE,
    };
    const out = await rh.relayEnroll(iosBlob);
    expect(out).toEqual({ challenge: {} });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/enroll`);
    expect(JSON.parse(init.body)).toEqual(iosBlob);
  });

  it("rejects an empty 201 for a TPM blob", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("maps 422 admission_refused to AdmissionRefusedError", async () => {
    const fetchMock = mockFetch(422, { error: "admission_refused", detail: "firmware TPM" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect((err as RootHeraldApiError).errorCode).toBe("admission_refused");
  });

  it("throws INVALID_RESPONSE when a 201 has an enrollmentId but no credential material", async () => {
    const fetchMock = mockFetch(201, { enrollmentId: "enr-1" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("throws INVALID_RESPONSE when a 201 has credential material but no enrollmentId", async () => {
    const { enrollmentId: _omitted, ...withoutId } = tpmChallenge;
    const fetchMock = mockFetch(201, { ...withoutId, deviceId: "legacy" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("maps a 401 to InvalidSecretKeyError", async () => {
    const fetchMock = mockFetch(401, { error: "invalid_secret_key" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretKeyError);
  });

  it("throws before any fetch when the enroll blob is malformed", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally missing required fields
    await expect(rh.relayEnroll({ platform: "windows" })).rejects.toThrow(RootHeraldError);
    expect(calls(fetchMock).length).toBe(0);
  });

  it("throws before any fetch when an iOS blob lacks its nonce", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const bad = { platform: "ios", iosKeyId: "k", iosAttestationObject: "a" } as never;
    const err = await rh.relayEnroll(bad).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("INVALID_ENROLL_BLOB");
    expect(calls(fetchMock).length).toBe(0);
  });
});

describe("relayActivate", () => {
  const activateBlob = {
    enrollmentId: "enr-uuid-1",
    decryptedSecret: "<base64 32-byte secret>",
  };

  it("hits POST /api/v1/attest/activate and returns the terminal body", async () => {
    const fetchMock = mockFetch(200, {
      deviceId: "dev-uuid-1",
      status: "enrolled",
      enrolledAt: "2026-06-30T00:00:00Z",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayActivate(activateBlob);
    expect(out).toEqual({
      deviceId: "dev-uuid-1",
      status: "enrolled",
      enrolledAt: "2026-06-30T00:00:00Z",
    });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/activate`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual(activateBlob); // relayed verbatim
  });

  it("accepts a macOS activation (enrollmentId + signature)", async () => {
    const fetchMock = mockFetch(200, { deviceId: "dev-uuid-3" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const macBlob = { enrollmentId: "enr-uuid-3", signature: "<base64 ECDSA>" };
    const out = await rh.relayActivate(macBlob);
    expect(out).toEqual({ deviceId: "dev-uuid-3" });
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual(macBlob);
  });

  it("returns just deviceId when the server omits status/enrolledAt", async () => {
    const fetchMock = mockFetch(200, { deviceId: "dev-uuid-2" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.relayActivate(activateBlob);
    expect(out).toEqual({ deviceId: "dev-uuid-2" });
  });

  it("throws before any fetch when enrollmentId is missing", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally missing enrollmentId
    const err = await rh.relayActivate({ decryptedSecret: "s" }).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("INVALID_ACTIVATION_BLOB");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("throws before any fetch when enrollmentId is empty", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh
      .relayActivate({ enrollmentId: "", decryptedSecret: "s" })
      .catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("INVALID_ACTIVATION_BLOB");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("throws before any fetch when neither decryptedSecret nor signature is present", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayActivate({ enrollmentId: "enr-1" }).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("INVALID_ACTIVATION_BLOB");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("maps an activation refusal to ActivationRefusedError, not InvalidSecretKeyError", async () => {
    const fetchMock = mockFetch(401, {
      error: "activation_refused",
      message: "Invalid credential activation response",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayActivate(activateBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ActivationRefusedError);
    expect(err).not.toBeInstanceOf(InvalidSecretKeyError);
  });

  it("maps a 401 invalid_secret_key from activate to InvalidSecretKeyError", async () => {
    const fetchMock = mockFetch(401, { error: "invalid_secret_key" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayActivate(activateBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretKeyError);
  });
});

describe("relayMobileEnrollment (mobile bridge)", () => {
  const enrollment = {
    platform: "ios" as const,
    iosKeyId: "b64key",
    iosAttestationObject: "b64cbor",
    nonce: NONCE,
  };

  it("relays the enrollment when the envelope nonce matches the blob's", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.relayMobileEnrollment({ nonce: NONCE, enrollment });
    expect(out).toEqual({ challenge: {} });
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/enroll`);
    expect(JSON.parse(init.body)).toEqual(enrollment);
  });

  it("refuses an envelope nonce that differs from the blob's before any fetch", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh
      .relayMobileEnrollment({ nonce: "some-other-nonce", enrollment })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
    expect((err as RootHeraldError).code).toBe("NONCE_MISMATCH");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("refuses a body missing nonce", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(201, {}) });
    const err = await rh.relayMobileEnrollment({ nonce: "", enrollment }).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("MISSING_NONCE");
  });

  it("refuses a non-iOS enrollment", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(201, {}) });
    const bad = { nonce: NONCE, enrollment: { platform: "windows", ekPublicKey: "e", akPublicArea: "a" } } as never;
    const err = await rh.relayMobileEnrollment(bad).catch((e: unknown) => e);
    expect((err as RootHeraldError).code).toBe("INVALID_ENROLL_BLOB");
  });
});

describe("verifyMobileEvidence (mobile bridge)", () => {
  const appVerifyBody = {
    nonce: NONCE,
    evidence: { iosAttestation: { assertion: "b64cbor", keyId: "b64key" } },
  };

  it("brokers verify() under the nonce and returns the verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict(), assuranceClaimsMet: ["real-device"] });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const result = await rh.verifyMobileEvidence(appVerifyBody);
    expect(result.device.verdict).toBe("pass");
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/verify`);
    const sent = JSON.parse(init.body);
    expect(sent.nonce).toBe(NONCE);
    expect("challengeId" in sent).toBe(false);
    expect(sent.evidence.iosAttestation).toEqual({ assertion: "b64cbor", keyId: "b64key" });
  });

  it("rejects a body missing nonce", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const err = await rh.verifyMobileEvidence({ ...appVerifyBody, nonce: "" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
    expect((err as RootHeraldError).code).toBe("MISSING_NONCE");
  });

  it("rejects a body missing the assertion", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const bad = { nonce: NONCE, evidence: { iosAttestation: { keyId: "x" } } } as never;
    const err = await rh.verifyMobileEvidence(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidEvidenceError);
  });

  it("rejects an attestation object where an assertion is required", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const bad = {
      nonce: NONCE,
      evidence: { iosAttestation: { attestationObject: "x", keyId: "k" } },
    } as never;
    const err = await rh.verifyMobileEvidence(bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidEvidenceError);
  });
});

// The secret rides in an Authorization header on every request and is
// full-privilege, so a base URL that is not https hands it to anyone on the
// path. A typo is enough, and nothing downstream notices because the request
// itself still succeeds.
describe("baseUrl must not put the secret key in cleartext", () => {
  it.each([
    "http://api.example.test",
    "http://rootherald.io",
    "api.example.test",
    "//api.example.test",
    "",
  ])("rejects %j", (baseUrl) => {
    expect(() => new RootHeraldClient({ secretKey: SK, baseUrl })).toThrow(RootHeraldError);
  });

  // Loopback stays usable so the local docker stack works over http.
  it.each([
    "https://api.example.test",
    "http://localhost:8080",
    "http://127.0.0.1:5000",
    "http://[::1]:5000",
  ])("accepts %j", (baseUrl) => {
    expect(() => new RootHeraldClient({ secretKey: SK, baseUrl })).not.toThrow();
  });
});
