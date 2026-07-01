# Changelog

All notable changes to `@rootherald/node` are documented here.

## 0.1.0-alpha.7

### Security (breaking behavior change)

- **Fix ACR cross-track bypass in `requireAttestation`.** `requireAttestation`
  now enforces the device and user ACR tracks **separately**, as specified by
  the Root Herald ACR Value Registry ("Hierarchy and Subsumption" — the
  device-only and user tiers are separate tracks). Previously a single flattened
  ACR ladder allowed a pure user-auth token (e.g. `urn:rootherald:user:1fa`) to
  wrongly satisfy a device requirement (e.g. `urn:rootherald:device:high`).

  Tokens that previously satisfied a `device:*` requirement via a user-track ACR
  are now **correctly rejected** with the RFC 9470 step-up `401` challenge. In
  addition, a `device:high` requirement is now satisfied only when the verdict
  carries the required device evidence (`quoteVerified && secureBootVerified &&
  eventLogVerified`) — the `acr` claim string alone is no longer sufficient.

  This is a **breaking behavior change** for anyone who (knowingly or not) relied
  on the old, buggy acceptance where a user-track token passed a device gate.
  Same-track laddering is unchanged: `device:high` still satisfies a `device:any`
  requirement, and a higher user tier still satisfies a lower user requirement.

  No public API surface changed — `acrValues`, `maxAgeSeconds`, and all other
  option names and function signatures are stable. Only the satisfaction logic
  changed.
