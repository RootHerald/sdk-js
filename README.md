# @rootherald/* — JavaScript / TypeScript SDKs

The Root Herald SDK family for JavaScript and TypeScript. Multiple packages, one repo, shared types, coordinated releases.

## Packages

These three packages are published and maintained:

| Package | What it does | Where it runs |
|---|---|---|
| [`@rootherald/contracts`](./packages/contracts) | **Shared** contract / type layer (EAT claims, wire shapes, error classes) used by both the client and the server SDK. Also exposes server-context errors at `@rootherald/contracts/server`. | Shared (client + server) |
| [`@rootherald/browser`](./packages/browser) | **Client**: collects an opaque device-evidence blob (and runs cold-start client detection) via the Root Herald browser extension. Keyless — no `rh_sk_` secret, no verdict. | Browsers / page code |
| [`@rootherald/node`](./packages/node) | **Server**: verify attestation JWTs against the Root Herald JWKS and run the server→server Background-Check (`rh_sk_` secret + verdict live here). | Node.js backends |

The browser package only **collects** evidence; **verification and the `rh_sk_`
secret live exclusively in a server SDK** (`@rootherald/node`, and the other
server SDKs at [github.com/RootHerald](https://github.com/RootHerald)).

### Deferred

`@rootherald/js` (vanilla) and the `@rootherald/react` / `@rootherald/vue` /
`@rootherald/angular` / `@rootherald/react-native` adapters are **deferred**
while the core API stabilizes — they live under
[`packages-deferred/`](./packages-deferred) and are not published yet.

## Install

```bash
# Server: verify tokens / run Background-Check
npm i @rootherald/node

# Client: collect device evidence from a web page
npm i @rootherald/browser
```

Each package's README has a 30-second integration example.

## Develop

```bash
pnpm install
pnpm build      # builds all packages in dependency order
pnpm test       # runs vitest across the workspace
pnpm typecheck  # tsc --noEmit across the workspace
```

## Releases

Each package versions independently via Changesets (or per-package tags). Releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) — the GitHub Actions workflow OIDCs to npm, no `NPM_TOKEN` stored. Published packages carry [Sigstore provenance attestations](https://blog.sigstore.dev/npm-provenance-ga/) you can verify with `npm view <pkg> --json | jq .attestations`.

## License

MIT. See [LICENSE](./LICENSE).

Root Herald and the Root Herald logo are trademarks — see [NOTICE](./NOTICE).
