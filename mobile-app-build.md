# Commission POS mobile build

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

Android can be opened on Windows with `npm run mobile:open:android`. iOS compilation, signing, TestFlight upload, and device verification require macOS with Xcode; the iOS project may still be generated and committed from another supported environment.

On Windows, create the current debug APK with `npm run mobile:build:android`. The script first regenerates `mobile-dist`, copies it into the Android package, then stages source inputs outside OneDrive in a unique local temporary directory. Generated `build` and `.gradle` directories are excluded at every depth. After Gradle succeeds, only `android/app/build/outputs/apk/debug/app-debug.apk` is copied back and its SHA-256 is printed. The staging directory is retained for diagnostics; it is not a source tree.

`mobile-dist` is generated and must not be edited directly. `mobile-app/web/index.html` is the native staff login/management entry point. Do not copy application-only UI changes back into `docs/yuwaku`; shared API changes belong in `src`, while native UI changes belong in `mobile-app/web`. Production and test API credentials must never be bundled together.

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
- [x] Production/test tenant and authentication separation tests pass.
- [x] Native tokens use iOS Keychain / Android Keystore, with fail-closed behavior when the plugin is unavailable.
- [x] Invite-only signup and owner-verified account deletion requests are implemented.
- [x] Refund and commission reversal handling is implemented and regression-tested.
- [ ] Production deletion-fulfilment runbook, retention schedule, and owner notification are operationally approved.
- [x] RevenueCat SDK integration and signed, idempotent server-side entitlement synchronization are implemented.
- [ ] App Store / Google Play products and RevenueCat environment settings are configured and sandbox-tested on devices.
- [ ] Store privacy/data-safety declarations receive final legal and operational review.
- [ ] Physical iOS and Android tests cover offline/resend, checkout, commission allocation, locale, secure-token lifecycle, and app recovery.
