import { readFileSync } from "node:fs";

// The platform's OpenAPI snapshot at the commit named in openapi.public.source;
// refresh-openapi.mjs writes both.
const FIXTURE_URL = new URL("./fixtures/openapi.public.json", import.meta.url);

export interface Schema {
  $ref?: string;
  type?: string;
  enum?: unknown[];
  properties?: Record<string, Schema>;
}

interface Operation {
  responses?: Record<string, { content?: Record<string, { schema?: Schema }> }>;
}

export interface OpenApiDocument {
  paths: Record<string, Record<string, Operation>>;
  schemas?: Record<string, Schema>;
  components?: { schemas?: Record<string, Schema> };
}

export function readOpenApiFixture(): OpenApiDocument {
  return JSON.parse(readFileSync(FIXTURE_URL, "utf8")) as OpenApiDocument;
}

// The platform snapshot keeps its schemas at the root but writes refs as
// "#/components/schemas/<Name>"; a standard document keeps them under
// components. Either layout resolves.
export function resolveRef(doc: OpenApiDocument, schema: Schema): Schema {
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

export function readEnrollRefusalSchema(doc: OpenApiDocument): Schema {
  const responses = doc.paths["/api/v1/attest/enroll"]?.post?.responses;
  const schema = responses?.["400"]?.content?.["application/json"]?.schema;
  if (schema === undefined) {
    throw new Error("enroll 400 publishes no application/json schema");
  }
  return resolveRef(doc, schema);
}

export function readChainFailureEnum(doc: OpenApiDocument): unknown[] | undefined {
  const chainFailure = readEnrollRefusalSchema(doc).properties?.chainFailure;
  if (chainFailure === undefined) {
    return undefined;
  }
  return resolveRef(doc, chainFailure).enum;
}
