// Small listmonk API client shared by the scripts. Requires Node 20+ (global fetch).
const BASE_URL = (process.env.LISTMONK_URL || "http://127.0.0.1:9000").replace(/\/+$/, "");

async function api(method, path, body) {
  const { LISTMONK_API_USER: user, LISTMONK_API_TOKEN: token } = process.env;
  if (!user || !token) {
    throw new Error("Set LISTMONK_API_USER and LISTMONK_API_TOKEN in .env (or run npm run setup to create them).");
  }
  const response = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: {
      Authorization: `token ${user}:${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!response.ok) {
    const error = new Error(`${method} ${path} failed (${response.status}): ${data.message || text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return data.data;
}

async function findList(name) {
  const page = await api("GET", `/lists?query=${encodeURIComponent(name)}&per_page=all`);
  return (page.results || []).find((list) => list.name === name) || null;
}

module.exports = { api, findList, BASE_URL };
