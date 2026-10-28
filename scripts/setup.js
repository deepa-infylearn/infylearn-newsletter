// One-time (and safe to re-run) setup: API user, sender + SMTP settings, and the newsletter list.
const fs = require("fs");
const path = require("path");
const { api, findList, BASE_URL } = require("./listmonk");

const ENV_PATH = path.join(__dirname, "..", ".env");
const env = process.env;
const ROOT_URL = (env.ROOT_URL || BASE_URL).replace(/\/+$/, "");
const LIST_NAME = env.LIST_NAME || "Newsletter";

function cookieHeader(response, jar) {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(";");
    const [name, value] = pair.split("=");
    jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

// listmonk only issues API tokens to "API" users, which are created from an admin session.
async function createApiUser() {
  const { LISTMONK_ADMIN_USER: adminUser, LISTMONK_ADMIN_PASSWORD: adminPassword } = env;
  if (!adminUser || !adminPassword) {
    throw new Error("LISTMONK_API_TOKEN is empty and LISTMONK_ADMIN_USER / LISTMONK_ADMIN_PASSWORD are not set.");
  }
  const jar = new Map();
  const loginPage = await fetch(`${BASE_URL}/admin/login`);
  let cookies = cookieHeader(loginPage, jar);
  const nonce = (await loginPage.text()).match(/name="nonce" value="([^"]+)"/)?.[1];
  if (!nonce) throw new Error("Could not read the listmonk login form.");

  const login = await fetch(`${BASE_URL}/admin/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
    body: new URLSearchParams({ username: adminUser, password: adminPassword, nonce, next: "/admin" })
  });
  if (login.status !== 302) throw new Error("Admin login failed; check LISTMONK_ADMIN_USER / LISTMONK_ADMIN_PASSWORD.");
  cookies = cookieHeader(login, jar);

  const session = (method, apiPath, body) => fetch(`${BASE_URL}/api${apiPath}`, {
    method,
    headers: { Cookie: cookies, "Content-Type": "application/json" },
    body: body && JSON.stringify(body)
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${method} ${apiPath} failed (${r.status}): ${data.message || ""}`);
    return data.data;
  });

  const roles = await session("GET", "/roles/users");
  const superAdmin = roles.find((role) => role.permissions.includes("settings:manage"));
  const username = env.LISTMONK_API_USER || "automation";
  const user = await session("POST", "/users", {
    username, name: "Automation scripts", type: "api", status: "enabled", user_role_id: superAdmin.id
  });

  const contents = fs.readFileSync(ENV_PATH, "utf8");
  const line = `LISTMONK_API_TOKEN=${user.password}`;
  fs.writeFileSync(ENV_PATH, /^LISTMONK_API_TOKEN=.*$/m.test(contents)
    ? contents.replace(/^LISTMONK_API_TOKEN=.*$/m, line)
    : `${contents.trimEnd()}\n${line}\n`);
  env.LISTMONK_API_USER = username;
  env.LISTMONK_API_TOKEN = user.password;
  console.log(`Created API user "${username}" and saved its token to .env`);
}

async function waitForApi() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return await api("GET", "/lists?per_page=1");
    } catch (err) {
      if (err.status === 403 || err.status === 401) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`listmonk did not respond at ${BASE_URL}`);
}

async function configureSettings() {
  const settings = await api("GET", "/settings");
  const [current = {}] = settings.smtp;
  settings["app.root_url"] = ROOT_URL;
  if (env.FROM_EMAIL) settings["app.from_email"] = env.FROM_EMAIL;
  // Adds List-Unsubscribe / one-click unsubscribe headers, which Gmail and Yahoo require for bulk senders.
  settings["privacy.unsubscribe_header"] = true;
  settings.smtp = [{
    ...current,
    name: "primary",
    enabled: true,
    host: env.SMTP_HOST || "mailpit",
    port: Number(env.SMTP_PORT || 1025),
    auth_protocol: env.SMTP_AUTH || "none",
    username: env.SMTP_USERNAME || "",
    // An empty value keeps the password already stored in listmonk.
    password: env.SMTP_PASSWORD || current.password || "",
    tls_type: env.SMTP_TLS || "none"
  }];
  await api("PUT", "/settings", settings);
  // listmonk reloads itself after a settings change.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  await waitForApi();
  console.log(`Settings saved: root URL ${ROOT_URL}, SMTP ${settings.smtp[0].host}:${settings.smtp[0].port}`);
}

async function ensureList() {
  let list = await findList(LIST_NAME);
  if (list) {
    console.log(`List "${LIST_NAME}" already exists (id ${list.id})`);
  } else {
    list = await api("POST", "/lists", {
      name: LIST_NAME,
      type: "public",
      optin: "double",
      tags: ["newsletter"],
      description: "Twice-monthly newsletter"
    });
    console.log(`Created public double opt-in list "${LIST_NAME}" (id ${list.id})`);
  }
  return list;
}

async function main() {
  if (!env.LISTMONK_API_TOKEN) await createApiUser();
  await waitForApi();
  await configureSettings();
  const list = await ensureList();

  console.log(`
Admin UI:           ${BASE_URL}/admin
Subscription page:  ${ROOT_URL}/subscription/form
List UUID:          ${list.uuid}

Embed this form on the website:

<form method="post" action="${ROOT_URL}/subscription/form">
  <input type="hidden" name="nonce" />
  <input type="email" name="email" required placeholder="you@example.com" />
  <input type="text" name="name" placeholder="Name (optional)" />
  <input type="hidden" name="l" value="${list.uuid}" />
  <button type="submit">Subscribe</button>
</form>`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
