import { inject, Injectable, signal, computed } from "@angular/core";
import { createClient } from "@rootherald/js";
import type {
  AcrUrn,
  AttestationVerdict,
  LoginOptions,
  RootHeraldSdkClient,
} from "@rootherald/contracts";
import { ROOTHERALD_OPTIONS } from "./options.js";

/**
 * Angular service exposing Root Herald attestation state via signals.
 * Standalone-friendly — designed to be used via inject() in components.
 *
 * Register with `provideRootHerald({ ... })` in your app config; the
 * service initialises automatically on first injection.
 *
 * @example
 * ```ts
 * import { Component, inject } from '@angular/core';
 * import { RootHeraldService } from '@rootherald/angular';
 *
 * @Component({
 *   standalone: true,
 *   template: `
 *     @if (rh.isLoading()) { <p>Loading...</p> }
 *     @else if (!rh.isAuthenticated()) {
 *       <button (click)="rh.login()">Sign in</button>
 *     } @else {
 *       <p>{{ rh.verdict()?.device?.deviceId }}</p>
 *     }
 *   `,
 * })
 * export class HomeComponent {
 *   rh = inject(RootHeraldService);
 * }
 * ```
 */
@Injectable({ providedIn: "root" })
export class RootHeraldService {
  private readonly options = inject(ROOTHERALD_OPTIONS);

  private readonly _client = signal<RootHeraldSdkClient | null>(null);
  private readonly _verdict = signal<AttestationVerdict | null>(null);
  private readonly _token = signal<string | null>(null);
  private readonly _isLoading = signal(true);
  private readonly _error = signal<Error | null>(null);

  /** Current verdict (signal). null when not authenticated. */
  readonly verdict = this._verdict.asReadonly();
  /** Raw JWT (signal). null when not authenticated. */
  readonly token = this._token.asReadonly();
  /** True until the SDK has finished initial bootstrap + any OAuth callback. */
  readonly isLoading = this._isLoading.asReadonly();
  /** Last error encountered during init / login (signal). */
  readonly error = this._error.asReadonly();
  /** Convenience: `verdict() !== null`. */
  readonly isAuthenticated = computed(() => this._verdict() !== null);

  constructor() {
    this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    if (typeof window === "undefined") {
      // SSR: nothing to do client-side. Mark not loading so SSR shells render.
      this._isLoading.set(false);
      return;
    }
    try {
      const client = await createClient({
        issuer: this.options.issuer,
        clientId: this.options.clientId,
        redirectUri: this.options.redirectUri,
        scope: this.options.scope,
        cacheLocation: this.options.cacheLocation,
        clientSecret: this.options.clientSecret,
        defaultAcr: this.options.defaultAcr,
      });
      this._client.set(client);

      const url = new URL(window.location.href);
      if (url.searchParams.has("code") && url.searchParams.has("state")) {
        const v = await client.handleRedirectCallback();
        const t = await client.getToken();
        this._verdict.set(v);
        this._token.set(t);
        const cleanUrl = `${url.pathname}${url.hash}`;
        window.history.replaceState(null, "", cleanUrl);
      } else {
        this._verdict.set(await client.getVerdict());
        this._token.set(await client.getToken());
      }
    } catch (e) {
      this._error.set(e instanceof Error ? e : new Error(String(e)));
    } finally {
      this._isLoading.set(false);
    }
  }

  /** Redirect to Root Herald to authenticate. Accepts ACR / step-up options. */
  async login(
    options?: LoginOptions & {
      acrValues?: AcrUrn[];
      maxAge?: number;
      essential?: boolean;
    },
  ): Promise<void> {
    const c = this._client();
    if (!c) throw new Error("RootHerald client not initialised yet");
    await c.loginWithRedirect(options);
  }

  /** Clear local state. Optionally redirect after. */
  async logout(options?: { returnTo?: string }): Promise<void> {
    const c = this._client();
    if (!c) throw new Error("RootHerald client not initialised yet");
    await c.logout(options);
    this._verdict.set(await c.getVerdict());
    this._token.set(await c.getToken());
  }

  /** Manually refresh verdict + token (e.g. after a step-up flow). */
  async refresh(): Promise<void> {
    const c = this._client();
    if (!c) return;
    this._verdict.set(await c.getVerdict());
    this._token.set(await c.getToken());
  }
}
