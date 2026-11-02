# FlareMap

A prototype dashboard with simulated temperature, humidity, MQ-5, and MQ-7 readings.

## Custom alarm sound

The 10-second test alarm, and the in-page alarm triggered by a received push message, will use a custom sound when one is available. The original synthesized tone remains as a safe fallback.

The user-provided loud alarm recording is bundled at `audio/alarm.mp3` (compressed mono MP3 for lightweight web delivery) and is enabled by default in `config.js`.

1. Deploy the updated files and reload the app. On a device, use **Enable notifications** or **Test 10-second alarm** to unlock audio playback. Start with the volume low.
2. If you later replace the audio with a higher-quality copy, upload it to `audio/alarm.mp3`; update `ALARM_SOUND_URL` in `config.js` if you use a different path or filename.

The app loads and decodes the file into Web Audio, loops it for up to 10 seconds, and stops it with the existing **Stop alarm** button.

**Web Push limitation:** a closed or backgrounded site cannot reliably play this custom audio. Push notifications use sounds chosen by the operating system and browser, which may be muted or suppressed. Use a dedicated hardware alarm for safety-critical gas or CO detection. No real sensor readings are connected yet.

Only host audio that you have permission to use.
