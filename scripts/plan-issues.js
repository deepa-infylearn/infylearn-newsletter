// Creates draft campaigns for the next N newsletter issues (default: 1st and 15th of each month).
// listmonk has no recurring campaigns, so each issue is its own campaign with send_at pre-filled.
// Drafts are never scheduled automatically: an editor writes the content and clicks "Schedule".
const { api, findList } = require("./listmonk");

const TIME_ZONE = process.env.TZ || "Asia/Kolkata";
const LIST_NAME = process.env.LIST_NAME || "Newsletter";
const DAYS = (process.env.ISSUE_DAYS || "1,15").split(",").map(Number).sort((a, b) => a - b);
const [HOUR, MINUTE] = (process.env.ISSUE_TIME || "10:00").split(":").map(Number);
const COUNT = Number(process.argv[2] || 4);

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month") - 1, day: get("day"), hour: get("hour"), minute: get("minute") };
}

// Converts a wall-clock time in TIME_ZONE to a UTC Date.
function zonedTimeToUtc(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month, day, hour, minute);
  const local = zonedParts(new Date(guess));
  const offset = Date.UTC(local.year, local.month, local.day, local.hour, local.minute) - guess;
  return new Date(guess - offset);
}

function upcomingIssueDates() {
  const dates = [];
  const earliest = Date.now() + 60 * 60 * 1000;
  let { year, month } = zonedParts(new Date());
  while (dates.length < COUNT) {
    for (const day of DAYS) {
      const sendAt = zonedTimeToUtc(year, month, day, HOUR, MINUTE);
      if (sendAt.getTime() > earliest && dates.length < COUNT) dates.push(sendAt);
    }
    month++;
    if (month === 12) { month = 0; year++; }
  }
  return dates;
}

const PLACEHOLDER_BODY = `<h2>Highlights</h2>
<p>Replace this with the main story of this issue.</p>
<h2>Updates</h2>
<ul><li>Update one</li><li>Update two</li></ul>
<p>Thanks for reading!</p>`;

async function main() {
  if (!DAYS.length || DAYS.some((d) => !Number.isInteger(d) || d < 1 || d > 28)) {
    throw new Error("ISSUE_DAYS must be days between 1 and 28, e.g. 1,15");
  }
  if (!Number.isInteger(HOUR) || !Number.isInteger(MINUTE)) throw new Error("ISSUE_TIME must look like 10:00");

  const list = await findList(LIST_NAME);
  if (!list) throw new Error(`List "${LIST_NAME}" not found. Run npm run setup first.`);

  const label = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short", year: "numeric" });
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, dateStyle: "medium", timeStyle: "short" });

  for (const sendAt of upcomingIssueDates()) {
    const name = `${LIST_NAME} — ${label.format(sendAt)}`;
    const existing = await api("GET", `/campaigns?query=${encodeURIComponent(name)}&per_page=all&no_body=true`);
    if ((existing.results || []).some((c) => c.name === name)) {
      console.log(`exists   ${name}`);
      continue;
    }
    const campaign = await api("POST", "/campaigns", {
      name,
      subject: name,
      lists: [list.id],
      type: "regular",
      content_type: "richtext",
      body: PLACEHOLDER_BODY,
      send_at: sendAt.toISOString(),
      tags: ["newsletter"]
    });
    console.log(`created  ${name}  (draft #${campaign.id}, send at ${when.format(sendAt)} ${TIME_ZONE})`);
  }
  console.log("\nOpen each draft in the admin UI, write the content, then click Schedule.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
