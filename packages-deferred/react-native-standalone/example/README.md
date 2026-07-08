# Root Herald RN — Example app

Single-screen Expo (bare workflow) app demonstrating `@rootherald/react-native`.

## Run

```bash
cd src/sdk-react-native/example
npm install
EXPO_PUBLIC_ROOTHERALD_APP_ID=your-app-id \
EXPO_PUBLIC_ROOTHERALD_ENDPOINT=https://rootherald.io \
npx expo run:ios   # or run:android
```

The gear icon opens a sheet to switch between Direct / Custom Domain / Reverse Proxy transport modes — all three speak the same wire protocol, only the endpoint URL differs.

## Notes

- This is an Expo **bare workflow** project. The Root Herald native bridge ships hardware-attestation code that can't run on Expo Go.
- For Expo SDK 50+ managed workflow, use a [development build](https://docs.expo.dev/develop/development-builds/introduction/) or wrap the native module behind an Expo config plugin (planned for a future release).
- The client is keyless — it holds no Root Herald key. `EXPO_PUBLIC_ROOTHERALD_APP_ID` is just a public app tag and is safe to embed; the device evidence it collects is relayed to Root Herald by your backend using your secret `rh_sk_` key.
