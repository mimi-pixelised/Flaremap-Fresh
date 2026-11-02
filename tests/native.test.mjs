import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("Capacitor native platform and FCM sound settings are consistent", async () => {
  const config = JSON.parse(await read("capacitor.config.json"));
  const app = await read("native/native-push.js");
  const server = await read("supabase/functions/flaremap-native-broadcast/index.ts");
  assert.equal(config.webDir, "www");
  assert.equal(config.plugins.FirebaseMessaging.presentationOptions.includes("sound"), true);
  assert.match(app, /const TOPIC = "flaremap-alerts-v1"/);
  assert.match(server, /const TOPIC = "flaremap-alerts-v1"/);
  assert.match(app, /const CHANNEL = "flaremap_alarm_v1"/);
  assert.match(server, /const CHANNEL = "flaremap_alarm_v1"/);
  assert.match(server, /const SOUND_IOS = "flaremap_alarm\.wav"/);
  assert.match(app, /const SOUND = "flaremap_alarm\.wav"/);
  assert.match(server, /admin_users/);
  assert.match(server, /getUser\(match\[1\]\)/);
  assert.doesNotMatch(server, /SERVICE_ROLE_KEY.*console\.log/);
});

test("Native web build preserves web dashboard and swaps only push frontend", async () => {
  const html = await read("index.html");
  const build = await read("scripts/build-native.mjs");
  assert.match(html, /brand-trigger/);
  assert.match(html, /charts\.js/);
  assert.match(build, /native-push\.bundle\.js/);
  assert.match(build, /notifications\\\.js/);
});

test("Sound preparation script generates Android and iOS packaged WAV files", async () => {
  const sound = await read("scripts/prepare-native-assets.mjs");
  assert.match(sound, /flaremap_alarm\.wav/);
  assert.match(sound, /-t", "10"/);
  assert.match(sound, /-c:a", "pcm_s16le"/);
});
