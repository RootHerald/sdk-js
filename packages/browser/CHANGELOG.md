# Changelog

All notable changes to `@rootherald/browser` are documented here.

## 0.1.0-alpha.15

Client ABI 7.0. No identifier the server assigns reaches the page.

### Breaking

- `enroll(relay)` resolves `void`. `EnrollResult` and its `deviceId` are
  removed: the enroll relay's 201 body carries an `enrollmentId` the host
  echoes, not a device id, and the device's alias is returned to the backend
  by `relayActivate`, where it stays. Key your tables on `verdict.device.ueid`.
- `relay.enroll` returns `{ challenge }` (`RelayEnrollResult` without
  `deviceId`); the page forwards `challenge` to the host verbatim. The
  request message's `challenge` for `enroll-complete` is typed as
  `RelayEnrollResponse`.
- The activation blob the host emits is `{ enrollmentId, decryptedSecret }`
  (`{ enrollmentId, signature }` on macOS); `deviceId` is gone from it.

## 0.1.0-alpha.14

The challenge carries the ask. The page relays the backend's `rhc1.` challenge
string to the host verbatim; the host reads what to prove from it.

### Breaking

- `attest(nonce)` is removed, with the host's `collect` action it drove. Use
  `respond(challenge)` with the `challenge` string from the backend's
  `issueChallenge`. There is no runtime shim: a page still calling `attest`
  fails to type-check and gets `undefined` at run time. `AttestOptions`,
  `AttestWithRelayOptions`, `AttestRelay`, and `ACTION_COLLECT` go with it.
- The request message no longer carries `nonce` or `challengeId`; it carries
  `challenge`, `keyBlob`, and `data`.
- `NotEnrolledError` now extends the new `HostError` (still a
  `RootHeraldBrowserError`).

### Added

- `respond(challenge, { key?, timeoutMs?, relay? })` resolves with
  `{ evidence, key? }`; `key` is the wrapped `KeyBlob` when the ask included
  `"key"`. With a `relay`, resolves with `relay.verify(evidence, key)`.
- `sign(key, data)` signs with a certified key and resolves with
  `{ alg: 'ES256', signature }`. `data` as bytes or a UTF-8 string, base64url
  on the wire.
- `getPosture()` exposes the host's `posture` action: local signals, never a
  verdict.
- `ACTION_RESPOND`, `ACTION_SIGN`, `ACTION_POSTURE`; `RootHeraldResponseData`
  types the response `data` (`evidence`, `keyBlob`, `alg`, `signature`,
  `abi`, `host`, the enroll blobs).
- Host errors are classified by the host's stable `rh:<code>:<text>` token
  instead of by wording: `NotEnrolledError` (`6`), `AskUnsupportedError`
  (`13`), `KeyUnloadableError` (`14`), `AbiMismatchError` (`abi_mismatch`,
  `unknown_action`), and `HostError` with `.code` for the rest.
  `parseHostError` is exported. The extension's own "native host
  disconnected" / `connectNative` wording still maps to `HostMissingError`,
  and "timed out" to `TimeoutError`.
- Default timeouts: `respond` 60 s, `sign` 30 s, `getPosture` 30 s, `enroll`
  120 s per host leg.
- Tests are type-checked (`tsconfig.test.json`), so a `@ts-expect-error` in a
  test is verified rather than assumed.

### Fixed

- The README said `enroll` returns `{ deviceId, alreadyEnrolled }` and that a
  `collectEvidence` alias exists. `enroll` returns `{ deviceId }` and there
  was never an alias.
- Comments cited `/devices/*` routes and "Client ABI 3.0"; the routes are
  `/api/v1/attest/*` and the ABI is 6.0.
