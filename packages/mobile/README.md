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

## Local phone testing

You can test Truss Go on an Android phone without waiting for an EAS cloud
build. This is the recommended workflow while iterating on the mobile client.

Install Android Studio, Android SDK Platform 36, and JDK 17 first. Set
`JAVA_HOME` to the JDK 17 directory and set `ANDROID_HOME` to your Android SDK
directory. On the phone, enable Developer options and USB debugging, then
connect it with USB and accept the debugging prompt.

From the repository root, run the following once to compile and install a
debug build directly to the attached phone:

```sh
npm install
npm --workspace @truss-harness/mobile run android:device
```

After that initial native build, ordinary `App.tsx` and other JavaScript or
TypeScript changes do not need another Android compile. Start Metro on your
LAN, open the installed Truss Go app, and it will load the new bundle:

```sh
npm --workspace @truss-harness/mobile run start -- --lan
```

Run `npm --workspace @truss-harness/mobile run android:release:device` when
you want to install and test a release-mode binary on the attached device.

### Local shareable APK

The `preview` EAS profile already produces an installable `.apk`. On Windows,
Expo supports local EAS builds through WSL rather than native Windows. With
WSL, Android SDK/NDK, JDK 17, and an authenticated Expo account configured,
run this from `packages/mobile`:

```sh
npm run android:apk:local
```

That runs the preview APK build on your machine, not an Expo cloud builder.
The command prints the generated APK path; send that file to the phone and
install it after allowing installs from the app you use to receive it.

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
