import { ref, type App } from "vue";
import { createClient } from "@rootherald/js";
import type {
  AcrRequestOptions,
  RootHeraldProviderProps,
  RootHeraldSdkClient,
} from "@rootherald/contracts";
import { RootHeraldKey, type RootHeraldInjection } from "./symbols.js";

export interface RootHeraldPluginOptions
  extends Omit<RootHeraldProviderProps, "children"> {
  clientSecret?: string;
  defaultAcr?: AcrRequestOptions;
}

/**
 * Creates a Vue plugin that initializes the Root Herald SDK and exposes
 * reactive state via provide/inject. Pair with `useAttestation()` for
 * route-level consumption.
 *
 * @example
 * ```ts
 * import { createApp } from 'vue';
 * import { createRootHerald } from '@rootherald/vue';
 * import App from './App.vue';
 *
 * const app = createApp(App);
 * app.use(createRootHerald({
 *   issuer: 'https://api.rootherald.io',
 *   clientId: 'plat_your_client_id',
 *   redirectUri: window.location.origin + '/callback',
 * }));
 * app.mount('#app');
 * ```
 */
export function createRootHerald(options: RootHeraldPluginOptions) {
  return {
    install(app: App) {
      const client = ref<RootHeraldSdkClient | null>(null);
      const verdict: RootHeraldInjection["verdict"] = ref(null);
      const token: RootHeraldInjection["token"] = ref(null);
      const isLoading = ref(true);
      const error = ref<Error | null>(null);

      const refresh = async () => {
        if (!client.value) return;
        verdict.value = await client.value.getVerdict();
        token.value = await client.value.getToken();
      };

      // Initialise on plugin install. SSR-safe: skip if no window.
      if (typeof window !== "undefined") {
        (async () => {
          try {
            const c = await createClient({
              issuer: options.issuer,
              clientId: options.clientId,
              redirectUri: options.redirectUri,
              scope: options.scope,
              cacheLocation: options.cacheLocation,
              clientSecret: options.clientSecret,
              defaultAcr: options.defaultAcr,
            });
            client.value = c;

            const url = new URL(window.location.href);
            if (url.searchParams.has("code") && url.searchParams.has("state")) {
              verdict.value = await c.handleRedirectCallback();
              token.value = await c.getToken();
              const cleanUrl = `${url.pathname}${url.hash}`;
              window.history.replaceState(null, "", cleanUrl);
            } else {
              verdict.value = await c.getVerdict();
              token.value = await c.getToken();
            }
            isLoading.value = false;
          } catch (e) {
            error.value = e instanceof Error ? e : new Error(String(e));
            isLoading.value = false;
          }
        })();
      } else {
        // Server render: nothing to initialise; mark not loading so
        // pre-hydrated state can be replaced cleanly client-side.
        isLoading.value = false;
      }

      const injection: RootHeraldInjection = {
        client,
        verdict,
        token,
        isLoading,
        error,
        refresh,
      };
      app.provide(RootHeraldKey, injection);
    },
  };
}
