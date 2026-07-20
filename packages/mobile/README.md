# Truss Go

Expo/React Native client for a trusted Truss workspace gateway. The computer
running Truss, not the phone, owns the workspace, agent tools, provider
credentials, and approval policy.

```sh
npm --workspace @truss-harness/mobile run start
```

For normal use, open **Connect Truss Go** in Truss Desktop or VS Code, then
scan the displayed QR code from this app while both devices are on the same
Wi-Fi. The QR grants access only while the desktop/VS Code connection remains
open. Manual URL/token entry remains a developer fallback.

## Android builds

An Expo owner can create an installable testing APK with:

```sh
npx eas-cli build --profile preview --platform android
```

The production profile produces an Android App Bundle (`.aab`) for Google Play
Console submission:

```sh
npx eas-cli build --profile production --platform android
```
