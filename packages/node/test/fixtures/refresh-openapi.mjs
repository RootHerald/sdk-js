// Copies platform's OpenAPI snapshot into the fixture the verdict-reason
// contract test reads, and records the platform commit it came from.
//
//   git -C ../platform show <sha>:services/api/RootHerald.Tests/Fixtures/openapi.snapshot.json > snapshot.json
//   node packages/node/test/fixtures/refresh-openapi.mjs snapshot.json <sha>

import { copyFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [snapshotPath, platformSha] = process.argv.slice(2);
if (!snapshotPath || !/^[0-9a-f]{40}$/.test(platformSha ?? "")) {
  console.error("usage: refresh-openapi.mjs <path-to-openapi.snapshot.json> <full platform commit sha>");
  process.exit(1);
}

const fixturesDir = dirname(fileURLToPath(import.meta.url));
copyFileSync(snapshotPath, join(fixturesDir, "openapi.public.json"));
writeFileSync(join(fixturesDir, "openapi.public.source"), `${platformSha}\n`);
