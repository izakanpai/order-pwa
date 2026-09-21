# izakanpai mobile build

The iOS/Android package uses Capacitor. Its editable frontend source is `mobile-app/web`; it is intentionally separate from the existing hosted Web application in `docs/yuwaku`. The public QR customer order screen stays on the hosted Web application.

## Prepare and synchronize

```text
npm install
npm run mobile:prepare
npm run mobile:add:android
npm run mobile:add:ios
npm run mobile:sync
```

Run `mobile:add:*` only once per native platform. Later changes use `mobile:sync`.

`mobile:sync` uses `scripts/run-capacitor.cjs`. Some managed Windows sessions make Node's user lookup fail with `ERR_SYSTEM_ERROR / uv_os_get_passwd / ENOMEM` before Capacitor starts. Capacitor 8.4 on Windows can also emit backslash-separated local package paths that Swift cannot parse. The runner supplies a fallback user record only for the exact operating-system lookup failure, rethrows every other error, and normalizes only generated local Swift package paths after a successful command. Use the npm script instead of calling `npx cap sync` directly so asset generation and these narrow compatibility fixes are both applied.

## Branded icons and splash screens

The approved working master and immutable source mark live under `store-assets`. Run `npm run mobile:assets` on Windows to regenerate the App Store 1024 px icon, Google Play 512 px icon, native Web icons, iOS AppIcon and splash images, and Android legacy/adaptive icons and splash images. Then run `npm run mobile:sync` so the native Web icon copies reach both platform projects. The generator deliberately does not touch the existing hosted Web application under `docs/yuwaku`.

The store icons are opaque RGB PNGs; the Android adaptive foreground is transparent and uses the navy background resource. Visual brand approval and screenshots captured from physical devices remain release gates.

Android can be opened on Windows with `npm run mobile:open:android`. iOS compilation, signing, TestFlight upload, and device verification require macOS with Xcode; the iOS project may still be generated and committed from another supported environment.

On Windows, create the current debug APK with `npm run mobile:build:android`. The script first regenerates `mobile-dist`, copies it into the Android package, then stages source inputs outside OneDrive in a unique local temporary directory. Generated `build` and `.gradle` directories are excluded at every depth. After Gradle succeeds, only `android/app/build/outputs/apk/debug/app-debug.apk` is copied back and its SHA-256 is printed. The staging directory is retained for diagnostics; it is not a source tree.

## Android release bundle

Google Play requires an Android App Bundle. First validate the release build without an upload key:

```text
npm run mobile:validate:android:release
```

This creates `app-release-unsigned-validation.aab`. Its name and reported type deliberately identify it as **not publishable**. It only proves that the release variant compiles and contains the base manifest and application code.

For a publishable signed bundle, keep the upload keystore outside the repository and set these process environment values without writing passwords into source files:

```text
IZAKANPAI_ANDROID_KEYSTORE_FILE=<absolute path to upload-key .jks>
IZAKANPAI_ANDROID_STORE_PASSWORD=<secret>
IZAKANPAI_ANDROID_KEY_ALIAS=<alias>
IZAKANPAI_ANDROID_KEY_PASSWORD=<secret>
IZAKANPAI_ANDROID_VERSION_CODE=<positive increasing integer>
IZAKANPAI_ANDROID_VERSION_NAME=<public version, for example 1.0.0>
```

Then run `npm run mobile:build:android:release`. The command fails before Gradle when any required value or keystore is missing, builds outside OneDrive, verifies the AAB signature with `jarsigner`, and only then copies `app-release.aab` back to the project. Never reuse a lower `versionCode`, commit the keystore, or record the four signing secrets in a handoff document or command log.

`mobile-dist` is generated and must not be edited directly. `mobile-app/web/index.html` is the native staff login/management entry point. Do not copy application-only UI changes back into `docs/yuwaku`; shared API changes belong in `src`, while native UI changes belong in `mobile-app/web`. Production and test API credentials must never be bundled together.

## iOS signed archive

