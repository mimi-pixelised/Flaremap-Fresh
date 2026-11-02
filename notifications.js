const panel = document.createElement("section");
panel.className = "panel";
panel.style.marginTop = "20px";
panel.innerHTML = `
  <h2>Notifications</h2>
  <p>Enable notifications on each device that should receive alerts.</p>
  <button id="push-enable" disabled>Enable notifications</button>
  <button id="push-disable" disabled>Disable notifications</button>
  <button id="push-send" hidden>Send alarm to subscribed devices</button>
  <p id="push-status" role="status">Loading notification controls…</p>
  <p>One click enables push and prepares the 10-second alarm while FlareMap
  is open. Testing is optional. Browsers may require another interaction
  after reloading before custom alarm sound can play.</p>
`;

document.querySelector("main").appendChild(panel);

const enable = document.getElementById("push-enable");
const disable = document.getElementById("push-disable");
const send = document.getElementById("push-send");
const status = document.getElementById("push-status");

// Keep privileged broadcast controls inside the detached administrator panel.
// Never leave the broadcast button visible in the public notification section.
if (window.flaremapAdminPanel) {
  window.flaremapAdminPanel.appendChild(send);
} else {
  send.remove();
  console.warn("Administrator controls are unavailable on this page.");
}

const SOUND_PREF_KEY = "flaremap-sound-enabled";
let soundEnabled = false;
try {
  soundEnabled = localStorage.getItem(SOUND_PREF_KEY) === "yes";
} catch {}
const seen = new Set();

// The user's preference persists, but Web Audio autoplay permission may not.
// Re-arm audio on the next ordinary interaction after a page reload.
function rearmSound() {
  if (!soundEnabled) return;
  try {
    Promise.resolve(window.flaremapUnlockSound?.()).catch(() => {});
  } catch {}
}
document.addEventListener("pointerdown", rearmSound, { passive: true });
document.addEventListener("keydown", rearmSound);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", event => {
    if (event.data?.type !== "FLAREMAP_ALARM") return;

    const alert = event.data.alert;
    const timestamp = Date.parse(alert?.created_at);
    const age = Date.now() - timestamp;

    if (!alert?.id || !Number.isFinite(age) ||
        age < -30000 || age > 60000 || seen.has(alert.id)) return;

    seen.add(alert.id);
    status.textContent = alert.body || "An alarm was received.";

    const testButton = document.getElementById("test");
    if (soundEnabled && document.visibilityState === "visible" &&
        window.flaremapAudioReady?.() && !testButton.disabled) {
      testButton.click();
    }
  });
}

