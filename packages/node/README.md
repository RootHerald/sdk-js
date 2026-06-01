# @rootherald/node

Server-side SDK for  Root Herald device attestation.

## Install

```
pnpm add @rootherald/node
```

## Verify attestation JWTs on every request

```ts
import express from 'express';
import { requireAttestation } from '@rootherald/node';
import type { AttestationVerdict } from '@rootherald/node';

// Extend Express Request so req.attestation is typed (add this once in a .d.ts file):
declare global {
  namespace Express {
    interface Request {
      attestation?: AttestationVerdict;
    }
  }
}

const app = express();

// Gate sensitive endpoints behind a fresh, high-assurance attestation
app.post('/api/export', requireAttestation({
  issuer: 'https://rootherald.example.com',
  audience: 'your-client-id',
  minLevel: 'high',
  maxAgeSeconds: 300,
}), (req, res) => {
  // req.attestation is typed, verified, and guaranteed fresh
  res.json({ device: req.attestation!.deviceId });
});
```

## Receive CAEP webhooks

```ts
import express from 'express';
import { receiveCaepEvent } from '@rootherald/node';

const app = express();

app.post('/webhooks/rootherald', receiveCaepEvent({
  issuer: 'https://rootherald.example.com',
  onEvent: async (event) => {
    if (event.type === 'tag:rootherald.io,2026:event-type:attestation-failed') {
      await invalidateSessionsForDevice(event.payload.device_id as string);
    }
  },
}));
```

## Manage webhook subscriptions

```ts
import { createSsfClient } from '@rootherald/node';

const ssf = createSsfClient({
  issuer: 'https://rootherald.example.com',
  clientId: process.env.ROOTHERALD_CLIENT_ID!,
  clientSecret: process.env.ROOTHERALD_CLIENT_SECRET!,
});

const stream = await ssf.createStream({
  url: 'https://your-app.example.com/webhooks/rootherald',
  eventTypes: [
    'tag:rootherald.io,2026:event-type:attestation-completed',
    'tag:rootherald.io,2026:event-type:attestation-failed',
  ],
});
console.log('Registered stream', stream.streamId);
```
