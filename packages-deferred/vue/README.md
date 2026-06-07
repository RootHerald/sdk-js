# @rootherald/vue

Vue 3 adapter for the [Root Herald](https://rootherald.io) device attestation SDK. Wraps [`@rootherald/js`](https://www.npmjs.com/package/@rootherald/js) with idiomatic Vue 3 composables and a plugin for global setup.

## Install

```bash
pnpm add @rootherald/vue @rootherald/js
# or
npm install @rootherald/vue @rootherald/js
```

Peer dep: Vue 3.4 or later.

## 30-second integration

```ts
// main.ts
import { createApp } from "vue";
import { createRootHerald } from "@rootherald/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(createRootHerald({
  issuer: "https://api.rootherald.io",
  clientId: "plat_your_client_id",
  redirectUri: window.location.origin + "/callback",
}));

app.mount("#app");
```

```vue
<!-- ProtectedRoute.vue -->
<script setup lang="ts">
import { useAttestation } from "@rootherald/vue";

const { verdict, isAuthenticated, isLoading, login, logout } = useAttestation();
</script>

<template>
  <p v-if="isLoading">Checking attestation...</p>
  <button v-else-if="!isAuthenticated" @click="login()">Sign in with device</button>
  <div v-else>
    <p>Device verified: <code>{{ verdict?.device.deviceId }}</code></p>
    <p>Verdict: <code>{{ verdict?.device.verdict }}</code></p>
    <p>TPM class: <code>{{ verdict?.device.tpmClass }}</code></p>
    <button @click="logout()">Sign out</button>
  </div>
</template>
```

## What you get from `useAttestation()`

| Field / method | Type | Description |
|---|---|---|
| `verdict` | `ComputedRef<AttestationVerdict \| null>` | The full strongly-typed verdict, or null if not authenticated |
| `token` | `ComputedRef<string \| null>` | Raw JWT to send to your backend |
| `isAuthenticated` | `ComputedRef<boolean>` | `verdict !== null` |
| `isLoading` | `ComputedRef<boolean>` | True while the SDK initializes / handles callback |
| `error` | `ComputedRef<Error \| null>` | Any initialization or login error |
| `login(opts?)` | `(opts?) => Promise<void>` | Redirect to Root Herald to attest; `acrValues` lets you require step-up |
| `logout(opts?)` | `(opts?) => Promise<void>` | Clears local state; `returnTo` redirects after |

## Step-up / ACR-driven login

```ts
const { login } = useAttestation();
await login({
  acrValues: ["urn:rootherald:user:phrh"],   // require phishing-resistant hardware-bound MFA
  maxAge: 60,                                // and recent (≤60s)
  essential: true,                           // hard requirement, not a hint
});
```

## SSR / Nuxt

The plugin no-ops during server render (`typeof window === "undefined"` short-circuit) and hydrates on the client. The reactive state is initialised on the client side after mount, so SSR pages don't block on attestation.

If you're integrating Nuxt 3, add the plugin via `nuxt.config.ts` or a `plugins/rootherald.client.ts` file (note the `.client` suffix — runs only on the client side).

## License

MIT.