async function startNotifications(client) {
  // On iOS, Web Push is exposed only in installed Home Screen web apps.
  // iPadOS can report a desktop-style Mac user agent.
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const installedApp = window.matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true;

  if (appleMobile && !installedApp) {
    status.textContent =
      "iPhone/iPad setup: Share → Add to Home Screen. " +
      "Open FlareMap using the new Home Screen icon, " +
      "then tap Enable notifications here.";
    return;
  }

  if (!("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)) {
    status.textContent =
      appleMobile
        ? "Push is unavailable here. Use iOS 16.4 or later and open FlareMap from its Home Screen icon."
        : "Push is unavailable in this browser. Try Safari on Mac, Chrome or Edge on Android/desktop.";
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const registration = await navigator.serviceWorker.ready;

    const key = window.FLAREMAP_CONFIG?.VAPID_PUBLIC_KEY;
    if (!key) throw new Error("VAPID_PUBLIC_KEY is missing from config.js.");
    const padded = key + "=".repeat((4 - key.length % 4) % 4);
    const vapidBytes = Uint8Array.from(
      atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
      character => character.charCodeAt(0)
    );

    async function callServer(body) {
      const { data, error } = await client.functions.invoke(
        "flaremap-notifications",
        { body }
      );

      if (error) {
        let message = error.message;
        try {
          const details = await error.context.json();
          message = details.error || message;
        } catch {}
        throw new Error(message);
      }

      if (data?.error) throw new Error(data.error);
      return data;
    }

    async function updateAdministrator() {
      send.hidden = true;

      const { data: sessionData } = await client.auth.getSession();
      const user = sessionData.session?.user;
      if (!user || user.is_anonymous) return;

      const { data, error } = await client
        .from("admin_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (!error && data) send.hidden = false;
    }

    client.auth.onAuthStateChange(() => {
      setTimeout(() => {
        updateAdministrator().catch(() => { send.hidden = true; });
      }, 0);
    });

    enable.onclick = async () => {
      enable.disabled = true;
      status.textContent = "Enabling push notifications and alarm sound…";

      try {
        if (Notification.permission === "denied") {
          throw new Error("Notifications are blocked in browser settings.");
        }

        // Both operations start inside the same real click: Safari requires
        // pushManager.subscribe() to be directly initiated by a user gesture.
        // No permission or authentication awaits are allowed before this.
        let soundSupported = Boolean(window.flaremapUnlockSound);
        if (soundSupported) {
          try {
            Promise.resolve(window.flaremapUnlockSound()).catch(() => {});
          } catch {
            soundSupported = false;
          }
        }
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidBytes
        });

        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          const { error: signInError } =
            await client.auth.signInAnonymously();
          if (signInError) throw signInError;
        }

        await callServer({
          action: "subscribe",
          subscription: subscription.toJSON()
        });

        soundEnabled = soundSupported;
        try {
          localStorage.setItem(SOUND_PREF_KEY, soundEnabled ? "yes" : "no");
        } catch {}

        const provider = new URL(subscription.endpoint).hostname;
        const soundStatus = !soundSupported
          ? "Custom sound is unavailable in this browser."
          : window.flaremapAudioReady?.()
            ? "The open-page alarm sound is ready."
            : "Open-page sound may need one more interaction after a reload.";
        status.textContent =
          `Push enabled (${provider}). ${soundStatus}`;
      } catch (error) {
        console.error("FlareMap notification enable failed:", error);
        const macAdvice = /Macintosh/.test(navigator.userAgent)
          ? " On Mac, also check the browser's site permissions and " +
            "System Settings > Notifications."
          : "";
        status.textContent =
          (error.message || "Could not enable notifications.") + macAdvice;
      } finally {
        enable.disabled = false;
      }
    };

    disable.onclick = async () => {
      disable.disabled = true;
      try {
        const subscription = await registration.pushManager.getSubscription();

        if (subscription) {
          // Stop browser delivery even if the old account is signed out.
          await subscription.unsubscribe();

          try {
            await callServer({
              action: "unsubscribe",
              endpoint: subscription.endpoint
            });
          } catch {}
        }

        soundEnabled = false;
        try {
          localStorage.removeItem(SOUND_PREF_KEY);
        } catch {}
        status.textContent = "Notifications and open-page alarm sound disabled.";
      } catch (error) {
        status.textContent = error.message;
      } finally {
        disable.disabled = false;
      }
    };

    send.onclick = async () => {
      send.disabled = true;
      status.textContent = "Sending alarm…";

      try {
        const result = await callServer({ action: "broadcast" });
        status.textContent =
          `Push services accepted ${result.accepted} notification(s); ` +
          `${result.failed} failed. Acceptance does not confirm device delivery.`;
      } catch (error) {
        status.textContent = error.message || "Could not send the alarm.";
      } finally {
        send.disabled = false;
      }
    };

    enable.disabled = false;
    disable.disabled = false;
    const existingSubscription = await registration.pushManager.getSubscription();
    status.textContent = existingSubscription && Notification.permission === "granted"
      ? "This browser has a push subscription. Use Enable to register it again if alerts do not arrive."
      : "Ready. Enable notifications on this device.";
    await updateAdministrator();
  } catch (error) {
    status.textContent = error.message || "Notification setup failed.";
  }
}

let started = false;

function connectNotifications() {
  if (started || !window.flaremapClient) return;
  started = true;
  startNotifications(window.flaremapClient);
}

window.addEventListener("flaremap-ready", connectNotifications);
connectNotifications();