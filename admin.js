const panel = document.createElement("section");
panel.className = "panel";
panel.id = "admin-panel";
panel.hidden = true;
panel.style.marginTop = "20px";

panel.innerHTML = `
  <h2>Administrator</h2>
  <form id="admin-form">
    <label for="admin-email">Email</label>
    <input id="admin-email" type="email" autocomplete="username"
      required style="display:block;width:100%;padding:12px;
      margin:8px 0 16px;border:1px solid #ccc;border-radius:8px">

    <label for="admin-password">Password</label>
    <input id="admin-password" type="password"
      autocomplete="current-password" required
      style="display:block;width:100%;padding:12px;
      margin:8px 0 16px;border:1px solid #ccc;border-radius:8px">

    <button id="admin-submit" type="submit" disabled>Sign in</button>
  </form>
  <button id="admin-logout" type="button" hidden>Sign out</button>
  <p id="admin-status" role="status">Loading login…</p>
`;

// Keep the entire administrator panel out of the document until unlocked.
// A hidden attribute alone is not sufficient if older JavaScript gets cached.
window.flaremapAdminPanel = panel;

const form = panel.querySelector("#admin-form");
const submit = panel.querySelector("#admin-submit");
const logout = panel.querySelector("#admin-logout");
const status = panel.querySelector("#admin-status");
const password = panel.querySelector("#admin-password");

// Five consecutive clicks/taps of the header logo reveal the login panel.
// This is a UI shortcut only: Supabase authentication and admin_users checks
// remain responsible for authorization.
const brandTrigger = document.getElementById("brand-trigger");
let logoTaps = 0;
let lastLogoTap = 0;

brandTrigger?.addEventListener("click", () => {
  const now = performance.now();
  logoTaps = now - lastLogoTap > 5000 ? 1 : logoTaps + 1;
  lastLogoTap = now;
  if (logoTaps < 5) return;

  logoTaps = 0;
  const open = !panel.isConnected;
  if (open) {
    document.querySelector("main").appendChild(panel);
    panel.hidden = false;
    panel.inert = false;
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    const focusTarget = form.hidden ? logout : panel.querySelector("#admin-email");
    focusTarget?.focus({ preventScroll: true });
  } else {
    panel.hidden = true;
    panel.inert = true;
    panel.remove();
  }
  brandTrigger.setAttribute("aria-expanded", String(open));
});

async function setupLogin() {
  try {
    const config = window.FLAREMAP_CONFIG;
    if (!config?.SUPABASE_URL || !config?.SUPABASE_PUBLISHABLE_KEY) {
      throw new Error("Missing settings. Check that config.js is uploaded.");
    }

    const { createClient } = await import(
      "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    );

    const client = createClient(
      config.SUPABASE_URL,
      config.SUPABASE_PUBLISHABLE_KEY
    );

window.flaremapClient = client;
window.dispatchEvent(new Event("flaremap-ready"));

    async function checkAdministrator(user) {
      const { data, error } = await client
        .from("admin_users")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      form.hidden = true;
      logout.hidden = false;

      status.textContent = data
        ? "Signed in as administrator. Login is working."
        : "Signed in, but this account is not on the administrator list.";
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      status.textContent = "Signing in…";

      try {
        const { data, error } = await client.auth.signInWithPassword({
          email: panel.querySelector("#admin-email").value.trim(),
          password: password.value
        });

        if (error) throw error;
        password.value = "";
        logout.hidden = false;
        await checkAdministrator(data.user);
      } catch (error) {
        status.textContent = error.message || "Sign-in failed.";
      } finally {
        submit.disabled = false;
      }
    });

    logout.addEventListener("click", async () => {
      logout.disabled = true;
      try {
        const { error } = await client.auth.signOut();
        if (error) throw error;
        form.hidden = false;
        logout.hidden = true;
        password.value = "";
        status.textContent = "Signed out.";
      } catch (error) {
        status.textContent = error.message || "Sign-out failed.";
      } finally {
        logout.disabled = false;
      }
    });

    const { data, error } = await client.auth.getSession();
    if (error) throw error;

    if (data.session) {
      logout.hidden = false;
      await checkAdministrator(data.session.user);
    } else {
      status.textContent = "Sign in with the account you created in Supabase.";
    }

    submit.disabled = false;
  } catch (error) {
    status.textContent = error.message || "Could not load login.";
  }
}

setupLogin();