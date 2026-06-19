# @rootherald/browser

The **page-side** Root Herald SDK. It brokers device-evidence collection through
the Root Herald browser extension (which drives the local native host) and
exposes **cold-start client detection** so your UI can guide a first-time
visitor through installing the extension and the native host.

It is **keyless** and makes **no Root Herald network call**: the page hands the
opaque evidence blob to *your* server, which relays it server→server to Root
Herald with its `rh_sk_` secret key (see `@rootherald/node`). The verdict is
produced by the server SDK, not here.

```
page (@rootherald/browser) ──▶ extension ──▶ native host (TPM quote)
        │                                            │
        └──────────── evidence blob ◀────────────────┘
        │
        ▼
   your server (@rootherald/node, rh_sk_) ──▶ Root Herald /verify
```

## Install

```bash
npm install @rootherald/browser
```

## Collect evidence

```ts
import { collectEvidence } from '@rootherald/browser';

// 1. Your server calls Root Herald /challenge and returns { challengeId, nonce }.
const { challengeId, nonce } = await fetch('/api/challenge').then((r) => r.json());

// 2. The page collects a fresh TPM quote over the nonce via the extension.
const evidence = await collectEvidence(nonce, { challengeId });

// 3. Hand the blob to YOUR server, which relays it to Root Herald /verify.
const verdict = await fetch('/api/verify', {
  method: 'POST',
  body: JSON.stringify({ challengeId, evidence }),
}).then((r) => r.json());
```

`collectEvidence` throws typed errors so a cold-start UI can route to the right fix:

- `ExtensionMissingError` — the extension is not installed → link the store page.
- `HostMissingError` — extension present, native host unreachable → download + run the installer.
- `TimeoutError` — collection started but did not finish in time.

## Cold-start detection

```ts
import { getClientStatus, onClientStatusChange } from '@rootherald/browser';

const status = await getClientStatus();
// { os: 'windows', browser: 'chrome', extension: 'present', host: 'missing' }

// Live-detecting install stepper that auto-advances as pieces appear:
const stop = onClientStatusChange((s) => {
  if (s.host === 'unsupported') showComingSoon();
  else if (s.extension === 'missing') showInstallExtension(s.browser);
  else if (s.host === 'missing') showInstallHost();
  else showAttest(); // READY
});
// stop() when the stepper unmounts.
```

### How detection works

- **OS / browser** — sniffed from the user-agent. The native host is
  **Windows-first**; `macos`/`linux` resolve `host: 'unsupported'`.
- **Extension presence** — the page posts a `ping` request; the extension's
  content script answers only when it is installed (it never broadcasts
  unsolicited, so non–Root Herald sites can't fingerprint it). A timeout means
  `missing`.
- **Host reachability** — once the extension is present, a local-only `status`
  request drives the extension's `connectNative` to the host. Success →
  `present`; a disconnect/timeout → `missing` (a distinct state from a missing
  extension, because it routes to a different fix).

## Exports

`collectEvidence`, `getClientStatus`, `onClientStatusChange`, the typed errors,
the `ROOTHERALD_EXTENSION_ID` constant, the wire message types, and the
`EvidenceBlob` / `AttestationVerdict` types re-exported from
`@rootherald/contracts`.
