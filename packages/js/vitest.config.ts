import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // storage tests need localStorage/sessionStorage (jsdom)
    // pkce/tokens/client tests use Web Crypto + jose — run in node where
    // TextEncoder produces real Uint8Arrays that jose accepts
    environmentMatchGlobs: [
      ['test/storage.test.ts', 'jsdom'],
      ['test/**/*.test.ts', 'node'],
    ],
    globals: false,
  },
});
