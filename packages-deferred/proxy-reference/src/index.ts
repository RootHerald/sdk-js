// Reference Express / Connect-compatible proxy middleware for Root Herald.
//
// Mounts under any path; forwards <mount>/api/v1/* to <upstream>/api/v1/*
// with the tenant API key injected as Authorization: Bearer. Optionally
// emits the X-RootHerald-Client-Hint envelope, signed with HMAC-SHA256
// using the API key as the secret.
//
// The middleware has no hard runtime dependencies — it works with the
// stock node `fetch`. The Express `IncomingMessage` / `ServerResponse`
// shape is compatible with Connect, Next.js Route Handlers (via
// adapters), and Fastify (via `fastify-express`).

import { createHmac } from "node:crypto";
import { IncomingMessage, ServerResponse } from "node:http";

export interface RootHeraldProxyOptions {
  /** Tenant API key. Required. Injected as Authorization: Bearer upstream. */
  apiKey: string;
  /** Upstream Root Herald base URL. Defaults to https://rootherald.io. */
  upstream?: string;
  /** Build & forward the X-RootHerald-Client-Hint envelope. Default true. */
  forwardClientHint?: boolean;
  /** Per-request timeout in ms. Default 10000. */
  timeoutMs?: number;
  /** Optional logger; defaults to a no-op. */
  logger?: { warn: (...a: unknown[]) => void; info?: (...a: unknown[]) => void };
}

/**
 * Build the client-hint envelope payload. Exported for use in tests and in
 * custom routers that don't want the full middleware.
 */
export function buildClientHint(ip: string, apiKey: string): string {
  const ipClass = ip.includes(":") ? ip : ipv4Prefix(ip, 24);
  const asnBucket = `asn-bucket-${hash8(ip)}`;
  const geoBucket = "unknown";
  const signedAt = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    ip_class: ipClass,
    asn_bucket: asnBucket,
    geo_bucket: geoBucket,
    signed_at: signedAt,
  });
  const sig = createHmac("sha256", apiKey).update(payload).digest("base64");
  return `v1.${Buffer.from(payload, "utf-8").toString("base64")}.${sig}`;
}

function ipv4Prefix(ip: string, prefixBits: number): string {
  const parts = ip.split(".");
  if (parts.length !== 4) return ip;
  const keep = Math.floor(prefixBits / 8);
  for (let i = keep; i < 4; i++) parts[i] = "0";
  return `${parts.join(".")}/${prefixBits}`;
}

function hash8(s: string): string {
  return createHmac("sha256", "rh-asn-bucket")
    .update(s)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Create an Express/Connect-style middleware that forwards Root Herald
 * traffic upstream. Mount at any path prefix:
 *
 *     app.use("/rh-proxy", createRootHeraldProxy({ apiKey, upstream }));
 */
export function createRootHeraldProxy(options: RootHeraldProxyOptions) {
  if (!options?.apiKey) throw new TypeError("apiKey is required");
  const upstream = (options.upstream ?? "https://rootherald.io").replace(/\/$/, "");
  const forwardHint = options.forwardClientHint ?? true;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const logger = options.logger ?? { warn: () => {} };

  return async function rootHeraldProxy(
    req: IncomingMessage & { url: string; originalUrl?: string; baseUrl?: string; ip?: string },
    res: ServerResponse,
    next?: (err?: unknown) => void,
  ): Promise<void> {
    try {
      // Express strips `baseUrl` when mounting; use `originalUrl` if
      // present, else `url`. The forwarded path is everything after the
      // proxy's mount point.
      const incoming = req.originalUrl ?? req.url;
      const baseUrl = req.baseUrl ?? "";
      const forwardPath = incoming.startsWith(baseUrl)
        ? incoming.slice(baseUrl.length) || "/"
        : incoming;

      const upstreamUrl = `${upstream}${forwardPath}`;

      const headers: Record<string, string> = {
        authorization: `Bearer ${options.apiKey}`,
        "user-agent": "RootHerald-Proxy-Node/1.0",
      };

      for (const [name, value] of Object.entries(req.headers ?? {})) {
        if (!value || !shouldForwardHeader(name)) continue;
        headers[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : String(value);
      }

      const ip = req.ip ?? extractIp(req) ?? "0.0.0.0";
      if (forwardHint) {
        headers["x-rootherald-client-hint"] = buildClientHint(ip, options.apiKey);
      }
      headers["x-forwarded-for"] = ip;

      let body: Buffer | undefined;
      if (req.method && hasBody(req.method)) {
        body = await readBody(req);
      }

      const ac = new AbortController();
      const tid = setTimeout(() => ac.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetch(upstreamUrl, {
          method: req.method,
          headers,
          body,
          signal: ac.signal,
        });
      } catch (err) {
        clearTimeout(tid);
        logger.warn("Root Herald upstream call failed", err);
        res.statusCode = 502;
        res.end("Bad Gateway");
        return;
      }
      clearTimeout(tid);

      res.statusCode = response.status;
      response.headers.forEach((v, k) => {
        if (k.toLowerCase() === "transfer-encoding") return;
        res.setHeader(k, v);
      });
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (err) {
      if (next) next(err);
      else {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  };
}

function shouldForwardHeader(name: string): boolean {
  const n = name.toLowerCase();
  if (n === "authorization") return false;       // overridden
  if (n === "host") return false;
  if (n === "content-length") return false;       // recomputed
  if (n === "connection") return false;
  if (n.startsWith(":")) return false;            // HTTP/2 pseudo-headers
  return true;
}

function hasBody(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function extractIp(req: IncomingMessage): string | undefined {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress ?? undefined;
}
