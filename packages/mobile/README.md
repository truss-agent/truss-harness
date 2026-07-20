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

## GitHub Release automation

Before the first automated Android release, an Expo account owner must run one
interactive preview build from `packages/mobile`. This initializes the EAS
project and writes its `projectId` to the app configuration. Commit that change
and add the account's Expo access token to the repository as `EXPO_TOKEN`.

Tag a committed mobile version as `truss-go-v<version>` (for example,
`truss-go-v0.1.0`). The **Truss Go Android release** workflow creates the
installable APK and its `SHA256SUMS.txt` file on the corresponding GitHub
Release. The production `.aab` remains the artifact for Google Play Console.
