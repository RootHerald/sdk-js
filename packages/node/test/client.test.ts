import { describe, it, expect, vi } from "vitest";
import { RootHerald } from "../src/client.js";
import {
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RootHeraldApiError,
  RootHeraldError,
  UnknownPolicyError,
} from "@rootherald/contracts";
import type { AttestationVerdict } from "@rootherald/contracts";

const SK = "rh_sk_test_abc123";
const BASE = "https://api.example.test";

/** Builds a fetch mock that returns the given status/json for the next call. */
function mockFetch(status: number, json: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  ) as unknown as typeof fetch;
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

describe("RootHerald constructor", () => {
  it("throws when secretKey is missing", () => {
    // @ts-expect-error intentionally omitting secretKey
    expect(() => new RootHerald({})).toThrow(RootHeraldError);
  });

  it("throws when secretKey is not rh_sk_-prefixed (e.g. a publishable key)", () => {
    expect(() => new RootHerald({ secretKey: "rh_pk_live_xyz" })).toThrow(RootHeraldError);
  });

  it("accepts a valid rh_sk_ key", () => {
    expect(() => new RootHerald({ secretKey: SK })).not.toThrow();
  });
});

describe("createChallenge", () => {
  it("sends the C1 request (URL, Bearer header, body) and parses the response", async () => {
    const fetchMock = mockFetch(200, {
      challengeId: "chal-1",
      nonce: "bm9uY2U=",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.createChallenge({ deviceHint: "laptop-7" });

    expect(out).toEqual({
      challengeId: "chal-1",
      nonce: "bm9uY2U=",
      expiresAt: "2026-01-01T00:00:00Z",
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/attestations/challenge`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ deviceHint: "laptop-7" });
  });

  it("omits deviceHint from the body when not provided", async () => {
    const fetchMock = mockFetch(200, {
      challengeId: "c",
      nonce: "n",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.createChallenge();

    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({});
  });
});

describe("attest", () => {
  it("sends the C2 request shape with evidence passed through verbatim", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const evidence = { quote: "AAAA", sig: "BBBB", pcrs: [1, 2, 3], nested: { x: true } };
    await rh.attest(evidence, { challengeId: "chal-1", policy: "rootherald:builtin:strict" });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/attestations/verify`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    const body = JSON.parse(init.body);
    expect(body.challengeId).toBe("chal-1");
    expect(body.policy).toBe("rootherald:builtin:strict");
    expect(body.evidence).toEqual(evidence); // verbatim pass-through
    expect("returnToken" in body).toBe(false); // omitted when not requested
  });

  it("returns the parsed verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(verdict.device.ueid).toBe("device-uuid-1234");
    expect(verdict.device.verdict).toBe("pass");
    expect(verdict.acr).toBe("urn:rootherald:device:high");
    expect(verdict.token).toBeUndefined();
  });

  it("surfaces the token when returnToken:true and the server returns one", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict(), token: "eyJ.aaa.bbb" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.attest({ blob: 1 }, { challengeId: "chal-1", returnToken: true });

    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(init.body).returnToken).toBe(true);
    expect(verdict.token).toBe("eyJ.aaa.bbb");
  });

  it("returns a fail verdict (un-enrolled device) as a normal verdict, not an error", async () => {
    const failVerdict = sampleVerdict();
    failVerdict.device.verdict = "fail";
    failVerdict.device.earStatus = "contraindicated";
    const fetchMock = mockFetch(200, { verdict: failVerdict });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(verdict.device.verdict).toBe("fail");
  });

  it("throws when challengeId is missing", async () => {
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    // @ts-expect-error intentionally omitting challengeId
    await expect(rh.attest({ blob: 1 }, {})).rejects.toThrow(RootHeraldError);
  });

  it("defaults baseUrl to the canonical api.rootherald.io host", async () => {
    const fetchMock = mockFetch(200, {
      challengeId: "c",
      nonce: "n",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const rh = new RootHerald({ secretKey: SK, fetch: fetchMock });
    await rh.createChallenge();

    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.rootherald.io/api/v1/attestations/challenge");
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
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.device.cohortKey).toBe("tpm20:win11:sb1:abc123");
    expect(out.device.cohortScope).toBe("tenant-fleet");
    expect(out.device.cohortPrevalence).toBe(0.042);
    expect(out.device.cohortPrevalencePerPcr).toEqual({ "0": 0.9, "7": 0.5 });
    expect(out.device.cohortSampleSize).toBe(1287);
    expect(out.device.novelProfile).toBe(false);
  });

  it("parses ISO-8601 string dates from the REAL response shape into Date objects (F-09)", async () => {
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
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });

    // No throw, and the date fields are real Dates with the expected values.
    expect(out.authTime).toBeInstanceOf(Date);
    expect(out.expiresAt).toBeInstanceOf(Date);
    expect(out.device.attestedAt).toBeInstanceOf(Date);
    // Calling .getTime() must NOT throw (the exact F-09 crash) and be correct.
    expect(() => out.authTime.getTime()).not.toThrow();
    expect(out.authTime.getTime()).toBe(Date.parse("2026-06-28T12:00:00Z"));
    expect(out.expiresAt.getTime()).toBe(Date.parse("2026-06-28T12:05:00Z"));
    expect(out.device.attestedAt.getTime()).toBe(
      Date.parse("2026-06-28T11:59:30Z"),
    );
  });

  it("accepts epoch-number dates and existing Date objects too (F-09 robustness)", async () => {
    const epochMs = Date.UTC(2026, 5, 28, 12, 0, 0);
    const wireVerdict = {
      ...JSON.parse(JSON.stringify(sampleVerdict())),
      authTime: epochMs, // number (epoch ms)
      expiresAt: new Date(epochMs).toISOString(), // ISO string
    };
    const fetchMock = mockFetch(200, { verdict: wireVerdict });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.authTime).toBeInstanceOf(Date);
    expect(out.authTime.getTime()).toBe(epochMs);
    expect(out.expiresAt.getTime()).toBe(epochMs);
  });

  it("leaves cohort fields absent when the server omits them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.device.cohortKey).toBeUndefined();
    expect(out.device.cohortPrevalence).toBeUndefined();
    expect(out.device.novelProfile).toBeUndefined();
  });
});

