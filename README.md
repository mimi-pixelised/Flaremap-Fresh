# FlareMap

A prototype dashboard with simulated temperature, humidity, MQ-5, and MQ-7 readings.

## Custom alarm sound

The 10-second test alarm, and the in-page alarm triggered by a received push message, will use a custom sound when one is available. The original synthesized tone remains as a safe fallback.

1. Place an audio file that you are authorized to use in the repository at `audio/alarm.mp3` (preferred MP3 encoding).
2. If you use a different filename/format, update `ALARM_SOUND_URL` in `config.js`.
3. Deploy the updated files and reload the app. On a device, use **Enable notifications** or **Test 10-second alarm** to unlock audio playback. Start with the volume low.

The app loads and decodes the file into Web Audio, loops it for up to 10 seconds, and stops it with the existing **Stop alarm** button.

**Web Push limitation:** a closed or backgrounded site cannot reliably play this custom audio. Push notifications use sounds chosen by the operating system and browser, which may be muted or suppressed. Use a dedicated hardware alarm for safety-critical gas or CO detection. No real sensor readings are connected yet.

A YouTube Shorts URL is not an audio-file URL. Do not copy third-party media without permission; obtain audio you are allowed to host.
