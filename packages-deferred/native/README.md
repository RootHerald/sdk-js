# @rootherald/native

Node.js binding to the Root Herald embeddable native SDK
(`RootHerald.dll` on Windows; `librootherald.so`/`librootherald.dylib`
once Wave 3 lands non-Windows platforms).

## Install

```
npm install @rootherald/native
```

The package ships prebuilt `.node` binaries per Node major (16/18/20/22)
where the build pipeline can produce them. On environments where no
prebuilt is available, `node-gyp-build` falls back to compiling from
source — which requires `RootHerald.dll`/`.lib` already on disk
(produced by the C++ CMake build at `src/clients/windows/`).

## Usage

```ts
import { RootHeraldClient } from "@rootherald/native";

const client = new RootHeraldClient({
  apiKey: process.env.ROOTHERALD_API_KEY!,
  // endpoint: "https://attest.yourapp.com",  // custom domain
  // endpoint: "https://api.yourapp.com/rh-proxy",  // proxy mode
});

try {
  const result = await client.verify("launch");
  if (result.verdict !== 0) {
    console.error("Device not trusted:", result.reason);
    process.exit(1);
  }
} finally {
  client.destroy();
}
```

## Build limitations

`node-gyp` requires Visual Studio Build Tools (Windows), Python 3, and
the prebuilt `RootHerald.lib` import library. CI environments without
those tools should depend on the prebuilt `.node` shipped in the
package. See [`binding.gyp`](./binding.gyp) for the build inputs.