describe("error mapping", () => {
  const cases: Array<[number, string, new (...args: never[]) => RootHeraldApiError]> = [
    [401, "invalid_secret_key", InvalidSecretKeyError],
    [422, "unknown_policy", UnknownPolicyError],
    [409, "challenge_expired_or_used", ChallengeError],
    [400, "invalid_evidence", InvalidEvidenceError],
    [429, "quota_exceeded", QuotaExceededError],
  ];

  for (const [status, errorCode, ErrClass] of cases) {
    it(`maps ${status} ${errorCode} to ${ErrClass.name}`, async () => {
      const fetchMock = mockFetch(status, { error: errorCode });
      const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

      const err = await rh
        .attest({ blob: 1 }, { challengeId: "chal-1" })
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ErrClass);
      expect(err).toBeInstanceOf(RootHeraldApiError);
      expect((err as RootHeraldApiError).status).toBe(status);
      expect((err as RootHeraldApiError).errorCode).toBe(errorCode);
    });
  }

  it("maps an unmapped status (500) to a generic RootHeraldApiError", async () => {
    const fetchMock = mockFetch(500, { error: "internal" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh
      .createChallenge()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).status).toBe(500);
  });
});

// ── ABI 2.0 canonical names: issueChallenge / verify ───────────────────────
describe("issueChallenge (ABI 2.0 name for createChallenge)", () => {
  it("hits POST /api/v1/attestations/challenge with the rh_sk_ bearer", async () => {
    const fetchMock = mockFetch(200, {
      challengeId: "chal-9",
      nonce: "bm9uY2U=",
      expiresAt: "2026-01-01T00:00:00Z",
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.issueChallenge({ deviceHint: "laptop-7" });
    expect(out).toEqual({
      challengeId: "chal-9",
      nonce: "bm9uY2U=",
      expiresAt: "2026-01-01T00:00:00Z",
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/attestations/challenge`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
  });

  it("createChallenge is a thin alias that delegates to issueChallenge", async () => {
    const fetchMock = mockFetch(200, { challengeId: "c", nonce: "n", expiresAt: "2026-01-01T00:00:00Z" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.createChallenge();
    expect(out.challengeId).toBe("c");
  });
});

describe("verify (ABI 2.0 name for attest)", () => {
  it("hits POST /api/v1/attestations/verify and returns the verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
    expect(verdict.device.verdict).toBe("pass");

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/attestations/verify`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
  });

  it("throws when challengeId is missing", async () => {
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    // @ts-expect-error intentionally omitting challengeId
    await expect(rh.verify({ blob: 1 }, {})).rejects.toThrow(RootHeraldError);
  });

  it("attest is a thin alias that delegates to verify", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.attest({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.device.ueid).toBe("device-uuid-1234");
  });

  // ── G1: assuranceClaimsMet / enrollmentRequired come from the response ROOT ──
  it("surfaces assuranceClaimsMet + enrollmentRequired from the response root (G1)", async () => {
    const fetchMock = mockFetch(200, {
      verdict: sampleVerdict(),
      assuranceClaimsMet: ["device-bound", "fresh-attestation"],
      enrollmentRequired: true,
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

    expect(out.assuranceClaimsMet).toEqual(["device-bound", "fresh-attestation"]);
    expect(out.enrollmentRequired).toBe(true);
    // Still a normal verdict alongside the root-level fields.
    expect(out.device.verdict).toBe("pass");
  });

  it("reads assuranceClaimsMet + enrollmentRequired at the ROOT only, never from inside verdict (G1)", async () => {
    // Decoy copies nested inside `verdict` with DIFFERENT values must be ignored;
    // only the response-root siblings of `verdict` are surfaced.
    const verdictWithDecoys = {
      ...sampleVerdict(),
      assuranceClaimsMet: ["NESTED-should-be-ignored"],
      enrollmentRequired: false,
    };
    const fetchMock = mockFetch(200, {
      verdict: verdictWithDecoys,
      assuranceClaimsMet: ["root-claim"],
      enrollmentRequired: true,
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

    // Root wins; the nested decoys are never picked up.
    expect(out.assuranceClaimsMet).toEqual(["root-claim"]);
    expect(out.enrollmentRequired).toBe(true);
  });

  it("omits assuranceClaimsMet + enrollmentRequired when the root does not send them (G1)", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

    expect(out.assuranceClaimsMet).toBeUndefined();
    expect(out.enrollmentRequired).toBeUndefined();
  });
});

// ── Enroll relay: relayEnroll / relayActivate ──────────────────────────────
describe("relayEnroll", () => {
  const enrollBlob = {
    ekPublicKey: "<base64 ekpub>",
    akPublicArea: "<base64 ak pub area>",
    platform: "windows" as const,
    ekCertPem: "-----BEGIN CERTIFICATE-----\n...",
  };

  it("201 returns the full challenge + deviceId, alreadyEnrolled:false", async () => {
    const fetchMock = mockFetch(201, {
      deviceId: "dev-uuid-1",
      credentialBlob: "<base64 id-object>",
      encryptedSecret: "<base64 secret>",
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayEnroll(enrollBlob);

    expect(out.alreadyEnrolled).toBe(false);
    expect(out.deviceId).toBe("dev-uuid-1");
    expect(out.challenge).toEqual({
      deviceId: "dev-uuid-1",
      credentialBlob: "<base64 id-object>",
      encryptedSecret: "<base64 secret>",
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/devices/enroll`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual(enrollBlob); // relayed verbatim
  });

  it("409 already-enrolled resolves deviceId and signals skip-activate (no challenge)", async () => {
    const fetchMock = mockFetch(409, { deviceId: "dev-uuid-existing" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayEnroll(enrollBlob);

    expect(out.alreadyEnrolled).toBe(true);
    expect(out.deviceId).toBe("dev-uuid-existing");
    expect(out.challenge).toBeUndefined();
    // A 409 must NOT throw here (unlike challenge/verify, where 409 is an error).
  });

  it("throws INVALID_RESPONSE when a 409 omits deviceId", async () => {
    const fetchMock = mockFetch(409, {});
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).status).toBe(409);
  });

  it("throws INVALID_RESPONSE when a 201 is missing credential material", async () => {
    const fetchMock = mockFetch(201, { deviceId: "dev-1" }); // no credentialBlob/encryptedSecret
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
  });

  it("maps a 401 to InvalidSecretKeyError", async () => {
    const fetchMock = mockFetch(401, { error: "invalid_secret_key" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidSecretKeyError);
  });

  it("throws before any fetch when the enroll blob is malformed", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally missing required fields
    await expect(rh.relayEnroll({ platform: "windows" })).rejects.toThrow(RootHeraldError);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});

describe("relayActivate", () => {
  const activateBlob = {
    deviceId: "dev-uuid-1",
    decryptedSecret: "<base64 32-byte secret>",
  };

  it("hits POST /api/v1/devices/activate and returns the terminal body", async () => {
    const fetchMock = mockFetch(200, {
      deviceId: "dev-uuid-1",
      status: "enrolled",
      enrolledAt: "2026-06-30T00:00:00Z",
    });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayActivate(activateBlob);
    expect(out).toEqual({
      deviceId: "dev-uuid-1",
      status: "enrolled",
      enrolledAt: "2026-06-30T00:00:00Z",
    });

    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BASE}/api/v1/devices/activate`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual(activateBlob); // relayed verbatim
  });

  it("returns just deviceId when the server omits status/enrolledAt", async () => {
    const fetchMock = mockFetch(200, { deviceId: "dev-uuid-2" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.relayActivate({ ...activateBlob, deviceId: "dev-uuid-2" });
    expect(out).toEqual({ deviceId: "dev-uuid-2" });
  });

  it("throws before any fetch when the activation blob is malformed", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally missing decryptedSecret
    await expect(rh.relayActivate({ deviceId: "d" })).rejects.toThrow(RootHeraldError);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it("maps a 409 challenge error from activate to ChallengeError", async () => {
    const fetchMock = mockFetch(409, { error: "challenge_expired_or_used" });
    const rh = new RootHerald({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayActivate(activateBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChallengeError);
  });
});
