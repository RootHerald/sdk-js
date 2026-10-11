# @rootherald/* — JavaScript / TypeScript SDKs

The Root Herald SDK family for JavaScript and TypeScript: several packages in one repo, with shared types and coordinated releases.

## Packages

These three packages are maintained; `contracts` and `node` are published to npm:

| Package | What it does | Where it runs |
|---|---|---|
| [`@rootherald/contracts`](./packages/contracts) | **Shared** contract / type layer (EAT claims, wire shapes, error classes) used by both the client and the server SDK. Also exposes server-context errors at `@rootherald/contracts/server`. | Shared (client + server) |
| [`@rootherald/browser`](./packages/browser) | **Client**: enrolls, attests and mints keys through the Root Herald browser extension and native host. Keyless — no `rh_sk_` secret, no verdict. Reference and test tool; not published to npm. | Browsers / page code |
| [`@rootherald/node`](./packages/node) | **Server**: run the server→server Background-Check (`rh_sk_` secret + verdict live here). | Node.js backends |

The browser package only drives the device; **verification and the `rh_sk_`
secret live exclusively in a server SDK** (`@rootherald/node`, and the other
server SDKs at [github.com/RootHerald](https://github.com/RootHerald)).

### Deferred

Framework adapters (`@rootherald/react`, `/vue`, `/angular`, `/react-native`)
are **not shipping**. Earlier drafts lived in this repo under
`packages-deferred/` and were removed — they are recoverable from git history if
one is picked up. This repo contains only what is published or about to be:
`@rootherald/node`, `@rootherald/contracts`, `@rootherald/browser`.

## Install

```bash
# Server: run the Background-Check
npm i @rootherald/node

# Client: a native app on the C SDK (sdk-windows / sdk-linux / sdk-macos)
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

Every package carries the same version; a `v*` tag publishes `contracts`, then `node` (`browser` is skipped until it is bootstrapped on npm). Releases use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): the GitHub Actions workflow OIDCs to npm, with no `NPM_TOKEN` stored. Published packages carry [Sigstore provenance attestations](https://blog.sigstore.dev/npm-provenance-ga/) you can verify with `npm view <pkg> --json | jq .attestations`.

## License

MIT. See [LICENSE](./LICENSE).

Root Herald and the Root Herald logo are trademarks; see [NOTICE](./NOTICE).
