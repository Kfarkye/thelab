# iOS App Store Readiness (Phase 0)

This repo now includes the foundational web install assets needed to start iOS/App Store work:

- `src/app/manifest.ts` (web app manifest)
- `src/app/layout.tsx` Apple web app metadata + safe viewport settings
- `public/icons/apple-touch-icon.png`
- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/icon-512-maskable.png`

## What This Enables Today

1. Add-to-Home-Screen support for iOS Safari.
2. Standalone launch mode (`display: standalone`).
3. Proper icon assets for install prompts.
4. Safer viewport handling on modern iPhones (`viewport-fit=cover`).

## Next Steps (App Store Build Path)

Phase 1:

1. Add Capacitor shell (`@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`).
2. Point Capacitor at production web URL.
3. Add native iOS project via `npx cap add ios`.

Phase 2:

1. App Store Connect app record.
2. App Privacy + Data Use disclosures.
3. Sign-in/Account deletion path verification.
4. Build + archive via Xcode and TestFlight rollout.

Phase 3:

1. Push notification strategy (if needed).
2. Deep links / universal links.
3. Offline behavior and graceful reconnect UX.

## Notes

- This phase is intentionally non-breaking for desktop.
- Mobile UX refinements are CSS/interaction-layer only and do not alter data paths.
