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
  <p>For sound while this page is open, first press the existing
  “Test 10-second alarm” button. Repeat after reloading the page.</p>
`;

document.querySelector("main").appendChild(panel);

const enable = document.getElementById("push-enable");
const disable = document.getElementById("push-disable");
const send = document.getElementById("push-send");
const status = document.getElementById("push-status");

let soundEnabled = false;
const seen = new Set();

document.getElementById("test").addEventListener("click", event => {
  if (event.isTrusted) soundEnabled = true;
});

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
        !testButton.disabled) {
      testButton.click();
    }
  });
}

async function startNotifications(client) {
  if (!("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)) {
    status.textContent =
      "Push is unavailable here. Try Chrome or Edge on your computer first.";
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    const registration = await navigator.serviceWorker.ready;

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
      status.textContent = "Setting up notifications…";

      try {
        // Ask permission directly from the user's button click.
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          throw new Error("Notifications were not allowed in this browser.");
        }

        const { data, error } = await client.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          const { error: signInError } =
            await client.auth.signInAnonymously();
          if (signInError) throw signInError;
        }

        const key = window.FLAREMAP_CONFIG.VAPID_PUBLIC_KEY;
        if (!key) throw new Error("VAPID_PUBLIC_KEY is missing from config.js.");

        const padded = key + "=".repeat((4 - key.length % 4) % 4);
        const bytes = Uint8Array.from(
          atob(padded.replace(/-/g, "+").replace(/_/g, "/")),
          character => character.charCodeAt(0)
        );

        let subscription = await registration.pushManager.getSubscription();

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: bytes
          });
        }

        await callServer({
          action: "subscribe",
          subscription: subscription.toJSON()
        });

        status.textContent = "Notifications enabled on this device.";
      } catch (error) {
        status.textContent = error.message || "Could not enable notifications.";
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

        status.textContent = "Notifications disabled on this device.";
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
    status.textContent = "Ready. Enable notifications on this device.";
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