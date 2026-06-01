# @rootherald/* — JavaScript / TypeScript SDKs

The Root Herald SDK family for JavaScript and TypeScript. Multiple packages, one repo, shared types, coordinated releases.

## Packages

| Package | What it does | Where it runs |
|---|---|---|
| [`@rootherald/node`](./packages/node) | Verify attestation JWTs against the Root Herald JWKS, parse CAEP webhooks, talk to SSF streams | Node.js backends |
| [`@rootherald/js`](./packages/js) | Drive the device attestation ceremony from a web page (talks to the Root Herald browser extension) | Browsers |
| [`@rootherald/react`](./packages/react) | React adapter — `RootHeraldProvider`, `useAttestation()`, `RequireAttestation` | React apps |
| [`@rootherald/vue`](./packages/vue) | Vue 3 adapter — `createRootHerald()` plugin + `useAttestation()` composable | Vue apps |
| [`@rootherald/angular`](./packages/angular) | Angular adapter — `provideRootHerald()` + injectable `RootHeraldService` (signal-based) | Angular 17+ apps |
| [`@rootherald/react-native`](./packages/react-native) | React Native bindings to the iOS / Android native client SDKs | RN mobile apps |
| [`@rootherald/contracts`](./packages/contracts) | Shared TypeScript types (AcrUrn, AttestationVerdict, etc.). Internal dependency of all the others. | Internal |

## Install

```bash
# Backend verifying tokens
npm i @rootherald/node

# Frontend driving the ceremony
npm i @rootherald/js                       # vanilla
npm i @rootherald/react @rootherald/js     # React
npm i @rootherald/vue @rootherald/js       # Vue 3
npm i @rootherald/angular @rootherald/js   # Angular 17+

# Mobile
npm i @rootherald/react-native
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
