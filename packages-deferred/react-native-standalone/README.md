# @rootherald/react-native

React Native bindings for [Root Herald](https://rootherald.io) device attestation.

Bridges the hardware-rooted iOS `RootHeraldKit` (App Attest) and Android `RootHeraldClient` (Hardware Key Attestation, TEE / StrongBox) SDKs into a single, idiomatic JS surface with React hooks.

## Install

```bash
npm install @rootherald/react-native
npx pod-install ios          # iOS only
```

Autolinking handles the rest on RN 0.60+. For older RN, run `react-native link @rootherald/react-native` once.

### Peer dependencies

- `react` >= 18
- `react-native` >= 0.72

## Usage

### Imperative

```ts
import { RootHeraldClient } from '@rootherald/react-native';

const client = new RootHeraldClient({
  apiKey: 'pub_xxx',
  endpoint: 'https://rootherald.io', // or custom domain, or customer proxy
});

const result = await client.verify('signup');
if (result.verdict === 'allow') {
  // proceed
}
```

### Hook-based

```tsx
import { useVerifyDevice, getOrCreateSharedClient } from '@rootherald/react-native';

const client = getOrCreateSharedClient({ apiKey: 'pub_xxx' });

function SignupScreen() {
  const { verify, loading, error, result } = useVerifyDevice({
    action: 'signup',
    client,
  });

  return (
    <Button
      onPress={verify}
      disabled={loading}
      title={result?.verdict === 'allow' ? 'Continue' : 'Verify device'}
    />
  );
}
```

The hook:

- Auto-calls `verify()` on mount when `autoStart` is true (default: `false`).
- Provides `verify()`, `reset()`, `loading`, `error`, `result`.
- Cancels in-flight requests on unmount (via `AbortController`).
- Coalesces overlapping calls — only the most recent result wins.

## Transport modes

The SDK doesn't care which transport mode you use; the wire protocol is identical. Pass whichever endpoint your tenant is configured for:

| Mode | Example endpoint |
|------|------------------|
| Direct | `https://rootherald.io` |
| Custom domain | `https://attest.yourdomain.com` |
| Reverse proxy | `https://api.yourdomain.com/rh` |

## Native dependencies

- **iOS**: `RootHeraldKit` (SwiftPM, iOS 14+, App Attest entitlement required).
- **Android**: `io.rootherald:rootherald` (Gradle, minSdk 26, AndroidKeyStore).

## Expo support

- **Bare workflow / development builds**: fully supported.
- **Managed workflow (Expo Go)**: not supported — Root Herald requires native code that Expo Go can't load. Use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) on Expo SDK 50+.

A config plugin is planned for a future release to simplify managed-workflow setup.

## Architecture (TurboModules vs legacy NativeModules)

We currently use the **legacy NativeModule** pattern (`NativeModules.RootHeraldRN`) rather than a generated TurboModule spec. Rationale:

1. The package supports RN 0.72+; New Architecture is the default only on 0.76+, and many production apps haven't migrated.
2. The surface is tiny (two async methods); codegen would add build friction for zero runtime benefit.
3. Migrating to a TurboModuleRegistry spec later is a purely additive change — call sites stay identical.

## License

Apache-2.0.
