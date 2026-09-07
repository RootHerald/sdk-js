import { describe, it, expect, vi } from "vitest";
import { RootHeraldClient } from "../src/client.js";
import {
  AdmissionRefusedError,
  ChallengeError,
  InvalidEvidenceError,
  InvalidSecretKeyError,
  PolicyDowngradeError,
  QuotaExceededError,
  RootHeraldApiError,
  UnknownPolicyError,
} from "@rootherald/contracts/server";
import { RootHeraldError } from "@rootherald/contracts";
import type { AttestationVerdict } from "@rootherald/contracts";

const SK = "rh_sk_test_abc123";
const BASE = "https://api.example.test";

const CHALLENGE_WIRE = {
  challengeId: "chal-1",
  nonce: "bm9uY2U=",
  expiresAt: "2026-01-01T00:00:00Z",
  challenge: "rhc1.bm9uY2U.eyJhc2siOlsiaWRlbnRpdHkiLCJwb3N0dXJlIl19",
};

/** Builds a fetch mock that returns the given status/json for the next call. */
function mockFetch(status: number, json: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(json), {
      status,
      headers: { "Content-Type": "application/json" },
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

  it("sends ask, policy and keyPurpose", async () => {
    const fetchMock = mockFetch(200, CHALLENGE_WIRE);
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.issueChallenge({
      ask: ["identity", "key"],
      policy: "rootherald:builtin:strict-hardware",
      keyPurpose: "sign",
    });

    const [, init] = calls(fetchMock)[0];
    expect(JSON.parse(init.body)).toEqual({
      ask: ["identity", "key"],
      policy: "rootherald:builtin:strict-hardware",
      keyPurpose: "sign",
    });
  });

  it("returns the challenge string verbatim", async () => {
    const fetchMock = mockFetch(200, { ...CHALLENGE_WIRE, challenge: "rhc1.abc.def" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.issueChallenge({ ask: ["posture"] });
    expect(out.challenge).toBe("rhc1.abc.def");
  });

  it("rejects a response without the challenge string", async () => {
    const { challenge: _omitted, ...withoutChallenge } = CHALLENGE_WIRE;
    const fetchMock = mockFetch(200, withoutChallenge);
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
    await rh.verify(evidence, { challengeId: "chal-1", policy: "rootherald:builtin:strict" });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/verify`);
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    const body = JSON.parse(init.body);
    expect(body.challengeId).toBe("chal-1");
    expect(body.policy).toBe("rootherald:builtin:strict");
    expect(body.evidence).toEqual(evidence); // verbatim pass-through
  });

  it("returns the parsed verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const verdict = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
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

    const verdict = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
    expect(verdict.device.verdict).toBe("fail");
  });

  it("throws when challengeId is missing", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    // @ts-expect-error intentionally omitting challengeId
    await expect(rh.verify({ blob: 1 }, {})).rejects.toThrow(RootHeraldError);
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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.authTime).toBeInstanceOf(Date);
    expect(out.authTime.getTime()).toBe(epochMs);
    expect(out.expiresAt.getTime()).toBe(epochMs);
  });

  it("leaves cohort fields absent when the server omits them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.device.cohortKey).toBeUndefined();
    expect(out.device.cohortPrevalence).toBeUndefined();
    expect(out.device.novelProfile).toBeUndefined();
  });

  it("sends requestedDisclosureClass in the body when supplied", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.verify(
      { blob: 1 },
      { challengeId: "chal-1", requestedDisclosureClass: "pseudonymous" },
    );

    const [, init] = calls(fetchMock)[0];
    expect(JSON.parse(init.body).requestedDisclosureClass).toBe("pseudonymous");
  });

  it("omits requestedDisclosureClass from the body when not supplied", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

    expect(out.assuranceClaimsMet).toEqual(["root-claim"]);
    expect(out.enrollmentRequired).toBe(true);
    // The root sent no key, so there is none — the nested decoy is not it.
    expect(out.key).toBeUndefined();
  });

  it("omits assuranceClaimsMet + enrollmentRequired + key when the root does not send them", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict() });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });

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

    const out = await rh.verify({ blob: 1 }, { challengeId: "chal-1" });
    expect(out.key).toBeUndefined();
  });
});

describe("error mapping", () => {
  const cases: Array<[number, string, new (...args: never[]) => RootHeraldApiError]> = [
    [401, "invalid_secret_key", InvalidSecretKeyError],
    [422, "unknown_policy", UnknownPolicyError],
    [422, "admission_refused", AdmissionRefusedError],
    [422, "policy_downgrade", PolicyDowngradeError],
    [409, "challenge_expired_or_used", ChallengeError],
    [400, "invalid_evidence", InvalidEvidenceError],
    [429, "quota_exceeded", QuotaExceededError],
  ];

  for (const [status, errorCode, ErrClass] of cases) {
    it(`maps ${status} ${errorCode} to ${ErrClass.name}`, async () => {
      const fetchMock = mockFetch(status, { error: errorCode });
      const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

      const err = await rh
        .verify({ blob: 1 }, { challengeId: "chal-1" })
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
    const err = await rh.verify({ blob: 1 }, { challengeId: "chal-1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownPolicyError);
  });

  it("carries the server's detail as the message on admission_refused", async () => {
    const fetchMock = mockFetch(422, {
      error: "admission_refused",
      detail: "firmware TPM cannot satisfy discrete-TPM-only policy",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.verify({ blob: 1 }, { challengeId: "chal-1" }).catch((e: unknown) => e);
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
  };

  it("201 returns the full challenge + deviceId", async () => {
    const fetchMock = mockFetch(201, {
      deviceId: "dev-uuid-1",
      credentialBlob: "<base64 id-object>",
      encryptedSecret: "<base64 secret>",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    const out = await rh.relayEnroll(enrollBlob);

    expect(out.deviceId).toBe("dev-uuid-1");
    expect(out.challenge).toEqual({
      deviceId: "dev-uuid-1",
      credentialBlob: "<base64 id-object>",
      encryptedSecret: "<base64 secret>",
    });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/enroll`);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${SK}`);
    expect(JSON.parse(init.body)).toEqual(enrollBlob); // relayed verbatim
  });

  it("appends ?challengeId= when given, leaving the body untouched", async () => {
    const fetchMock = mockFetch(201, {
      deviceId: "dev-uuid-1",
      credentialBlob: "<base64 id-object>",
      encryptedSecret: "<base64 secret>",
    });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });

    await rh.relayEnroll(enrollBlob, { challengeId: "chal 1/&" });

    const [url, init] = calls(fetchMock)[0];
    expect(url).toBe(`${BASE}/api/v1/attest/enroll?challengeId=chal%201%2F%26`);
    expect(JSON.parse(init.body)).toEqual(enrollBlob);
  });

  it("rejects an empty challengeId before any fetch", async () => {
    const fetchMock = mockFetch(201, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    await expect(rh.relayEnroll(enrollBlob, { challengeId: "" })).rejects.toThrow(RootHeraldError);
    expect(calls(fetchMock).length).toBe(0);
  });

  it("maps 422 admission_refused to AdmissionRefusedError", async () => {
    const fetchMock = mockFetch(422, { error: "admission_refused", detail: "firmware TPM" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob, { challengeId: "chal-1" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdmissionRefusedError);
    expect((err as RootHeraldApiError).errorCode).toBe("admission_refused");
  });

  it("throws INVALID_RESPONSE when a 201 is missing credential material", async () => {
    const fetchMock = mockFetch(201, { deviceId: "dev-1" }); // no credentialBlob/encryptedSecret
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayEnroll(enrollBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldApiError);
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
});

describe("relayActivate", () => {
  const activateBlob = {
    deviceId: "dev-uuid-1",
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

  it("returns just deviceId when the server omits status/enrolledAt", async () => {
    const fetchMock = mockFetch(200, { deviceId: "dev-uuid-2" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const out = await rh.relayActivate({ ...activateBlob, deviceId: "dev-uuid-2" });
    expect(out).toEqual({ deviceId: "dev-uuid-2" });
  });

  it("throws before any fetch when the activation blob is malformed", async () => {
    const fetchMock = mockFetch(200, {});
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    // @ts-expect-error intentionally missing decryptedSecret
    await expect(rh.relayActivate({ deviceId: "d" })).rejects.toThrow(RootHeraldError);
    expect(calls(fetchMock).length).toBe(0);
  });

  it("maps a 409 challenge error from activate to ChallengeError", async () => {
    const fetchMock = mockFetch(409, { error: "challenge_expired_or_used" });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const err = await rh.relayActivate(activateBlob).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChallengeError);
  });
});

describe("verifyMobileEvidence (mobile bridge)", () => {
  const appVerifyBody = {
    challengeId: "chal-1",
    evidence: { iosAttestation: { attestationObject: "b64cbor", keyId: "b64key" } },
  };

  it("brokers verify() and returns the verdict", async () => {
    const fetchMock = mockFetch(200, { verdict: sampleVerdict(), assuranceClaimsMet: ["real-device"] });
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: fetchMock });
    const result = await rh.verifyMobileEvidence(appVerifyBody);
    expect(result.device.verdict).toBe("pass");
    const [, init] = calls(fetchMock)[0];
    const sent = JSON.parse(init.body);
    expect(sent.challengeId).toBe("chal-1");
    expect(sent.evidence.iosAttestation.keyId).toBe("b64key");
  });

  it("rejects a body missing challengeId", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const err = await rh.verifyMobileEvidence({ ...appVerifyBody, challengeId: "" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RootHeraldError);
  });

  it("rejects a body missing iosAttestation fields", async () => {
    const rh = new RootHeraldClient({ secretKey: SK, baseUrl: BASE, fetch: mockFetch(200, {}) });
    const bad = { challengeId: "c", evidence: { iosAttestation: { attestationObject: "x" } } } as never;
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
