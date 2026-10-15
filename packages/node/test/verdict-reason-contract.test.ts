import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERDICT_REASON_CODES } from "@rootherald/contracts";

// The platform's OpenAPI snapshot at the commit named in openapi.public.source;
// refresh-openapi.mjs writes both.
const FIXTURE_URL = new URL("./fixtures/openapi.public.json", import.meta.url);

interface Schema {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
}

interface OpenApiDocument {
  paths: Record<string, Record<string, unknown>>;
  schemas?: Record<string, Schema>;
  components?: { schemas?: Record<string, Schema> };
}

// The snapshot keeps its schemas at the root; a live document keeps them under
// components. Both write refs as "#/components/schemas/<Name>".
function resolveRef(doc: OpenApiDocument, schema: Schema): Schema {
  if (schema.$ref === undefined) {
    return schema;
  }
  const name = schema.$ref.split("/").pop() as string;
  const resolved = doc.schemas?.[name] ?? doc.components?.schemas?.[name];
  if (resolved === undefined) {
    throw new Error(`unresolved $ref ${schema.$ref}`);
  }
  return resolved;
}

function readVerifyResponseSchema(doc: OpenApiDocument): Schema {
  const post = doc.paths["/api/v1/attest/verify"]?.post as
    | { responses?: Record<string, { content?: Record<string, { schema?: Schema }> }> }
    | undefined;
  const schema = post?.responses?.["200"]?.content?.["application/json"]?.schema;
  if (schema === undefined) {
    throw new Error("verify 200 publishes no application/json schema");
  }
  return resolveRef(doc, schema);
}

function readVerdictSchema(doc: OpenApiDocument): Schema {
  const verdict = readVerifyResponseSchema(doc).properties?.verdict;
  if (verdict === undefined) {
    throw new Error("verify response schema has no verdict property");
  }
  return resolveRef(doc, verdict);
}

function readReasonSchema(doc: OpenApiDocument): Schema {
  const reason = readVerdictSchema(doc).properties?.reason;
  if (reason === undefined) {
    throw new Error("verdict schema has no reason property");
  }
  return resolveRef(doc, reason);
}

describe("verdict reason contract", () => {
  const doc = JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as OpenApiDocument;

  it("publishes a non-empty enum on verdict.reason.code", () => {
    const code = resolveRef(doc, readReasonSchema(doc).properties?.code ?? {});
    expect(code.enum, "verdict.reason.code carries an enum").toBeInstanceOf(Array);
    expect(code.enum?.length).toBeGreaterThan(0);
  });

  it("lists exactly the platform's codes in VERDICT_REASON_CODES, with no duplicates", () => {
    const code = resolveRef(doc, readReasonSchema(doc).properties?.code ?? {});
    const published = [...(code.enum ?? [])].sort();
    expect(published.length).toBeGreaterThan(0);
    expect(VERDICT_REASON_CODES, "@rootherald/contracts exports VERDICT_REASON_CODES").toBeInstanceOf(Array);
    expect(new Set(VERDICT_REASON_CODES).size).toBe(VERDICT_REASON_CODES.length);
    expect([...VERDICT_REASON_CODES].sort()).toEqual(published);
  });

  it("shapes the reason as code and text, optional on the verdict", () => {
    const reason = readReasonSchema(doc);
    expect(Object.keys(reason.properties ?? {}).sort()).toEqual(["code", "text"]);
    expect(readVerdictSchema(doc).required ?? []).not.toContain("reason");
  });
});

describe("resolveRef", () => {
  const ref: Schema = { $ref: "#/components/schemas/VerdictReasonDto" };
  const target: Schema = { type: "object", properties: { code: { type: "string" } } };

  it("finds a schema at the root, as the snapshot keeps it", () => {
    const doc: OpenApiDocument = { paths: {}, schemas: { VerdictReasonDto: target } };
    expect(resolveRef(doc, ref)).toBe(target);
  });

  it("finds a schema under components, as a live document keeps it", () => {
    const doc: OpenApiDocument = { paths: {}, components: { schemas: { VerdictReasonDto: target } } };
    expect(resolveRef(doc, ref)).toBe(target);
  });

  it("throws on a ref neither place holds", () => {
    const doc: OpenApiDocument = { paths: {}, schemas: {}, components: { schemas: {} } };
    expect(() => resolveRef(doc, ref)).toThrow(/unresolved/);
  });
});
