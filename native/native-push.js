import { Capacitor } from "@capacitor/core";
import { FirebaseMessaging } from "@capacitor-firebase/messaging";
import { LocalNotifications } from "@capacitor/local-notifications";

if (!Capacitor.isNativePlatform()) {
  throw new Error("Native notification bundle must not load on the PWA");
}

// Topic membership lives in Firebase, not in the browser PushManager.
// This topic is intentionally not confidential: anyone who installs the app
// and opts in can receive public monitoring alerts.
const TOPIC = "flaremap-alerts-v1";
const CHANNEL = "flaremap_alarm_v1";
const SOUND = "flaremap_alarm.wav";
const PREF = "flaremap-native-notifications-opt-in";
const platform = Capacitor.getPlatform();

const panel = document.createElement("section");
panel.className = "panel";
panel.style.marginTop = "20px";
panel.innerHTML = `
  <h2>Native notifications</h2>
  <p>Enable background notifications on this device. Alarm sounds come from
  Android/iOS, including when FlareMap is closed, subject to phone settings.</p>
  <button id="native-enable">Enable notifications</button>
  <button id="native-disable" class="secondary">Disable notifications</button>
  <p id="native-status" role="status">Initializing notifications…</p>
`;
document.querySelector("main").appendChild(panel);

const enable = panel.querySelector("#native-enable");
const disable = panel.querySelector("#native-disable");
const status = panel.querySelector("#native-status");
const send = document.createElement("button");
send.id = "native-send";
send.textContent = "Send alarm to all subscribed devices";
send.hidden = true;
window.flaremapAdminPanel?.appendChild(send);

const setStatus = message => { status.textContent = message; };
const optIn = () => localStorage.getItem(PREF) === "yes";
let client;
let initialized = false;

function requireClient() {
  if (!window.flaremapClient) throw new Error("Supabase client unavailable");
  return window.flaremapClient;
}

async function hasAdminAccess() {
  if (!client) return false;
  const { data: auth, error: authError } = await client.auth.getSession();
  if (authError) throw authError;
  const user = auth.session?.user;
  if (!user || user.is_anonymous) return false;
  const { data, error } = await client.from("admin_users")
    .select("id").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}
async function updateAdminButton() {
  try { send.hidden = !(await hasAdminAccess()); }
  catch { send.hidden = true; }
}

async function nativeChannel() {
  if (platform !== "android") return;
  await FirebaseMessaging.createChannel({
    id: CHANNEL,
    name: "FlareMap emergency alarms",
    description: "Loud monitoring alerts",
    importance: 5,
    vibration: true,
    sound: SOUND,
    visibility: 1
  });
}

async function enroll() {
  const permission = await FirebaseMessaging.requestPermissions();
  if (permission.receive !== "granted") {
    throw new Error("Please allow notifications in your phone settings.");
  }

  // getToken initializes Firebase registration (FCM even on iOS).
  const { token } = await FirebaseMessaging.getToken();
  if (!token) throw new Error("No Firebase token returned. Check Firebase setup.");
  await nativeChannel();
  await FirebaseMessaging.subscribeToTopic({ topic: TOPIC });
  localStorage.setItem(PREF, "yes");
  setStatus("Subscribed. Background alerts will use the phone's notification sound settings.");
}

enable.onclick = async () => {
  enable.disabled = true;
  setStatus("Registering this phone with Firebase…");
  try { await enroll(); }
  catch (error) { setStatus("Couldn't enable: " + (error.message || error)); }
  finally { enable.disabled = false; }
};

disable.onclick = async () => {
  disable.disabled = true;
  try {
    await FirebaseMessaging.unsubscribeFromTopic({ topic: TOPIC });
    localStorage.removeItem(PREF);
    setStatus("Unsubscribed from FlareMap native alarms.");
  } catch (error) {
    setStatus("Couldn't unsubscribe: " + (error.message || error));
  } finally { disable.disabled = false; }
};

async function invoke(functionName, body) {
  const { data, error } = await requireClient().functions.invoke(functionName, { body });
  if (error) {
    let message = error.message;
    try { message = (await error.context.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

send.onclick = async () => {
  send.disabled = true;
  setStatus("Sending alarm to Web Push and native subscribers…");
  try {
    // The two delivery systems are independent. One failure must not
    // prevent the other from being attempted.
    const results = await Promise.allSettled([
      invoke("flaremap-notifications", { action: "broadcast" }),
      invoke("flaremap-native-broadcast", { action: "broadcast" })
    ]);
    const messages = results.map((result, index) => {
      const label = index ? "Native (FCM)" : "Web Push";
      return result.status === "fulfilled"
        ? label + ": accepted"
        : label + ": FAILED (" + result.reason.message + ")";
    });
    setStatus(messages.join(" | ") + ". Acceptance doesn't guarantee delivery.");
  } finally {
    send.disabled = false;
  }
};

async function initialize() {
  if (initialized) return;
  initialized = true;
  client = requireClient();

  await FirebaseMessaging.addListener("tokenReceived", async ({ token }) => {
    if (!token || !optIn()) return;
    try {
      await FirebaseMessaging.subscribeToTopic({ topic: TOPIC });
      setStatus("Firebase registration refreshed.");
    } catch (error) {
      setStatus("Token refreshed; topic re-subscribe failed: " + error.message);
    }
  });

  await FirebaseMessaging.addListener("notificationReceived", async ({ notification }) => {
    setStatus("Alarm received: " + (notification?.title || "FlareMap"));
    if (platform !== "android") return;
    // Android doesn't necessarily show FCM notification payloads while the
    // app is foregrounded. Use a real notification, not WebView audio.
    try {
      await LocalNotifications.schedule({
        notifications: [{
          id: Math.floor(Math.random() * 2147000000) + 1,
          title: notification?.title || "FlareMap",
          body: notification?.body || "A monitoring alarm was triggered.",
          channelId: CHANNEL,
          sound: SOUND
        }]
      });
    } catch (error) {
      setStatus("Foreground notification failed: " + error.message);
    }
  });

  client.auth.onAuthStateChange(() => {
    setTimeout(() => { void updateAdminButton(); }, 0);
  });
  await updateAdminButton();
  try {
    await nativeChannel();
    if (optIn()) {
      const permission = await FirebaseMessaging.checkPermissions();
      if (permission.receive === "granted") {
        // Refresh topic membership on launch, including FCM token rotation.
        await FirebaseMessaging.getToken();
        await FirebaseMessaging.subscribeToTopic({ topic: TOPIC });
        setStatus("Native alerts active on this device.");
      } else {
        setStatus("Please tap Enable notifications to restore permission.");
      }
    } else {
      setStatus("Ready. Enable notifications to receive background alarms.");
    }
  } catch (error) {
    setStatus("Native setup incomplete: " + (error.message || error));
  }
}

window.addEventListener("flaremap-ready", () => { void initialize(); });
if (window.flaremapClient) void initialize();
