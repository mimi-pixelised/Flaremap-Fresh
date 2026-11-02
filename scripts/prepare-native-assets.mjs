// Converts the existing user-supplied MP3 into native 10-second notification
// audio. Run AFTER 'npx cap add android' and 'npx cap add ios'.
import { existsSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = process.cwd();
const source = join(root, "audio", "alarm.mp3");

function ffmpeg(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    throw new Error("ffmpeg failed. Install ffmpeg or check the source audio.");
  }
}

if (!existsSync(source)) throw new Error("Missing audio/alarm.mp3");
await mkdir(join(root, "assets"), { recursive: true });
// @capacitor/assets needs a large icon; upscale existing logo as a starter.
ffmpeg(["-i", join(root, "icons", "flaremap-512.png"),
  "-vf", "scale=1024:1024:flags=lanczos", "-frames:v", "1",
  join(root, "assets", "logo.png")]);

const nativeSoundArgs = ["-stream_loop", "-1", "-i", source,
  "-t", "10", "-ac", "1", "-ar", "22050",
  "-c:a", "pcm_s16le"];

const androidOut = join(root, "android", "app", "src", "main", "res", "raw");
if (existsSync(join(root, "android"))) {
  await mkdir(androidOut, { recursive: true });
  ffmpeg([...nativeSoundArgs, join(androidOut, "flaremap_alarm.wav")]);
  console.log("Android: sound ready under res/raw/flaremap_alarm.wav");
}

const iosOut = join(root, "ios", "App", "App");
if (existsSync(join(root, "ios"))) {
  await mkdir(iosOut, { recursive: true });
  ffmpeg([...nativeSoundArgs, join(iosOut, "flaremap_alarm.wav")]);
  console.log("iOS: flaremap_alarm.wav prepared.");
  console.log("IMPORTANT: In Xcode, add ios/App/App/flaremap_alarm.wav to the App target");
  console.log("and verify App > Build Phases > Copy Bundle Resources includes it.");
}
if (!existsSync(join(root, "android")) && !existsSync(join(root, "ios"))) {
  console.log("Created assets/logo.png. Generate native platforms first with npx cap add.");
}
