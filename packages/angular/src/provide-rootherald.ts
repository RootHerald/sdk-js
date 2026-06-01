import type { Provider } from "@angular/core";
import { ROOTHERALD_OPTIONS, type RootHeraldAngularOptions } from "./options.js";

/**
 * Standalone-app provider for Root Herald. Drop into `ApplicationConfig.providers`.
 *
 * @example
 * ```ts
 * import { ApplicationConfig } from '@angular/core';
 * import { provideRootHerald } from '@rootherald/angular';
 *
 * export const appConfig: ApplicationConfig = {
 *   providers: [
 *     provideRootHerald({
 *       issuer: 'https://api.rootherald.io',
 *       clientId: 'plat_your_client_id',
 *       redirectUri: window.location.origin + '/callback',
 *     }),
 *   ],
 * };
 * ```
 */
export function provideRootHerald(options: RootHeraldAngularOptions): Provider {
  return { provide: ROOTHERALD_OPTIONS, useValue: options };
}
