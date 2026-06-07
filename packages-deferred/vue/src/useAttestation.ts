import { computed, inject, type ComputedRef } from "vue";
import type { AcrUrn, AttestationVerdict, LoginOptions } from "@rootherald/contracts";
import { RootHeraldKey } from "./symbols.js";

export interface UseAttestationResult {
  verdict: ComputedRef<AttestationVerdict | null>;
  token: ComputedRef<string | null>;
  isLoading: ComputedRef<boolean>;
  isAuthenticated: ComputedRef<boolean>;
  error: ComputedRef<Error | null>;
  login: (options?: LoginOptions & {
    acrValues?: AcrUrn[];
    maxAge?: number;
    essential?: boolean;
  }) => Promise<void>;
  logout: (options?: { returnTo?: string }) => Promise<void>;
}

/**
 * Vue composable that exposes Root Herald attestation state + actions.
 * Must be called inside a component tree where the plugin from
 * `createRootHerald(...)` is installed.
 *
 * @example
 * ```vue
 * <script setup lang="ts">
 * import { useAttestation } from '@rootherald/vue';
 * const { verdict, login, isAuthenticated } = useAttestation();
 * </script>
 * <template>
 *   <button v-if="!isAuthenticated" @click="login()">Sign in</button>
 *   <div v-else>{{ verdict?.device.deviceId }}</div>
 * </template>
 * ```
 */
export function useAttestation(): UseAttestationResult {
  const ctx = inject(RootHeraldKey);
  if (!ctx)
    throw new Error(
      "useAttestation must be used in a component tree where app.use(createRootHerald(...)) has been called.",
    );

  const login: UseAttestationResult["login"] = async (opts) => {
    const c = ctx.client.value;
    if (!c) throw new Error("RootHerald client not initialised yet");
    await c.loginWithRedirect(opts);
  };

  const logout: UseAttestationResult["logout"] = async (opts) => {
    const c = ctx.client.value;
    if (!c) throw new Error("RootHerald client not initialised yet");
    await c.logout(opts);
    await ctx.refresh();
  };

  return {
    verdict: computed(() => ctx.verdict.value),
    token: computed(() => ctx.token.value),
    isLoading: computed(() => ctx.isLoading.value),
    isAuthenticated: computed(() => ctx.verdict.value !== null),
    error: computed(() => ctx.error.value),
    login,
    logout,
  };
}
