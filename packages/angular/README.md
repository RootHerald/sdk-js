# @rootherald/angular

Angular adapter for the [Root Herald](https://rootherald.io) device attestation SDK. Wraps [`@rootherald/js`](https://www.npmjs.com/package/@rootherald/js) with an injectable signal-based service.

## Install

```bash
npm install @rootherald/angular @rootherald/js
```

Peer deps: Angular 17+ (standalone API + signals), RxJS 7+.

## 30-second integration

```ts
// app.config.ts
import { ApplicationConfig } from "@angular/core";
import { provideRootHerald } from "@rootherald/angular";

export const appConfig: ApplicationConfig = {
  providers: [
    provideRootHerald({
      issuer: "https://api.rootherald.io",
      clientId: "plat_your_client_id",
      redirectUri: window.location.origin + "/callback",
    }),
  ],
};
```

```ts
// home.component.ts
import { Component, inject } from "@angular/core";
import { RootHeraldService } from "@rootherald/angular";

@Component({
  selector: "app-home",
  standalone: true,
  template: `
    @if (rh.isLoading()) {
      <p>Verifying device...</p>
    } @else if (!rh.isAuthenticated()) {
      <button (click)="rh.login()">Sign in with device</button>
    } @else {
      <p>Device verified: <code>{{ rh.verdict()?.device?.deviceId }}</code></p>
      <p>Verdict: <code>{{ rh.verdict()?.device?.verdict }}</code></p>
      <p>TPM class: <code>{{ rh.verdict()?.device?.tpmClass }}</code></p>
      <button (click)="rh.logout()">Sign out</button>
    }
  `,
})
export class HomeComponent {
  rh = inject(RootHeraldService);
}
```

## API surface

### `provideRootHerald(options)`

Returns an Angular `Provider` for `ApplicationConfig.providers`. The service is then available via `inject(RootHeraldService)` anywhere in the app.

| Option | Required | Description |
|---|---|---|
| `issuer` | yes | Root Herald URL (e.g. `https://api.rootherald.io`) |
| `clientId` | yes | Your Root Herald RP client_id |
| `redirectUri` | yes | OAuth redirect URL (where the user lands after attesting) |
| `scope` | no | OAuth scopes (defaults to `openid profile`) |
| `cacheLocation` | no | Where to persist verdict (`memory` or `localstorage`) |
| `clientSecret` | no | For confidential clients only |
| `defaultAcr` | no | Default ACR / step-up parameters |

### `RootHeraldService`

Injected via `inject(RootHeraldService)` in components, directives, guards, etc.

| Member | Type | Description |
|---|---|---|
| `verdict()` | `Signal<AttestationVerdict \| null>` | Strongly-typed verdict, or null when unauthenticated |
| `token()` | `Signal<string \| null>` | Raw JWT to send to your backend |
| `isAuthenticated()` | `Signal<boolean>` | `verdict() !== null` |
| `isLoading()` | `Signal<boolean>` | True until SDK initialises + any OAuth callback completes |
| `error()` | `Signal<Error \| null>` | Last init / login error |
| `login(opts?)` | method | Redirect to Root Herald; supports `acrValues`, `maxAge`, `essential` |
| `logout(opts?)` | method | Clear local state, optional `returnTo` |
| `refresh()` | method | Manually re-read verdict (e.g. after a step-up) |

## Step-up via `acrValues`

```ts
this.rh.login({
  acrValues: ["urn:rootherald:user:phrh"],  // require phishing-resistant hardware-bound MFA
  maxAge: 60,                                // and recent (≤60s)
  essential: true,                           // hard requirement
});
```

## Route guard (functional, Angular 17+)

```ts
import { CanActivateFn, Router, inject } from "@angular/core";
import { RootHeraldService } from "@rootherald/angular";

export const requireAttestationGuard: CanActivateFn = () => {
  const rh = inject(RootHeraldService);
  const router = inject(Router);
  if (rh.isAuthenticated()) return true;
  rh.login();
  return router.parseUrl("/signing-in");
};
```

## SSR (Angular Universal)

The service no-ops on the server (`typeof window === "undefined"` check) and bootstraps lazily on the client. Signal state hydrates after browser mount; nothing in the SSR pass blocks on attestation.

## License

MIT.
