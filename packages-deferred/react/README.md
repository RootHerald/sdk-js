# @rootherald/react

React adapter for [RootHerald](https://rootherald.io) device attestation.

## Install

```bash
pnpm add @rootherald/react @rootherald/js
```

## Usage

```tsx
import { RootHeraldProvider, useAttestation, RequireAttestation } from '@rootherald/react';

function App() {
  return (
    <RootHeraldProvider
      issuer="https://rootherald.example.com"
      clientId="your-client-id"
      redirectUri={window.location.origin + '/callback'}
    >
      <Home />
    </RootHeraldProvider>
  );
}

function Home() {
  const { verdict, isAuthenticated, login, logout } = useAttestation();
  if (!isAuthenticated) return <button onClick={() => login()}>Verify my device</button>;
  return (
    <div>
      <p>Device trust: {verdict.assuranceLevel}</p>
      <RequireAttestation minLevel="high" maxAgeSeconds={300}>
        <SensitiveFeature />
      </RequireAttestation>
      <button onClick={() => logout()}>Sign out</button>
    </div>
  );
}
```

## API

### `<RootHeraldProvider>`

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `issuer` | `string` | yes |  Root Herald issuer URL |
| `clientId` | `string` | yes | Relying party client ID |
| `redirectUri` | `string` | yes | OAuth redirect URI |
| `scope` | `string` | no | OAuth scopes (default: `openid attestation`) |
| `cacheLocation` | `"memory" \| "localStorage" \| "sessionStorage"` | no | Token storage (default: `memory`) |

### `useAttestation()`

Returns `{ verdict, isLoading, isAuthenticated, error, login, logout }`.

### `<RequireAttestation>`

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `minLevel` | `"high" \| "reduced" \| "unverified"` | `"high"` | Minimum assurance level |
| `maxAgeSeconds` | `number` | — | Reject attestations older than this |
| `fallback` | `ReactNode` | default UI | Shown when requirements not met |
