# @rootherald/js

Framework-agnostic browser SDK for  Root Herald device attestation — handles PKCE, JWT verification, and the `AttestationVerdict` lifecycle.

## Install

```bash
pnpm add @rootherald/js
```

## Usage

```ts
import { createClient } from '@rootherald/js';

const client = await createClient({
  issuer: 'https://rootherald.example.com',
  clientId: 'your-client-id',
  redirectUri: 'https://your-app.example.com/callback',
});

// On your login page
await client.loginWithRedirect();

// On your /callback page
const verdict = await client.handleRedirectCallback();
console.log(verdict.assuranceLevel); // "high" | "reduced" | "unverified"

// On any protected page
const verified = await client.isVerified({ minLevel: 'high' });
```

## Full API

See [`docs/architecture/contracts/sdk-api.md`](../../../../docs/architecture/contracts/sdk-api.md) for the complete interface specification.
