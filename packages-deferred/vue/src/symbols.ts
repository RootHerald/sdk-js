import type { InjectionKey, Ref } from "vue";
import type {
  AttestationVerdict,
  RootHeraldSdkClient,
} from "@rootherald/contracts";

/**
 * Injection key for the Root Herald client + reactive state. Provided by
 * the plugin (`app.use(createRootHerald(...))`) and consumed by
 * `useAttestation()`.
 */
export interface RootHeraldInjection {
  client: Ref<RootHeraldSdkClient | null>;
  verdict: Ref<AttestationVerdict | null>;
  token: Ref<string | null>;
  isLoading: Ref<boolean>;
  error: Ref<Error | null>;
  refresh: () => Promise<void>;
}

export const RootHeraldKey: InjectionKey<RootHeraldInjection> =
  Symbol("RootHerald");
