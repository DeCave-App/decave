# DeCave Mobile — Phase 1

This is the first native DeCave mobile client for Android and iOS.

## Included now

- Native React Native / Expo app (not a WebView wrapper)
- DeCave login
- Cloudflare Turnstile in a small native WebView security modal
- Registration + verified-email flow
- Forgot-password flow
- Platform-owner MFA / recovery-code login
- Encrypted session storage with `expo-secure-store`
- Reconnecting DeCave WebSocket client
- Home
- Hubs
- Public Hub discovery
- Create/join Hub
- Text Rooms
- Real-time text message sending
- Friends / friend requests
- DMs + real-time DM sending
- Profile + presence status
- Existing no-Hub / skip-first-Hub behavior naturally supported
- Android/iOS app identifiers prepared for store builds

## Phase 2 (next)

- Mobile voice Rooms with WebRTC
- native microphone/audio routing
- mute / deafen / PTT
- background voice behavior
- push notifications
- attachment/image picker
- profile/avatar upload

## Phase 3

- camera/video
- screen sharing
- deep links from notifications/email
- App Store / Play Store submission metadata and screenshots

## Backend change included with this package

Replace the complete root backend files from the package:

- `worker/index.ts`
- `worker/db.ts`
- `worker/HubRoom.ts`

Only `worker/index.ts` has new behavior, but the complete backend trio is included so you never need to merge snippets.

The backend adds:

1. `/mobile/turnstile`
2. `/mobile/turnstile-bridge.js`
3. `sessionToken` in successful auth responses when `client: "mobile"` is supplied.

The token is an existing `decave_sessions` token. No new table or migration is required. Mobile stores it in the OS secure credential store and sends it as `Authorization: Bearer ...`.

## First run

### 1. Deploy mobile backend support

From the project root:

```powershell
cd .
npm run build:web
npm run cf:deploy
```

### 2. Install mobile dependencies

```powershell
cd mobile
npm install
npm run typecheck
```

### 3. Android from Windows

If Android Studio / Android SDK is installed:

```powershell
npm run android
```

This creates the native Android development build locally.

Or use an Expo/EAS development build:

```powershell
npx eas-cli@latest login
npm run eas:android:dev
```

Then start Metro:

```powershell
npm start
```

### iPhone / iPad on a Mac

Requirements:

- A Mac with the latest stable Xcode and Xcode Command Line Tools
- Node.js 20 or newer
- An Apple ID signed into Xcode
- The iPad connected by USB for the first installation

From the repository root, run:

```bash
cd mobile
npm ci
npm run typecheck
npx expo prebuild --platform ios
npm run ios:device
```

Choose the connected iPad when Expo asks. If signing needs attention, open
`mobile/ios/DeCave.xcworkspace` in Xcode, select the DeCave target, open
Signing & Capabilities, select your Team, and keep automatic signing enabled.

On the iPad, enable Developer Mode under Settings > Privacy & Security, restart
when prompted, and trust the Mac/developer certificate if iPadOS asks. Keep the
Mac and iPad on the same network while using the development build and Metro.

After the native app is installed, start Metro from `mobile` with:

```bash
npm start
```

For a standalone signed test build through Expo instead:

```bash
npx eas-cli@latest login
npm run eas:ios:dev
```

A free Apple ID can install development builds directly from Xcode, but its
provisioning expires quickly. Apple Developer Program membership is recommended
for stable device distribution and is required for TestFlight/App Store release.

Voice/video WebRTC is included. iOS screen sharing goes through the ReplayKit
Broadcast Upload Extension in `targets/broadcast` (bundle id
`com.example.decave.broadcast`, App Group `group.com.example.decave`). The
extension streams JPEG frames over a socket in the App Group to
react-native-webrtc's ScreenCapturer; `RTCAppGroupIdentifier` and
`RTCScreenSharingExtension` in `app.json` connect the two. The Apple Developer
account needs that bundle id registered with the App Group capability before
signing. `modules/decave-screen-broadcast` reports when the broadcast starts or
stops, and `src/components/IosBroadcastPicker.tsx` opens the system sheet.
`plugins/withWebRtcScreenShare` patches Android only.

Voice rooms on iOS start on the earpiece (CallKit's default). The Speaker
button in the voice controls panel uses `modules/decave-audio-route` to move playback to
the loudspeaker; headphones and Bluetooth take priority.

## Important security behavior

DeCave currently enforces one active account session/client. Signing into mobile can sign the same account out on desktop/web, matching the existing DeCave security policy.

Turnstile remains server-verified. Native apps cannot run Turnstile directly, so Cloudflare's documented native-mobile pattern is used: a WebView loads a Turnstile page from `app.de-cave.com`, then only the resulting token is sent to the native login request.

Never store passwords, MFA secrets or recovery codes in the mobile app.
