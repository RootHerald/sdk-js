import { defineConfig } from 'tsup';

// Dual ESM + CJS, matching @rootherald/node.
//
// contracts shipped ESM only while @rootherald/node advertises a `require`
// condition and its CJS bundle calls require('@rootherald/contracts'). Node's
// exports algorithm then failed with ERR_PACKAGE_PATH_NOT_EXPORTED, so every
// CJS consumer of the server SDK broke on import — invisible to our own tests,
// which resolve ESM from source.
//
// bundle: false is load-bearing. The error classes are re-exported from BOTH
// `.` and `./server`. Bundling each entry point separately gives each its own
// copy of the class, so an error thrown through `./server` fails `instanceof`
// against the one imported from `.` — the dual-package hazard, and it broke 11
// tests the first time this was built with bundling on. Transpiling file-by-
// file preserves the shared module graph exactly as `tsc` did, so there is one
// class identity per format.
export default defineConfig({
  entry: ['src/**/*.ts'],
  format: ['esm', 'cjs'],
  bundle: false,
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'node20',
});
