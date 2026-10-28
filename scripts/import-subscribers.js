// Imports subscribers from a CSV/TXT file into the newsletter list.
// If EMAIL_CHECKER_URL is set, every address is first screened by the Email Checker app and
// invalid or disposable ones are skipped, which keeps bounces (and sender reputation damage) down.
//
// Usage: npm run import -- subscribers.csv [--preconfirm]
//   --preconfirm  mark subscriptions confirmed (only for people who already opted in elsewhere);
//                 without it listmonk emails each person a double opt-in confirmation.
const fs = require("fs");
const { api, findList } = require("./listmonk");

const LIST_NAME = process.env.LIST_NAME || "Newsletter";
const CHECKER_BATCH = 100;
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i;

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === "," || ch === ";" || ch === "\t") { cells.push(cell.trim()); cell = ""; }
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

// Reads email (and name, if the file has a "name" header) from each row; deduplicates by email.
function readContacts(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const header = parseCsvLine(lines[0] || "").map((h) => h.toLowerCase());
  const hasHeader = header.some((h) => h.includes("email"));
  const nameIndex = hasHeader ? header.findIndex((h) => h === "name" || h === "full name") : -1;
  const contacts = new Map();
  for (const line of hasHeader ? lines.slice(1) : lines) {
    const cells = parseCsvLine(line);
    const email = cells.map((c) => c.match(EMAIL)?.[0]).find(Boolean);
    if (!email || contacts.has(email.toLowerCase())) continue;
    contacts.set(email.toLowerCase(), { email, name: nameIndex >= 0 ? cells[nameIndex] || "" : "" });
  }
  return [...contacts.values()];
}

async function screenWithEmailChecker(contacts) {
  const url = process.env.EMAIL_CHECKER_URL?.replace(/\/+$/, "");
  if (!url) {
    console.log("EMAIL_CHECKER_URL not set; importing without verification.");
    return contacts;
  }
  const auth = Buffer.from(`${process.env.EMAIL_CHECKER_USER}:${process.env.EMAIL_CHECKER_PASSWORD}`).toString("base64");
  const verdicts = new Map();
  for (let i = 0; i < contacts.length; i += CHECKER_BATCH) {
    const emails = contacts.slice(i, i + CHECKER_BATCH).map((c) => c.email);
    process.stdout.write(`Verifying ${i + emails.length}/${contacts.length}…\r`);
    const response = await fetch(`${url}/api/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({ emails })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Email Checker failed (${response.status}): ${data.error || ""}`);
    for (const result of data.results) verdicts.set(String(result.input).toLowerCase(), result);
  }
  console.log("");
  return contacts.filter((contact) => {
    const result = verdicts.get(contact.email.toLowerCase());
    if (result?.misc?.is_disposable === true) {
      console.log(`skipped  ${contact.email}  (disposable email provider)`);
      return false;
    }
    if (result?.is_reachable === "invalid") {
      console.log(`skipped  ${contact.email}  (${result.reason || "invalid"})`);
      return false;
    }
    return true;
  });
}

async function main() {
  const file = process.argv[2];
  const preconfirm = process.argv.includes("--preconfirm");
  if (!file || !fs.existsSync(file)) throw new Error("Usage: npm run import -- subscribers.csv [--preconfirm]");

  const list = await findList(LIST_NAME);
  if (!list) throw new Error(`List "${LIST_NAME}" not found. Run npm run setup first.`);

  const contacts = readContacts(file);
  console.log(`Read ${contacts.length} unique addresses from ${file}`);
  const accepted = await screenWithEmailChecker(contacts);

  const counts = { added: 0, existing: 0, failed: 0 };
  for (const contact of accepted) {
    try {
      await api("POST", "/subscribers", {
        email: contact.email,
        name: contact.name || contact.email.split("@")[0],
        status: "enabled",
        lists: [list.id],
        preconfirm_subscriptions: preconfirm
      });
      counts.added++;
    } catch (err) {
      if (err.status === 409) counts.existing++;
      else { counts.failed++; console.log(`failed   ${contact.email}  (${err.message})`); }
    }
  }
  console.log(`\nAdded ${counts.added}, already existed ${counts.existing}, skipped ${contacts.length - accepted.length}, failed ${counts.failed}.`);
  if (!preconfirm && counts.added) console.log("New subscribers were sent a double opt-in confirmation email.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
