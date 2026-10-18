import { describe, expect, it } from "vitest";
import { EK_CHAIN_FAILURE_KINDS } from "@rootherald/contracts/server";
import {
  type OpenApiDocument,
  readChainFailureEnum,
  readEnrollRefusalSchema,
  readOpenApiFixture,
  resolveRef,
} from "./enroll-refusal-schema.js";

function enrollDocument(refusal: object, schemasAtRoot: boolean): OpenApiDocument {
  const responses = {
    "400": { content: { "application/json": { schema: { $ref: "#/components/schemas/EnrollmentRefusal" } } } },
  };
  const schemas = { EnrollmentRefusal: refusal, Kind: { type: "string", enum: ["a", "b"] } };
  const doc: OpenApiDocument = { paths: { "/api/v1/attest/enroll": { post: { responses } } } };
  if (schemasAtRoot) {
    doc.schemas = schemas;
  } else {
    doc.components = { schemas };
  }
  return doc;
}

describe("enroll refusal schema reader", () => {
  it.each([
    ["at the root", true],
    ["under components", false],
  ])("reaches the chainFailure enum through refs with schemas %s", (_layout, schemasAtRoot) => {
    const refusal = { properties: { chainFailure: { $ref: "#/components/schemas/Kind" } } };
    expect(readChainFailureEnum(enrollDocument(refusal, schemasAtRoot))).toEqual(["a", "b"]);
  });

  it("throws on a ref that names no schema", () => {
    const refusal = { properties: { chainFailure: { $ref: "#/components/schemas/Missing" } } };
    expect(() => readChainFailureEnum(enrollDocument(refusal, true))).toThrow(/unresolved/);
  });

  it("throws when the enroll path publishes no 400 schema", () => {
    const doc: OpenApiDocument = { paths: { "/api/v1/attest/enroll": { post: { responses: {} } } } };
    expect(() => readEnrollRefusalSchema(doc)).toThrow(/enroll 400/);
  });
});

describe("EK chain failure contract", () => {
  const doc = readOpenApiFixture();

  it("publishes a non-empty string enum on the enroll 400's chainFailure", () => {
    const published = readChainFailureEnum(doc);
    expect(published, "enroll 400 chainFailure carries an enum").toBeInstanceOf(Array);
    expect(published?.length).toBeGreaterThan(0);
    for (const kind of published ?? []) {
      expect(typeof kind).toBe("string");
    }
  });

  it("lists exactly the platform's kinds in EK_CHAIN_FAILURE_KINDS, with no duplicates", () => {
    const published = [...(readChainFailureEnum(doc) ?? [])].sort();
    expect(published.length).toBeGreaterThan(0);
    expect(EK_CHAIN_FAILURE_KINDS, "@rootherald/contracts/server exports EK_CHAIN_FAILURE_KINDS").toBeInstanceOf(Array);
    expect(new Set(EK_CHAIN_FAILURE_KINDS).size).toBe(EK_CHAIN_FAILURE_KINDS.length);
    expect([...EK_CHAIN_FAILURE_KINDS].sort()).toEqual(published);
  });

  it("publishes policyCanAdmit as a boolean beside chainFailure", () => {
    const policyCanAdmit = readEnrollRefusalSchema(doc).properties?.policyCanAdmit;
    expect(policyCanAdmit, "enroll 400 schema has policyCanAdmit").toBeDefined();
    expect(resolveRef(doc, policyCanAdmit ?? {}).type).toBe("boolean");
  });
});
