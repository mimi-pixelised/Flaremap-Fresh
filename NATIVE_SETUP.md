# FlareMap native iOS + Android setup

**Status: source scaffold, not yet a signed or tested mobile app.** The existing
web dashboard remains deployable as before. This adds a Capacitor 8 project
configuration, a native Firebase Cloud Messaging bridge, and a new Supabase
Edge Function for native-topic broadcasts.

## How native alerts work

- On either phone, **Enable notifications** requests OS permission, obtains an
  FCM registration token, and subscribes to the Firebase topic
  `flaremap-alerts-v1`.
- A verified administrator presses **Send alarm**. The client attempts BOTH
  the old Web Push broadcast and `flaremap-native-broadcast`.
- The new Edge Function verifies the Supabase JWT and checks `admin_users`
  using server-only credentials. It publishes to the FCM topic.
- iOS uses APNs through Firebase; the push payload requests
  `flaremap_alarm.wav` as its notification sound.
- Android uses a HIGH importance notification channel
  `flaremap_alarm_v1` with its packaged custom sound.

The mobile app is an installed app, **not** the Safari Home Screen bookmark.
The website/PWA will still use normal browser push sounds outside the page.
Native notification delivery and sound can still be delayed, suppressed,
silenced, or disabled by the phone. No override of iOS silent mode/Focus is
included; Apple's Critical Alerts entitlement requires separate approval.
**Do not rely on this prototype as a certified fire or CO safety alarm.**

## Prerequisites

- Node.js 22+ and npm, Xcode on a Mac for iOS, Android Studio for Android
- Firebase project with Android/iOS apps, and a Firebase service account
- Apple Developer signing team, iOS push entitlement, APNs key uploaded to
  Firebase Console, and real devices for notification tests
- Supabase CLI access to the existing Supabase project and its admin_users
  table and administrator login
- ffmpeg (used for audio WAV conversion and logo asset generation)

## 1. Install and generate mobile targets

In a fresh clone of the FlareMap repository:

```bash
npm install
# Change com.example.flaremap in capacitor.config.json BEFORE Firebase setup.
npm run native:build
npx cap add android
# On a Mac, for iOS:
npx cap add ios
npm run native:assets
npx @capacitor/assets generate --ios --android
npm run native:sync
```

You can build just Android first on Windows/Linux. On a Mac, build both.

The build copies your original `index.html`, graphs, logo, admin login,
and alarm asset to `www/` and replaces *only* browser notification handling
with the native Firebase bridge. Do not manually change the PWA's JavaScript
to load native plugins; `npm run native:build` creates the native copy.

Note: the native login currently imports Supabase JS from a CDN, so the app
needs internet connectivity. Longer term, bundle Supabase JS locally as well.

## 2. Configure Firebase

1. In `capacitor.config.json` replace the placeholder app ID with your own
   reverse-domain bundle/package ID (e.g. `com.yourteam.flaremap`).
   Do this before running `npx cap add ...`, or update existing native IDs.
2. Register the same Android package name in Firebase. Download
   `google-services.json` into `android/app/google-services.json`.
3. Register the same iOS bundle ID in Firebase. Add
   `GoogleService-Info.plist` to the Xcode App target and make sure it is
   copied into the app bundle.
4. In Firebase Console > Project Settings > Cloud Messaging, upload the
   APNs Authentication Key (.p8) with its Key ID and Apple Team ID.
5. In Xcode, enable **Push Notifications** on the App target, set
   the developer signing team, and test on a real iPhone.
6. For Android, ensure Google Services is applied in the generated Gradle
   project if the Firebase setup or plugin did not configure it. Check the
   plugin's current install instructions for your chosen version.

On iOS, make sure Firebase APNs token registration is wired for the installed
`@capacitor-firebase/messaging` version. If automatic delegate proxying is
disabled, forward APNs registration to Firebase according to its documentation.
No private Firebase *service account* key belongs in either app build.

## 3. Package the custom 10-second audio

`npm run native:assets` generates two `flaremap_alarm.wav` files from the
existing `audio/alarm.mp3` in the repository:

- `android/app/src/main/res/raw/flaremap_alarm.wav`
- `ios/App/App/flaremap_alarm.wav`

**iOS important:** Open `npx cap open ios`. In Xcode use *File > Add Files to
"App"*, select `ios/App/App/flaremap_alarm.wav`, choose the **App** target,
and confirm the WAV is in *Build Phases > Copy Bundle Resources*.
Simply placing it in a folder is NOT sufficient for APNs custom sound.

The script produces a 10-second mono 22.05 kHz PCM WAV, compatible with native
notification sound constraints. The source MP3 currently in GitHub is a
compressed copy of your uploaded recording. For higher fidelity, replace
`audio/alarm.mp3` with the original file that you are permitted to use and
re-run `npm run native:assets`.

If changing Android channel sound later, change the channel ID (Android
preserves sound settings for an existing channel). Your current channel is
`flaremap_alarm_v1`. Users may also change/mute its sound in Settings.

## 4. Deploy the native FCM broadcast server

Create a Firebase **service account** permitted to send FCM messages. Put
its JSON in the **Supabase secret store**, NOT in GitHub, the APK/IPA, the
webpage, or a client configuration file.

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON="$(cat /private/path/service-account.json)"
supabase functions deploy flaremap-native-broadcast
```

The function needs Supabase-provided `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. If your project uses custom deployment
configuration, supply these server-side. The endpoint checks the user's
Supabase access token and verifies membership in `admin_users`.

The FCM HTTP v1 publisher uses one topic broadcast rather than querying a
client-controlled device list. You won't know how many phones played a sound
from a successful FCM topic response; acceptance only means Firebase took
the message. Protect your Supabase administrator credentials.

The existing website's administrator broadcast button is updated to try
both browser-push and native FCM. Until this new Edge Function is deployed,
the web-push part continues to work but the native part reports a failure.

## 5. Build and test on actual phones

```bash
npm run native:sync
npx cap open android
# Mac only
npx cap open ios
```

After Firebase and signing setup, install via Android Studio/Xcode.
On each phone press **Enable notifications** and allow OS permission. Then:

1. Send a test from the hidden administrator panel (tap logo five times).
2. Verify a notification with sound while the recipient app is open.
3. Put the recipient app in background and switch apps; send again.
4. Lock the recipient phone; send again.
5. Force-close the app and test again. iOS and Android delivery rules differ.
6. Test silent mode, Focus/Do Not Disturb, Bluetooth audio routing,
   notification categories/channels, and low-power modes. These can suppress
   sounds despite FCM accepting a send.

The built-in Test alarm button still uses HTML audio while the app is open.
**Native push alert sound** is instead supplied by iOS/Android from the
bundled `flaremap_alarm.wav`, with no WebView execution required on a
backgrounded phone.

## Known limits

- Native build targets and distributable APK/IPA cannot be produced without
  npm dependencies, SDKs, Firebase project credentials, and Apple signing.
- This code does not set up physical sensors. Dashboard readings remain
  simulated; broadcasting an alert remains a manual admin action.
- Do not add `FIREBASE_SERVICE_ACCOUNT_JSON` or .p8 APNs private keys
  to version control. The Firebase Android/iOS *client configs* are distinct.
- If the native app is uninstalled or notifications are declined, it won't
  receive sound alerts. OS-level alert sound override is not guaranteed.

References: https://capacitorjs.com/docs/getting-started
https://capawesome.io/docs/sdks/capacitor/firebase/cloud-messaging/
https://developer.apple.com/documentation/usernotifications/unnotificationsound
https://firebase.google.com/docs/cloud-messaging/send/v1-api
