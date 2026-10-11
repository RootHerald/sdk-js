import { describe, it, expect, vi } from "vitest";
import { RootHeraldClient } from "../src/client.js";
import {
  ActivationRefusedError,
  AdmissionRefusedError,
  ChallengeError,
  InvalidAskError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  QuotaExceededError,
  RateLimitedError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";
import { RootHeraldError } from "@rootherald/contracts";
import type { AttestationVerdict, EnrollRequestBlob, KeyCertification } from "@rootherald/contracts";

const SK = "rh_sk_test_abc123";
const BASE = "https://api.example.test";

const NONCE = "CzBVep_E6Q4zWH2ix-wRNluApcrvFDleg6jN8hc8YYY";

const CHALLENGE_WIRE = {
  nonce: NONCE,
  expiresAt: "2026-01-01T00:00:00Z",
  challenge: `rhc1.${NONCE}.eyJhc2siOlsiaWRlbnRpdHkiLCJwb3N0dXJlIl19`,
};

const KEY_CHALLENGE_WIRE = {
  nonce: NONCE,
  keyChallenge: `rhk1c.${NONCE}.eyJwdXJwb3NlIjoic2lnbiJ9`,
  expiresAt: "2026-01-01T00:00:00Z",
};

const TPM_CERTIFICATION: KeyCertification = {
  publicArea: "cHVi",
  attest: "YXR0",
  signature: "c2ln",
};

const CERTIFIED_EC_WIRE = {
  deviceId: "alias-1",
  keyId: "k-9f3a",
  purpose: "sign",
  alg: "ES256",
  jwk: { kty: "EC", crv: "P-256", x: "eHh4", y: "eXl5" },
  hardwareBound: true,
  certifiedAt: "2026-06-30T00:01:00Z",
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
  it("sends the challenge request (URL, Bearer header, body) and returns the whole response", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.issueChallenge({ ask: ["identity"] });

    expect(out).toEqual(CHALLENGE_WIRE);

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/challenge`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ ask: ["identity"] });
  });

  it("sends an empty body when no options are given (ask defaults server-side)", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.issueChallenge();

    const [, init] = calls(fetchMock)[0];
    expect(JSON.parse(init.body)).toEqual({});
  });

  it("sends ask, expectedKey and expectedDevices, and never keyPurpose, deviceHint or policy", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.issueChallenge({
      ask: ["identity", "posture"],
      expectedKey: "k-9f3a",
      expectedDevices: ["alias-1", "alias-2"],
      ...({ keyPurpose: "sign", deviceHint: "laptop-7" } as object),
    });

    const [, init] = calls(fetchMock)[0];
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      ask: ["identity", "posture"],
      expectedKey: "k-9f3a",
      expectedDevices: ["alias-1", "alias-2"],
    });
    expect("policy" in body).toBe(false);
  });

  it.each([
    ["empty expectedKey", { expectedKey: "" }],
    ["empty expectedDevices", { expectedDevices: [] }],
    ["non-string alias", { expectedDevices: [42] }],
    ["empty alias", { expectedDevices: ["a", ""] }],
  ])("refuses %s before any fetch", async (_name, opts) => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge(opts as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
    expect((err as RootHeraldError).code).toBe("INVALID_ARGUMENT");
    expect(calls(fetchMock).length).toBe(0);
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
  it("sends the verify request shape with evidence passed through verbatim", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const evidence = { quote: "AAAA", sig: "BBBB", pcrs: [1, 2, 3], logs: { srtm: "bG9n" } };
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

  it("never sends expectedKey or expectedDevices to the server; they are compared locally", async () => {
    const verdict = { ...sampleVerdict(), expected: { key: "k-1", devices: ["device-uuid-1234"] } };
    const fetchMock = mockFetch(200, { verdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.verify({ blob: 1 }, { nonce: NONCE, expectedKey: "k-1", expectedDevices: ["device-uuid-1234"] });
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual({ nonce: NONCE, evidence: { blob: 1 } });
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

  it("passes every DeviceVerdictDto field through without a cast (#402)", async () => {
    const verdict = sampleVerdict();
    Object.assign(verdict.device, {
      disclosureClass: "derived",
      tpmKind: "firmware-tpm",
      postureEvaluated: true,
      hardwareGenuine: true,
      ekChainTrusted: true,
      sybilRisk: "none",
      sybilResistance: "distinct-silicon-rotatable",
      returningDevice: true,
      identityAgeBucket: "under-90d",
      accountBindingBand: "1",
      identityFirstSeen: "2026-05-01T00:00:00Z",
      attestationCount: 12,
      accountBindingCount: 1,
      possiblyRotated: false,
      platformRotated: false,
      bootChanged: true,
      bootChangedStages: [7],
      bootChangeAccepted: false,
      bootBaselineAt: "2026-05-02T00:00:00Z",
      cohortKey: "tpm20:win11:sb1:abc123",
      cohortScope: "tenant-fleet",
      cohortPrevalence: 0.042,
      cohortPrevalencePerPcr: { "0": 0.9, "7": 0.5 },
      cohortSampleSize: 1287,
      novelProfile: false,
    });
    const fetchMock = mockFetch(200, { verdict });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    const tpmKind: string | undefined = out.device.tpmKind;
    const stages: number[] | undefined = out.device.bootChangedStages;
    expect(tpmKind).toBe("firmware-tpm");
    expect(stages).toEqual([7]);
    expect(out.device.disclosureClass).toBe("derived");
    expect(out.device.sybilResistance).toBe("distinct-silicon-rotatable");
    expect(out.device.identityFirstSeen).toBeInstanceOf(Date);
    expect(out.device.identityFirstSeen!.getTime()).toBe(Date.parse("2026-05-01T00:00:00Z"));
    expect(out.device.bootBaselineAt).toBeInstanceOf(Date);
    expect(out.device.cohortKey).toBe("tpm20:win11:sb1:abc123");
    expect(out.device.cohortPrevalencePerPcr).toEqual({ "0": 0.9, "7": 0.5 });
    expect(out.device.novelProfile).toBe(false);
  });

  it("accepts a verdict-class response with no ueid and no userId", async () => {
    const verdict = sampleVerdict();
    delete verdict.device.ueid;
    delete verdict.userId;
    verdict.device.disclosureClass = "verdict";
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect(out.device.ueid).toBeUndefined();
    expect(out.userId).toBeUndefined();
    expect(out.device.verdict).toBe("pass");
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
    ["identityFirstSeen garbage", { device: { ...JSON.parse(JSON.stringify(sampleVerdict())).device, identityFirstSeen: "garbage" } }, "verdict.device.identityFirstSeen"],
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

  // ── assuranceClaimsMet / enrollmentRequired come from the response ROOT ──
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
      key: { keyId: "NESTED" },
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
    expect("key" in out).toBe(false);
  });

  it("omits assuranceClaimsMet + enrollmentRequired when the root does not send them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });

    expect(out.assuranceClaimsMet).toBeUndefined();
    expect(out.enrollmentRequired).toBeUndefined();
  });

  it("never surfaces a key from the verify response; keys come from certifyKey", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict(), key: CERTIFIED_EC_WIRE });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.verify({ blob: 1 }, { nonce: NONCE });
    expect("key" in out).toBe(false);
  });

  // ── expectedKey / expectedDevices must be echoed back ────────────────────
  describe("expected binding", () => {
    it("accepts a verdict that echoes the expectedKey and expectedDevices it was asked for", async () => {
      const verdict = { ...sampleVerdict(), expected: { key: "k-1", devices: ["device-uuid-1234", "other"] } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const out = await rh.verify({ blob: 1 }, {
        nonce: NONCE,
        expectedKey: "k-1",
        expectedDevices: ["other", "device-uuid-1234"],
      });
      expect(out.expected).toEqual({ key: "k-1", devices: ["device-uuid-1234", "other"] });
    });

    it("compares aliases case-insensitively: the server echoes lowercase whatever spelling was asked", async () => {
      const verdict = { ...sampleVerdict(), expected: { devices: ["device-uuid-1234", "other"] } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const out = await rh.verify({ blob: 1 }, {
        nonce: NONCE,
        expectedDevices: ["OTHER", " DEVICE-UUID-1234 "],
      });
      expect(out.expected).toEqual({ devices: ["device-uuid-1234", "other"] });
    });

    it("refuses a verdict with no `expected` block when expectedKey was asked for", async () => {
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict: sampleVerdict() }) });
      const err = await rh.verify({ blob: 1 }, { nonce: NONCE, expectedKey: "k-1" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RootHeraldApiError);
      expect((err as RootHeraldApiError).code).toBe("EXPECTED_NOT_ENFORCED");
    });

    it("refuses a verdict that echoes a different expectedKey", async () => {
      const verdict = { ...sampleVerdict(), expected: { key: "k-2" } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const err = await rh.verify({ blob: 1 }, { nonce: NONCE, expectedKey: "k-1" }).catch((e: unknown) => e);
      expect((err as RootHeraldApiError).code).toBe("EXPECTED_NOT_ENFORCED");
    });

    it("refuses a verdict that echoes a different device set", async () => {
      const verdict = { ...sampleVerdict(), expected: { devices: ["device-uuid-1234"] } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const err = await rh
        .verify({ blob: 1 }, { nonce: NONCE, expectedDevices: ["device-uuid-1234", "other"] })
        .catch((e: unknown) => e);
      expect((err as RootHeraldApiError).code).toBe("EXPECTED_NOT_ENFORCED");
    });

    it("refuses a passing verdict naming a device outside expectedDevices, even when echoed", async () => {
      const verdict = { ...sampleVerdict(), expected: { devices: ["other"] } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const err = await rh.verify({ blob: 1 }, { nonce: NONCE, expectedDevices: ["other"] }).catch((e: unknown) => e);
      expect((err as RootHeraldApiError).code).toBe("EXPECTED_NOT_ENFORCED");
    });

    it("returns a failing verdict for another device (expected_device_mismatch) as a normal verdict", async () => {
      const verdict = sampleVerdict();
      verdict.device.verdict = "fail";
      verdict.device.earStatus = "contraindicated";
      Object.assign(verdict, { expected: { devices: ["other"] } });
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      const out = await rh.verify({ blob: 1 }, { nonce: NONCE, expectedDevices: ["other"] });
      expect(out.device.verdict).toBe("fail");
    });

    it("does not compare when the caller passed no expectation", async () => {
      const verdict = { ...sampleVerdict(), expected: { key: "k-9" } };
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, { verdict }) });
      await expect(rh.verify({ blob: 1 }, { nonce: NONCE })).resolves.toBeDefined();
    });
  });
});

describe("issueKeyChallenge", () => {
  it("posts purpose and expectedDevices to /api/v1/keys/challenge and returns the whole response", async () => {
    const fetchMock = mockFetch(200, { ...KEY_CHALLENGE_WIRE, extra: "dropped" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.issueKeyChallenge({ purpose: "sign", expectedDevices: ["alias-1"] });

    expect(out).toEqual(KEY_CHALLENGE_WIRE);
    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/keys/challenge`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual({ purpose: "sign", expectedDevices: ["alias-1"] });
  });

  it("omits expectedDevices when not given", async () => {
    const fetchMock = mockFetch(200, KEY_CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.issueKeyChallenge({ purpose: "sign" });
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual({ purpose: "sign" });
  });

  it("refuses an unknown purpose or an empty expectedDevices before any fetch", async () => {
    const fetchMock = mockFetch(200, KEY_CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const bad = await rh.issueKeyChallenge({ purpose: "wrap" as never }).catch((e: unknown) => e);
    expect((bad as RootHeraldError).code).toBe("INVALID_ARGUMENT");
    const empty = await rh.issueKeyChallenge({ purpose: "sign", expectedDevices: [] }).catch((e: unknown) => e);
    expect((empty as RootHeraldError).code).toBe("INVALID_ARGUMENT");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("rejects a response without the keyChallenge string", async () => {
    const { keyChallenge: _omitted, ...without } = KEY_CHALLENGE_WIRE;
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, without) });
    const err = await rh.issueKeyChallenge({ purpose: "sign" }).catch((e: unknown) => e);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("keeps a 422 key_disclosure_too_low generic, with the code preserved", async () => {
    const rh = new RootHeraldClient({
      secretKey: SK,
      baseUrl: BASE,
      fetch: mockFetch(422, { error: "key_disclosure_too_low", message: "ceiling below pseudonymous" }),
    });
    const err = await rh.issueKeyChallenge({ purpose: "sign" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect(err).not.toBeInstanceOf(UnknownPolicyError);
    expect((err as RootHeraldApiError).errorCode).toBe("key_disclosure_too_low");
  });
});

describe("certifyKey", () => {
  it("posts { nonce, certification } verbatim to /api/v1/keys/certify", async () => {
    const fetchMock = mockFetch(200, CERTIFIED_EC_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const certification = { ...TPM_CERTIFICATION, futureField: { nested: [1] } } as unknown as KeyCertification;
    await rh.certifyKey(NONCE, certification);

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/keys/certify`);
    expect(JSON.parse(init.body)).toEqual({ nonce: NONCE, certification });
  });

  it("parses an EC key, with certifiedAt as a Date", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, CERTIFIED_EC_WIRE) });
    const key = await rh.certifyKey(NONCE, TPM_CERTIFICATION);
    expect(key.deviceId).toBe("alias-1");
    expect(key.keyId).toBe("k-9f3a");
    expect(key.purpose).toBe("sign");
    expect(key.alg).toBe("ES256");
    expect(key.jwk).toEqual({ kty: "EC", crv: "P-256", x: "eHh4", y: "eXl5" });
    expect(key.hardwareBound).toBe(true);
    expect(key.format).toBeUndefined();
    expect(key.certifiedAt).toBeInstanceOf(Date);
    expect(key.certifiedAt.getTime()).toBe(Date.parse("2026-06-30T00:01:00Z"));
  });

  it("parses an RSA key", async () => {
    const wire = { ...CERTIFIED_EC_WIRE, alg: "RS256", jwk: { kty: "RSA", n: "bW9k", e: "AQAB" } };
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, wire) });
    const key = await rh.certifyKey(NONCE, TPM_CERTIFICATION);
    expect(key.alg).toBe("RS256");
    expect(key.jwk).toEqual({ kty: "RSA", n: "bW9k", e: "AQAB" });
  });

  it("parses a decrypt key with its format", async () => {
    const wire = { ...CERTIFIED_EC_WIRE, purpose: "decrypt", alg: "ECDH-ES", format: "jwe" };
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, wire) });
    const key = await rh.certifyKey(NONCE, TPM_CERTIFICATION);
    expect(key.purpose).toBe("decrypt");
    expect(key.alg).toBe("ECDH-ES");
    expect(key.format).toBe("jwe");
  });

  it("relays the macOS and iOS certification forms", async () => {
    const fetchMock = mockFetch(200, { ...CERTIFIED_EC_WIRE, hardwareBound: false });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const mac: KeyCertification = { platform: "macos", publicKey: "cGs", signature: "c2ln" };
    const key = await rh.certifyKey(NONCE, mac);
    expect(key.hardwareBound).toBe(false);
    expect(JSON.parse(calls(fetchMock)[0][1].body).certification).toEqual(mac);
    const ios: KeyCertification = { platform: "ios", keyId: "a2lk", assertion: "YXNu" };
    await rh.certifyKey(NONCE, ios);
    expect(JSON.parse(calls(fetchMock)[1][1].body).certification).toEqual(ios);
  });

  it.each([
    ["missing deviceId", { deviceId: undefined }],
    ["missing keyId", { keyId: "" }],
    ["unknown purpose", { purpose: "wrap" }],
    ["missing hardwareBound", { hardwareBound: undefined }],
    ["garbage certifiedAt", { certifiedAt: "garbage" }],
    ["RSA jwk under ES256", { jwk: { kty: "RSA", n: "bW9k", e: "AQAB" } }],
    ["EC jwk under RS256", { alg: "RS256" }],
    ["P-384 jwk", { jwk: { kty: "EC", crv: "P-384", x: "eA", y: "eQ" } }],
    ["unknown format", { format: "cms" }],
  ])("refuses a malformed certify response (%s) with INVALID_RESPONSE", async (_name, patch) => {
    const wire = { ...CERTIFIED_EC_WIRE, ...patch };
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, wire) });
    const err = await rh.certifyKey(NONCE, TPM_CERTIFICATION).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect((err as RootHeraldApiError).code).toBe("INVALID_RESPONSE");
  });

  it("throws MISSING_NONCE / INVALID_CERTIFICATION before any fetch", async () => {
    const fetchMock = mockFetch(200, CERTIFIED_EC_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const noNonce = await rh.certifyKey("", TPM_CERTIFICATION).catch((e: unknown) => e);
    expect((noNonce as RootHeraldError).code).toBe("MISSING_NONCE");
    const bad = await rh.certifyKey(NONCE, { publicArea: "x" } as never).catch((e: unknown) => e);
    expect((bad as RootHeraldError).code).toBe("INVALID_CERTIFICATION");
    const notObject = await rh.certifyKey(NONCE, "cert" as never).catch((e: unknown) => e);
    expect((notObject as RootHeraldError).code).toBe("INVALID_CERTIFICATION");
    expect(calls(fetchMock).length).toBe(0);
  });

  it("keeps a 409 key_rotation_conflict generic, with the code preserved, not ChallengeError", async () => {
    const rh = new RootHeraldClient({
      secretKey: SK,
      baseUrl: BASE,
      fetch: mockFetch(409, { error: "key_rotation_conflict", message: "rotation in flight" }),
    });
    const err = await rh.certifyKey(NONCE, TPM_CERTIFICATION).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect(err).not.toBeInstanceOf(ChallengeError);
    expect((err as RootHeraldApiError).status).toBe(409);
    expect((err as RootHeraldApiError).errorCode).toBe("key_rotation_conflict");
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
    [400, "wire_version_unsupported", InvalidEvidenceError],
    [400, "invalid_enroll_shape", InvalidEvidenceError],
    [400, "invalid_ask", InvalidAskError],
    [400, "invalid_purpose", InvalidAskError],
    [400, "invalid_certification", InvalidEvidenceError],
    [429, "budget_exhausted", QuotaExceededError],
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

  it("maps invalid_ask to InvalidAskError, not the device-failure class", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(400, { error: "invalid_ask" }) });
    const err = await rh.issueChallenge({ ask: ["key" as never] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidAskError);
    expect(err).not.toBeInstanceOf(InvalidEvidenceError);
  });

  it("maps invalid_purpose from issueKeyChallenge to InvalidAskError, not the device-failure class", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(400, { error: "invalid_purpose" }) });
    const err = await rh.issueKeyChallenge({ purpose: "sign" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidAskError);
    expect(err).not.toBeInstanceOf(InvalidEvidenceError);
    expect((err as RootHeraldApiError).errorCode).toBe("invalid_purpose");
  });

  for (const [status, errorCode] of [
    [422, "certification_rejected"],
    [422, "key_disclosure_too_low"],
    [422, "expected_unknown"],
    [422, "purpose_unsupported"],
    [409, "key_rotation_conflict"],
  ] as const) {
    it(`keeps ${status} ${errorCode} a plain RootHeraldApiError with the code`, async () => {
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(status, { error: errorCode }) });
      const err = await rh.certifyKey(NONCE, { publicArea: "AA==", attest: "AA==", signature: "AA==" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RootHeraldApiError);
      expect(err).not.toBeInstanceOf(UnknownPolicyError);
      expect(err).not.toBeInstanceOf(ChallengeError);
      expect((err as RootHeraldApiError).constructor).toBe(RootHeraldApiError);
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

  it.each(["posture_not_bound", "expected_unknown"])("keeps a 422 %s generic, with the code preserved", async (code) => {
    const fetchMock = mockFetch(422, { error: code, message: "detail" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.issueChallenge({ ask: ["posture"] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
    expect(err).not.toBeInstanceOf(UnknownPolicyError);
    expect((err as RootHeraldApiError).status).toBe(422);
    expect((err as RootHeraldApiError).errorCode).toBe(code);
    expect((err as Error).message).toBe("detail");
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
    const fetchMock = mockFetch(429, {}, { "X-RootHerald-Quota": "budget-exhausted" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).budget).toBeUndefined();
  });

  it("surfaces the refusing budget on a 429 budget_exhausted (#377)", async () => {
    const fetchMock = mockFetch(429, {
      error: "budget_exhausted",
      message: "budget exhausted",
      budget: { id: "bud_1", name: "Production" },
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { nonce: NONCE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as QuotaExceededError).budget).toEqual({ id: "bud_1", name: "Production" });
    expect((err as QuotaExceededError).budget!.name).toBe("Production");
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
  const enrollBlob: EnrollRequestBlob = {
    ekPublicKey: "<base64 TPM2B_PUBLIC>",
    attestationKey: {
      publicArea: "<base64 ak pub area>",
      parentPublicArea: "<base64 parent pub area>",
      qualifiedName: "<base64 name>",
    },
    platform: "windows",
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

  it("relays the enroll body verbatim, unknown fields included", async () => {
    const blob = {
      ekPublicKey: "ZWs=",
      platform: "linux",
      attestationKey: { publicArea: "YWs=", parentPublicArea: "cGE=", qualifiedName: "cW4=", futureSub: true },
      futureField: { nested: [1, { x: "y" }] },
    };
    const fetchMock = mockFetch(201, tpmChallenge);
    await new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock })
      .relayEnroll(blob as unknown as EnrollRequestBlob);
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual(blob);
  });

  it("201 returns the macOS challenge body for the flat enclave body (enrollmentId + challengeNonce)", async () => {
    const macChallenge = { enrollmentId: "enr-uuid-2", challengeNonce: "<base64 nonce>" };
    const fetchMock = mockFetch(201, macChallenge);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const macBlob: EnrollRequestBlob = {
      ekPublicKey: "<base64 P-256>",
      akPublicArea: "<base64 P-256>",
      platform: "macos",
    };
    const out = await rh.relayEnroll(macBlob);
    expect(out).toEqual({ challenge: macChallenge });
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual(macBlob);
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

  it("maps 400 wire_version_unsupported and invalid_enroll_shape to InvalidEvidenceError with the code", async () => {
    for (const code of ["wire_version_unsupported", "invalid_enroll_shape"]) {
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(400, { error: code }) });
      const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(InvalidEvidenceError);
      expect((err as RootHeraldApiError).errorCode).toBe(code);
    }
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

  it.each([
    ["no fields", { platform: "windows" }],
    ["a flat 7.0 TPM body", { ekPublicKey: "e", akPublicArea: "a", platform: "windows" }],
    ["both shapes at once", { ekPublicKey: "e", akPublicArea: "a", attestationKey: { publicArea: "p", parentPublicArea: "q", qualifiedName: "n" }, platform: "linux" }],
    ["an AK without its parent", { ekPublicKey: "e", attestationKey: { publicArea: "p" }, platform: "linux" }],
    ["a macOS body carrying attestationKey", { ekPublicKey: "e", akPublicArea: "a", attestationKey: { publicArea: "p", parentPublicArea: "q", qualifiedName: "n" }, platform: "macos" }],
    ["an iOS blob without its nonce", { platform: "ios", iosKeyId: "k", iosAttestationObject: "a" }],
    ["an unknown platform", { ekPublicKey: "e", akPublicArea: "a", platform: "android" }],
  ])("throws INVALID_ENROLL_BLOB before any fetch for %s", async (_name, blob) => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(blob as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
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

  it("relays the activation body verbatim, unknown fields included", async () => {
    const blob = { ...activateBlob, futureField: { nested: true } };
    const fetchMock = mockFetch(200, { deviceId: "dev-uuid-1" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await rh.relayActivate(blob);
    expect(JSON.parse(calls(fetchMock)[0][1].body)).toEqual(blob);
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

describe("mobile bridge helpers are gone", () => {
  it("has no verifyMobileEvidence or relayMobileEnrollment", () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    expect("verifyMobileEvidence" in rh).toBe(false);
    expect("relayMobileEnrollment" in rh).toBe(false);
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
