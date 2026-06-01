# @rootherald/proxy-reference

Reference Node proxy middleware for the Root Herald proxy transport mode.
The middleware forwards `<mount>/api/v1/*` to `<upstream>/api/v1/*`,
injecting the tenant API key as `Authorization: Bearer` and (optionally)
producing the `X-RootHerald-Client-Hint` envelope.

## Express

```js
import express from "express";
import { createRootHeraldProxy } from "@rootherald/proxy-reference";

const app = express();
app.use(
  "/rh-proxy",
  createRootHeraldProxy({
    apiKey: process.env.ROOTHERALD_API_KEY,
    upstream: "https://rootherald.io",
  }),
);
app.listen(3000);
```

## Next.js (Route Handler, App Router)

```ts
// app/rh-proxy/[...path]/route.ts
import { createRootHeraldProxy } from "@rootherald/proxy-reference";
import { IncomingMessage, ServerResponse } from "node:http";

export const dynamic = "force-dynamic";

const proxy = createRootHeraldProxy({
  apiKey: process.env.ROOTHERALD_API_KEY!,
  upstream: "https://rootherald.io",
});

async function handler(req: Request): Promise<Response> {
  // Bridge Fetch Request → Node IncomingMessage / ServerResponse using a
  // small adapter (see Next.js docs for "Node-style proxying").
  // ...
}

export { handler as GET, handler as POST };
```

## Fastify (via `@fastify/express`)

```js
import Fastify from "fastify";
import express from "@fastify/express";
import { createRootHeraldProxy } from "@rootherald/proxy-reference";

const app = Fastify();
await app.register(express);
app.use("/rh-proxy", createRootHeraldProxy({ apiKey: process.env.ROOTHERALD_API_KEY }));
await app.listen({ port: 3000 });
```

## What gets forwarded

* Body, method, query string — passthrough.
* Headers — passthrough, except `Authorization`, `Host`, `Content-Length`,
  `Connection`, and HTTP/2 pseudo-headers, which are stripped or
  recomputed.
* `Authorization: Bearer <apiKey>` is injected on the upstream call.
* `X-Forwarded-For` is augmented with the immediate client IP.
* `X-RootHerald-Client-Hint` is built when `forwardClientHint` is true
  (default). The envelope is signed with HMAC-SHA256 using the API key
  as the secret.
