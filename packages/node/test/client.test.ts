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
