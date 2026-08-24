# BPMSquare Mobile

A native Android + iOS app shell around the existing BPMSquare web app —
one Flutter codebase, wrapping the product in a platform WebView rather
than reimplementing it natively. This gets a real home-screen app into
both stores fast; native rewrites of individual screens (push
notifications, biometric unlock, offline caching of specific views) can
layer on top of this shell later without starting over.

**What's in this folder right now:** `pubspec.yaml`, `lib/main.dart`, and
this README — hand-written, not generated. **What is NOT in this folder:**
the native `android/` and `ios/` project folders. Those are Flutter-SDK
generated (gradle files, `Info.plist`, `AppDelegate.swift`, a `Podfile`,
etc. — version-specific boilerplate that has to come from the real `flutter
create` command, not be hand-authored blind) — step 1 below generates them
in about 10 seconds. Nothing here has been run through `flutter pub get`,
`flutter analyze`, or a real build in this environment (no Flutter SDK is
installed where this was written) — treat the Dart code as reviewed and
believed-correct against the `webview_flutter` 4.x / `url_launcher` 6.x /
`connectivity_plus` 6.x APIs, not as build-verified. Run step 2 before
trusting it.

---

## 0. Prerequisites (on your own machine, not this container)

- [Flutter SDK](https://docs.flutter.dev/get-started/install) 3.24+ (`flutter --version` to confirm)
- Android: Android Studio + an SDK/emulator, or a physical device with USB debugging
- iOS: a Mac with Xcode 15+, and an Apple Developer account for device builds / App Store submission
- A real app icon: a single 1024×1024 PNG, no transparency, saved to
  `mobile/assets/icon/app_icon.png` (this repo doesn't ship one — use the
  tenant's logo from Settings → Branding, exported at full resolution)

## 1. Generate the native platform folders

```bash
cd mobile
flutter create . --project-name bpmsquare --org com.yourcompany
```

Run this **in the `mobile/` folder itself** (the `.`) — it fills in
`android/` and `ios/` around the existing `pubspec.yaml`/`lib/main.dart`
without overwriting them. Replace `com.yourcompany` with your real reverse-
domain (this becomes the Android `applicationId` / iOS bundle identifier —
choose it deliberately, it's very hard to change post-launch).

## 2. Install dependencies and verify it builds

```bash
flutter pub get
flutter analyze          # should report "No issues found"
flutter run               # launches on a connected device/emulator
```

## 3. App icon + splash screen

```bash
dart run flutter_launcher_icons
dart run flutter_native_splash:create
```

Both read `mobile/assets/icon/app_icon.png` (configured in `pubspec.yaml`)
and regenerate every platform-specific icon/splash asset automatically.

## 4. Which workspace does the app open?

BPMSquare resolves the tenant from the **hostname**
(`bpmsquarecore.md` §2/§10) — there's no login-time tenant switch. This app
handles that two ways, pick the one that matches your rollout:

- **One app, any workspace (default, already wired up).** First launch
  shows a screen asking for the workspace address (e.g.
  `acme.bpmsquare.app`), saves it on-device, and every launch after that
  goes straight there. This is the right choice if the partner is
  reselling to many different end customers from one app listing, or for
  your own multi-tenant demo builds.
- **One app per branded tenant.** Skip the picker screen entirely by
  building with the workspace baked in:
  ```bash
  flutter build apk --dart-define=BPM_BASE_URL=https://thatcustomer.bpmsquare.app
  ```
  Do this per customer if a partner wants a distinctly-branded app per
  client rather than one shared listing.

## 5. Android release build

**Generate a signing key** (once — store the `.jks` and its passwords
somewhere durable; losing it means you can never update the app again
under the same listing):

```bash
keytool -genkey -v -keystore ~/bpmsquare-release.jks -keyalg RSA \
  -keysize 2048 -validity 10000 -alias bpmsquare
```

Create `mobile/android/key.properties` (never commit this file — add it to
`.gitignore`, already done):

```
storePassword=<password you set above>
keyPassword=<password you set above>
keyAlias=bpmsquare
storeFile=/absolute/path/to/bpmsquare-release.jks
```

Point `android/app/build.gradle` at it — `flutter create` generates a debug
signing config by default; replace the release `signingConfig` block with:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

Build:

```bash
flutter build appbundle --release   # .aab -- what Play Console wants
flutter build apk --release         # .apk -- for direct install/testing
```

Output: `build/app/outputs/bundle/release/app-release.aab`.

## 6. iOS release build

```bash
flutter build ipa --release
```

This needs Xcode signing set up first: open `ios/Runner.xcworkspace` in
Xcode, select the Runner target → Signing & Capabilities, pick your Apple
Developer team, and let Xcode manage the provisioning profile (simplest
path for a first submission). Then `flutter build ipa` produces
`build/ios/ipa/*.ipa`, uploadable via Xcode's Organizer or
`xcrun altool`/Transporter.

## 7. Store submission checklist

Both stores will ask about **data collection**, since this app carries a
real CRM through a WebView — answer honestly from what BPMSquare actually
stores (account/contact PII, business data), not from what this shell
"sees" (it sees nothing itself; the web app is the source of truth):

- **Google Play → App content → Data safety**: declare personal info
  (name, email, phone), and that data is encrypted in transit (HTTPS) —
  match `bpmsquarecore.md` §7's actual encryption story, don't overstate it.
- **App Store → App Privacy (nutrition label)**: same shape — contact
  info, user content; declare whether it's linked to identity (yes, it's a
  logged-in CRM) per Apple's categories.
- **Privacy Policy URL**: both stores require one; use the tenant's/your
  own hosted policy — this app itself collects nothing beyond the one
  workspace-address string saved locally on-device (`shared_preferences`).
- **App icon / screenshots**: generate from a real logged-in session
  (Settings → General shows the tenant's branding) — never mock data that
  looks fabricated for the listing.
- Package name / bundle ID chosen in step 1 (`com.yourcompany.bpmsquare`)
  is what both stores identify the app by forever — double check it before
  first submission.

## Known follow-ups (not built into this shell yet)

- **File uploads from the web app** (photo attachments, Data Workbench
  import) need extra native wiring (`onShowFileChooser` on Android,
  camera/photo-library permissions in `Info.plist` on iOS) that a plain
  `webview_flutter` setup doesn't provide out of the box. Untested here —
  budget a follow-up pass specifically for this before shipping if photo/
  file upload from mobile is a launch requirement.
- **Push notifications** (Nova inbox mentions, WFM approvals) would need
  Firebase Cloud Messaging (Android) / APNs (iOS) wired into this shell —
  straightforward to add later, deliberately left out of this first pass.
- **Biometric unlock** on app resume — a nice-to-have for a CRM holding
  customer data, not in this build.
