# @rootherald/browser

The **page-side** RootHerald SDK (Client ABI 8.0). It orchestrates the
**keyless** client flow over the page → extension → native-host bridge and hands
**opaque blobs** to you (the embedder). Your backend relays those blobs to
RootHerald with its `rh_sk_` secret (see [`@rootherald/node`](https://www.npmjs.com/package/@rootherald/node)).

This package drives RootHerald's own browser extension and native host, which
are reference and test tools. It is not published to npm.

**The browser holds no RootHerald key and never calls RootHerald.** Every verb
is a local TPM operation on the user's machine; bytes move only over *your own*
client ↔ backend channel, which you own. No secret, no verdict, no RootHerald
network call ever happens in the browser.

```
page (@rootherald/browser) ──▶ extension ──▶ native host (TPM)
        │  opaque blobs                              │
        └────────────────── blobs ◀──────────────────┘
        │
        ▼   relay callbacks you provide
   your backend (@rootherald/node, rh_sk_) ──▶ RootHerald
```

## The verbs

| Verb | What it does | Returns |
|---|---|---|
| `enroll(relay)` | Enroll this installation. Two network legs are relayed by **your** backend. | `{ ak }` |
| `attest(challenge, { ak })` | Answer a backend-issued challenge: a fresh TPM quote under the AK, plus the event log when the ask says so. | `{ evidence }` |
| `mintKey(keyChallenge, { ak })` | Mint a device-bound key certified by the AK. | `{ certification, key }` |
| `sign(key, data)` | Sign with a minted key. The private half stays in the TPM. | `{ alg, signature }` |
| `setUp(relay, { purpose })` | `enroll` → `attest` → `mintKey`, chained. | `{ ak, key, verified }` |
| `getClientStatus()` | **PreCheck** — is the extension there, is the host there. | `ClientStatus` |
| `getPosture()` | **PreCheck** — the host's local posture signals. | `DevicePosture` |

PreCheck results are **readiness signals, never a verdict**.

## Blobs are yours to keep

`enroll` returns the installation's AK blob; `mintKey` returns a key blob. The
SDK stores nothing. Your page keeps both and passes `ak` to every `attest` and
`mintKey`, and `key` to every `sign`. Measured on an Intel PTT: an ECC AK blob
is 90 + 128 bytes of public and private area, an RSA one 282 + 224; key blobs
are the same order. Each blob is a credential: any code that can read it can
use the key.

A TPM clear kills every blob, the AK included. If `attest` or `mintKey` throws
`KeyUnloadableError` for the AK, discard it, `enroll()`, and retry once. If
your backend's `verify` answers `enrollmentRequired: true`, enroll.

### `enroll(relay)`: keyless, backend-relayed

Each installation enrolls once. The native host creates the AK inside the TPM
and hands it back wrapped; the **network legs are relayed by your backend**
via the `relay` callbacks you pass in. On Windows the second leg asks for one
elevation per enrollment.

```ts
import { enroll } from '@rootherald/browser';

const { ak } = await enroll({
  // Leg 1: POST the blob to YOUR backend, which calls @rootherald/node
  // `relayEnroll(blob)` and returns its RelayEnrollResult ({ challenge }).
  enroll: (enrollBody) =>
    fetch('/rh/enroll', {
      method: 'POST',
      body: JSON.stringify(enrollBody),
    }).then((r) => r.json()),

  // Leg 2: POST the activation blob to YOUR backend, which calls
  // @rootherald/node `relayActivate(blob)` and keeps the deviceId it returns.
  activate: (activationBlob) =>
    fetch('/rh/activate', {
      method: 'POST',
      body: JSON.stringify(activationBlob),
    }).then((r) => r.json()),
});
store(ak); // your choice of storage
```

`enroll` runs `enroll-begin` → `relay.enroll` → `enroll-complete` →
`relay.activate` and resolves with the AK blob. The page learns nothing else
about the device. Your backend learns the device's alias from `relayActivate`,
and verdicts carry it as `verdict.device.ueid`; key your tables on that. Every
call creates a new installation with a new AK; the alias does not change.

### `attest(challenge, { ak })`: the challenge carries the ask

Your backend mints a challenge with `@rootherald/node`'s `issueChallenge`,
naming what the device must prove (`identity`, `posture`). It relays the
`challenge` string to the page verbatim; the host reads the ask from it.

```ts
import { attest } from '@rootherald/browser';

// 1. Your backend calls issueChallenge({ ask: ['identity'] }) and returns
//    { nonce, challenge }.
const { nonce, challenge } = await fetch('/rh/challenge').then((r) => r.json());

// 2. The host quotes under the AK and returns the opaque evidence.
const { evidence } = await attest(challenge, { ak: load() });

// 3. Hand the blob to YOUR backend, which relays it to RootHerald's verify.
const result = await fetch('/rh/verify', {
  method: 'POST',
  body: JSON.stringify({ nonce, evidence }),
}).then((r) => r.json());
```

Pass a `relay.verify` callback and `attest` resolves with whatever your
backend returns instead of the evidence (still keyless). **Step-up /
re-attest** is `attest` again with a fresh challenge whose ask names
`posture`.

### `mintKey` + `sign`: a key your backend can trust

```ts
import { mintKey, sign } from '@rootherald/browser';

// issueKeyChallenge({ purpose: 'sign', expectedDevices: [alias] }) on the backend.
const { nonce, keyChallenge } = await fetch('/rh/key-challenge').then((r) => r.json());

const { certification, key } = await mintKey(keyChallenge, { ak: load() });
storeKey(key);

// certifyKey(nonce, certification) on the backend; it stores keyId + jwk.
await fetch('/rh/certify', { method: 'POST', body: JSON.stringify({ nonce, certification }) });

// Later — no RootHerald call anywhere. The backend checks the signature with
// @rootherald/node's verifyKeySignature(jwk, message, signature).
const message = `login:${Date.now()}`;
const { alg, signature } = await sign(loadKey(), message);
await fetch('/rh/login', { method: 'POST', body: JSON.stringify({ message, alg, signature }) });
```

`data` for `sign` is the bytes to sign; a string is UTF-8 text, so the backend
checks `"hello"` with `"hello"`. The bytes travel base64url and the host
hashes them. `alg` comes from the key: `ES256` for an EC key, `RS256`
for an RSA one.

A signature proves possession of the key, not how the machine booted.

### `setUp(relay, { purpose })`: the three in one call

```ts
import { setUp } from '@rootherald/browser';

const { ak, key } = await setUp(
  {
    enroll: (blob) => post('/rh/enroll', blob),
    activate: (blob) => post('/rh/activate', blob),
    challenge: () => post('/rh/challenge', {}),                   // issueChallenge
    verify: (nonce, evidence) => post('/rh/verify', { nonce, evidence }),   // verify → { pass }
    keyChallenge: (purpose) => post('/rh/key-challenge', { purpose }),      // issueKeyChallenge
    certify: (nonce, certification) => post('/rh/certify', { nonce, certification }),
  },
  { purpose: 'sign' },
);
```

Your `/rh/key-challenge` handler calls `issueKeyChallenge({ purpose,
expectedDevices: [alias] })` with the alias from the verdict it just accepted,
so the key provably comes from the device that passed; the alias never
reaches the page. `setUp` throws `NotAttestedError` when `verify` returns
`pass: false`; the installation is enrolled and no key was minted.

## Errors

Every verb throws typed errors so a UI can route to the right fix:

| Error | Meaning | Fix |
|---|---|---|
| `ExtensionMissingError` | The extension never answered, not even a probe. | Install the extension. |
| `HostMissingError` | Extension present; native host unreachable, or it answered without the field the action promises. | Install and run the host. |
| `TimeoutError` | The extension is present but the operation did not finish in time. | Retry. |
| `NotEnrolledError` | Host answered: `enroll-complete` without an `enroll-begin`. | `enroll()` runs both legs. |
| `AskUnsupportedError` | Host answered: it cannot do what the ask names. | Issue a challenge with a smaller ask. |
| `KeyUnloadableError` | Host answered: the blob will not load into this TPM. | AK: discard, `enroll()`, retry once. Key: mint a new one. |
| `AbiMismatchError` | The host reports an ABI major other than 8, or does not know the action. | Update the native host. |
| `NotAttestedError` | `setUp`: the attest step did not pass. | Nothing was minted. |
| `HostError` | Host answered with a code this SDK does not name (`.code`). | |

`NotEnrolledError`, `AskUnsupportedError`, `KeyUnloadableError` and
`AbiMismatchError` extend `HostError`, which carries the host's stable `code`;
all extend `RootHeraldBrowserError`. The host prefixes its errors with
`rh:<code>:<text>`; `parseHostError` is exported if you want the raw token.

The ABI check runs on the page: every host answer carries `abi`, and
`enroll-begin` is refused before anything is relayed when the major is not 8
or the field is missing.

## Timeouts

`attest` 75 s, `mintKey` 75 s, `sign` 45 s, `getPosture` 45 s, `enroll` 135 s
per host leg (it can block on a UAC prompt), detection probes 1.5 s. All are
`timeoutMs` options. Each is above the extension's own per-action host
timeout, so a slow host is reported by the extension. When a verb's own timer
fires anyway, the SDK pings the extension: an answer makes it a
`TimeoutError`, silence an `ExtensionMissingError`.

The SDK only runs in a secure context (`https`, or `http` on localhost), and
only accepts responses posted by the page's own window at its own origin.

## PreCheck: detection

```ts
import { getClientStatus, onClientStatusChange } from '@rootherald/browser';

const status = await getClientStatus();
// { os: 'windows', browser: 'chrome', extension: 'present', host: 'missing' }

const stop = onClientStatusChange((s) => {
  if (s.host === 'unsupported') showUnsupported();
  else if (s.extension === 'missing') showInstallExtension(s.browser);
  else if (s.host === 'missing') showInstallHost();
  else showReady();
});
// stop() when the view unmounts.
```

- **OS / browser**: sniffed from the user-agent. The native host is
  **Windows-first**; `macos`/`linux` resolve `host: 'unsupported'`.
- **Extension presence**: the page posts a `ping`; the extension's content
  script answers only when installed (it never broadcasts unsolicited, so
  non-RootHerald sites can't fingerprint it). A timeout means `missing`.
- **Host reachability**: once the extension is present, a local-only `status`
  request drives the extension's `connectNative` to the host. Success →
  `present`; a disconnect/timeout → `missing`.
- **Posture**: `getPosture()` returns the host's local signals: its `abi`,
  `host` version, `capabilities` bitmask (bit 1 ECC AK, bit 2 RSA AK), and
  what it can see about the TPM and boot. Host-defined.

## Exports

`enroll`, `attest`, `mintKey`, `sign`, `setUp`, `getPosture`,
`getClientStatus`, `onClientStatusChange`, the detect helpers,
`parseHostError`, `abiMajor`, the typed errors, `ROOTHERALD_EXTENSION_ID`,
`HOST_ABI_MAJOR`, the wire message types and actions (`ACTION_ATTEST`,
`ACTION_MINT_KEY`, `ACTION_SIGN`, `ACTION_POSTURE`, `ACTION_STATUS`,
`ACTION_ENROLL_BEGIN`, `ACTION_ENROLL_COMPLETE`, `ACTION_PING`), and the
contract types (`AkBlob`, `KeyBlob`, `Ask`, `EvidenceBlob`,
`KeyCertification`, `KeyPurpose`, `EnrollRequestBlob`,
`EnrollActivationChallenge`, `EnrollActivationResponse`, `RelayEnrollResult`,
`RelayActivateResponse`) re-exported from `@rootherald/contracts`.
