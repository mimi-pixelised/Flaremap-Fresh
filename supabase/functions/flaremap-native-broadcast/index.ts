// Deploy separately from the existing Web Push function:
//   supabase functions deploy flaremap-native-broadcast
// Set FIREBASE_SERVICE_ACCOUNT_JSON as a Supabase secret, NEVER in client JS.
// This endpoint publishes one notification to all opted-in native app devices.
import { createClient } from "npm:@supabase/supabase-js@2";

const TOPIC = "flaremap-alerts-v1";
const CHANNEL = "flaremap_alarm_v1";
const SOUND_IOS = "flaremap_alarm.wav";
const SOUND_ANDROID = "flaremap_alarm"; // Android raw resource basename.
const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store"
};

function respond(status: number, data: unknown) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function firebaseAccessToken(serviceAccount: {
  client_email: string;
  private_key: string;
  project_id: string;
}) {
  const pem = serviceAccount.private_key.replace(
    /-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, ""
  );
  const keyBytes = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const header = base64Url(encoder.encode(JSON.stringify({
    alg: "RS256", typ: "JWT"
  })));
  const payload = base64Url(encoder.encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600
  })));
  const unsigned = header + "." + payload;
  const signature = new Uint8Array(await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)
  ));
  const assertion = unsigned + "." + base64Url(signature);
  const authResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const result = await authResponse.json();
  if (!authResponse.ok || !result.access_token) {
    throw new Error("Firebase OAuth credential exchange failed");
  }
  return String(result.access_token);
}

Deno.serve(async request => {
  if (request.method !== "POST") {
    return respond(405, { error: "POST required" });
  }
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer (.+)$/i.exec(authorization);
  if (!match) return respond(401, { error: "Sign-in required" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return respond(503, { error: "Supabase environment is incomplete" });
  }

  // Independently verify the caller. Never trust a public admin flag or the
  // five-tap UI to authorize the broadcast.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: auth, error: authError } =
    await adminClient.auth.getUser(match[1]);
  if (authError || !auth.user || auth.user.is_anonymous) {
    return respond(401, { error: "Valid administrator login required" });
  }
  const { data: admin, error: adminError } = await adminClient
    .from("admin_users")
    .select("id").eq("id", auth.user.id).maybeSingle();

  if (adminError) return respond(500, { error: "Admin lookup failed" });
  if (!admin) return respond(403, { error: "Administrators only" });

  let body: { action?: string };
  try { body = await request.json(); }
  catch { return respond(400, { error: "Invalid JSON" }); }
  if (body?.action !== "broadcast") {
    return respond(400, { error: "Expected action: broadcast" });
  }

  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) return respond(503, { error: "Firebase credentials not configured" });

  try {
    const account = JSON.parse(raw);
    if (!account.project_id || !account.client_email || !account.private_key) {
      return respond(503, { error: "Firebase service account is incomplete" });
    }
    const token = await firebaseAccessToken(account);
    const now = new Date().toISOString();
    const payload = {
      message: {
        topic: TOPIC,
        notification: {
          title: "FlareMap alarm",
          body: "A monitoring alarm has been triggered. Open FlareMap for details."
        },
        data: { kind: "flaremap-alarm", created_at: now },
        android: {
          priority: "HIGH",
          notification: {
            channel_id: CHANNEL,
            sound: SOUND_ANDROID,
            default_vibrate_timings: true
          }
        },
        apns: {
          headers: { "apns-push-type": "alert", "apns-priority": "10" },
          payload: {
            aps: { sound: SOUND_IOS }
          }
        }
      }
    };
    const fcmResponse = await fetch(
      "https://fcm.googleapis.com/v1/projects/" +
      encodeURIComponent(account.project_id) + "/messages:send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      }
    );
    if (!fcmResponse.ok) {
      const detail = await fcmResponse.text();
      console.error("FCM send failed", fcmResponse.status, detail.slice(0, 500));
      return respond(502, {
        error: "Firebase rejected the alert",
        status: fcmResponse.status
      });
    }
    const result = await fcmResponse.json();
    // A message name means FCM accepted the TOPIC broadcast, not that
    // all phone devices played it. Topic broadcasts do not report a count.
    return respond(200, {
      accepted: true,
      provider: "FCM topic",
      message: result.name,
      topic: TOPIC,
      note: "Provider acceptance does not confirm per-device delivery"
    });
  } catch (error) {
    console.error("Native broadcast failed", error);
    return respond(502, { error: "Native broadcast failed" });
  }
});