iOS signing and Archive generation require macOS with Xcode, a matching App ID for `com.izakanpai.commissionpos`, and an Apple Developer team. The Xcode project includes a shared `App` scheme so a release build does not depend on one developer's local Xcode user data.

Set these process environment values on the Mac. Keep account credentials, certificates, and provisioning profiles out of the repository and handoff documents:

```text
IZAKANPAI_APPLE_TEAM_ID=<10-character Apple team ID>
IZAKANPAI_IOS_VERSION=<public version, for example 1.0.0>
IZAKANPAI_IOS_BUILD_NUMBER=<positive increasing integer>
```

Run `npm run mobile:build:ios:release`. The script rebuilds and synchronizes the native web assets, performs exactly one Release Archive, and then checks the archived app's Bundle ID, public version, build number, application bundle, signature, and entitlements. It fails rather than overwriting an existing archive with the same build number. It intentionally does not export an IPA or upload to App Store Connect; those remain explicit, reviewed operations.

The attendance and inventory features use camera access, and attendance also uses location while the app is open. Android declares camera and coarse/fine location permissions. iOS includes English and Japanese permission explanations. Confirm both allow and deny paths on physical devices before submission.

Before the first App Store upload, review every native dependency and decide the export-compliance answer for encryption. Do not add `ITSAppUsesNonExemptEncryption` merely to suppress App Store Connect questions without confirming that the application—including third-party SDKs—uses only exempt encryption.

## Invite-only beta onboarding

Workspace-aware login is enabled in the app. New-store registration is implemented but fails closed until all three release settings are intentionally configured:

1. Set the Worker variable `SELF_SIGNUP_ENABLED` to `true` for the intended environment.
2. Store `SIGNUP_ACCESS_CODE` as a Worker secret for that same environment; never place it in source or `wrangler.toml`.
3. Store a different `SIGNUP_RATE_LIMIT_SALT` secret in production and test. If omitted, the environment-specific `AUTH_SECRET` is used as the fallback salt.
4. Optionally set `SIGNUP_RATE_LIMIT_MAX_ATTEMPTS` and `SIGNUP_RATE_LIMIT_WINDOW_SECONDS`; the safe defaults are 10 attempts per 15 minutes.
5. Apply migration `0013_signup_rate_limits.sql` to that environment.
6. Set `SELF_SIGNUP_AVAILABLE` to `true` only in that environment's frontend `config.js`, then rebuild the app.

New workspaces receive a system-owner account, five tables, safe zero-tax/zero-service defaults, and the Free plan. Public signup without an invitation code is not enabled. Registration attempts are limited by a salted hash of Cloudflare's connection IP header; raw IP addresses are not stored, and stale aggregate rows are removed. Before removing the beta invitation gate, add verified email ownership and stronger bot protection such as Turnstile.

## Release gates

- [x] JavaScript and local regression tests pass for the current source.
- [x] Native assets synchronize to both platform projects and the Android debug APK contains the current attendance assets.
- [x] Production/test tenant and authentication separation tests pass.
- [x] Native tokens use iOS Keychain / Android Keystore, with fail-closed behavior when the plugin is unavailable.
- [x] Invite-only signup and owner-verified account deletion requests are implemented.
- [x] Refund and commission reversal handling is implemented and regression-tested.
- [x] Production deletion-fulfilment runbook, retention schedule, finite R2 deletion, and owner confirmation are implemented and locally regression-tested.
- [x] RevenueCat SDK integration and signed, idempotent server-side entitlement synchronization are implemented.
- [ ] App Store / Google Play products and RevenueCat environment settings are configured and sandbox-tested on devices.
- [ ] Store privacy/data-safety declarations receive final legal and operational review.
- [ ] Physical iOS and Android tests cover offline/resend, checkout, commission allocation, locale, secure-token lifecycle, and app recovery.
- [ ] A production upload key is secured, a signed AAB is generated with an incremented versionCode, and Play App Signing enrollment is completed.
- [ ] A Mac with the correct Apple team creates a verified signed Archive with a new build number; export compliance is reviewed before upload.
