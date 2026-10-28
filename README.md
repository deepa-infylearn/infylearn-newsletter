# Newsletter — self-hosted on listmonk + Postal

A self-hosted replacement for Mailchimp-style newsletters with no third-party email service:

- [listmonk](https://github.com/knadh/listmonk) (AGPL-3.0) manages subscriber lists with double opt-in, website signup forms, campaign editing and scheduling, open/click analytics and one-click unsubscribe.
- [Postal](https://github.com/postalserver/postal) (MIT) is our own mail server. It signs messages with DKIM, delivers them, and handles bounces and suppression.

**Production setup: see [DEPLOY.md](DEPLOY.md).**

This folder adds:

- `compose.yaml`: listmonk v6.2.0 + PostgreSQL 17, plus Mailpit (a local test inbox) under the `dev` profile
- `postal/compose.local.yaml`: a local Postal 3.3.7 stack for testing the full chain (listmonk → Postal → Mailpit)
- `postal/provision.rb`: creates Postal's organization, mail server, sending domain and SMTP credential, and prints the DNS records to publish
- `scripts/setup.js`: creates the API user, sets the sender, SMTP and unsubscribe-header settings, and creates the double opt-in **Newsletter** list. Prints the signup form to embed on websites.
- `scripts/plan-issues.js`: creates draft campaigns for the next issues on the 1st and 15th of each month (listmonk has no recurring campaigns)
- `scripts/import-subscribers.js`: imports a CSV/TXT, optionally screening every address through the Email Checker app first

See [EVALUATION.md](EVALUATION.md) for why listmonk was chosen over Plunk.

## Requirements

- Docker with Docker Compose
- Node 20.6+ (for the helper scripts; no npm packages needed)

## Quick start (local, test inbox)

```bash
cp .env.example .env          # then set DB_PASSWORD and LISTMONK_ADMIN_PASSWORD
docker compose --profile dev up -d
npm run setup                 # creates the API user (token saved to .env), settings and the list
npm run plan-issues           # drafts for the next 4 issues (1st and 15th)
```

- Admin UI: http://127.0.0.1:9000/admin (log in with `LISTMONK_ADMIN_USER` / `LISTMONK_ADMIN_PASSWORD`)
- Test inbox: http://127.0.0.1:8025. With the default `.env` every email lands here, so nothing reaches real people.

`npm run setup` is safe to re-run after changing `.env` (for example, switching SMTP to production).

### Optional: test the full chain through Postal locally

```bash
docker compose -f compose.yaml -f postal/compose.local.yaml --profile dev up -d
docker compose -f compose.yaml -f postal/compose.local.yaml exec \
  -e POSTAL_ADMIN_EMAIL=admin@local.test -e POSTAL_ADMIN_PASSWORD=local-admin-pass-123 \
  -e SENDING_DOMAIN=news.local.test -e SKIP_DOMAIN_VERIFICATION=true \
  postal-web bundle exec rails runner /opt/postal/provision.rb
```

Put the printed SMTP settings into `.env`, with `SMTP_HOST=postal-smtp` and `FROM_EMAIL=... <newsletter@news.local.test>`, then run `npm run setup` again. Campaigns now go listmonk → Postal (http://127.0.0.1:5000) → Mailpit, which shows Postal's DKIM signature and return path. Locally the domain's DNS can't be checked, so Postal signs with its fallback key instead of `d=news.local.test`.

## Twice-a-month workflow

1. `npm run plan-issues` creates drafts named `Newsletter — 1 Nov 2026`, `Newsletter — 15 Nov 2026`, … with the send time pre-filled (`ISSUE_DAYS`, `ISSUE_TIME`, `TZ`). Re-running skips issues that already exist. Pass a number for more issues: `npm run plan-issues -- 6`.
2. An editor opens the draft in **Campaigns**, writes the content (rich text, Markdown, HTML or the visual builder) and sends a test to themselves.
3. The editor clicks **Schedule**. listmonk sends it at the planned time to *confirmed* subscribers only.
4. Afterwards, **Campaigns → Analytics** shows views, clicks and bounces.

Drafts are never scheduled automatically, so placeholder content can't go out by mistake.

## Getting subscribers

- **Website signup:** `npm run setup` prints an HTML form to paste into any website. Signups get a confirmation email (double opt-in) and are only mailed after they confirm. The hosted page `<ROOT_URL>/subscription/form` works too.
- **Existing list:** `npm run import -- subscribers.csv`. The file can have a header row with `email` (and optionally `name`), or just one email per line. Duplicates are removed.
  - With `EMAIL_CHECKER_URL` / `EMAIL_CHECKER_USER` / `EMAIL_CHECKER_PASSWORD` set, addresses that the Email Checker marks invalid, or that use a disposable provider, are skipped. This keeps bounces low, which protects sender reputation.
  - Imported people get a confirmation email by default. Add `--preconfirm` only for people who already opted in elsewhere.

## Look and feel (Infylearn theme)

`theme/admin.css` restyles the listmonk admin: a structured sidebar, a card-based layout, cleaner tables and status pills, and Infylearn branding. `theme/public.css` restyles the pages people see: login, signup form, confirmation and unsubscribe. Both use listmonk's built-in **Settings → Appearance**, so listmonk upgrades don't overwrite them.

```bash
npm run theme                                # applies both stylesheets through the API
node scripts/apply-theme.js --build-only     # only writes theme/dist/ (no API token needed)
```

`theme/public.js` adds a **← Back** button to the subscribe, archive and login pages. listmonk has none, so without it visitors need the browser's back button. It only appears when the visitor came from another page on the same site.

To apply by hand, paste `theme/dist/admin.css` into **Settings → Appearance → Admin**, and `theme/dist/public.css` and `theme/dist/public.js` into the CSS and JS boxes under **Appearance → Public**, then save. Use the `dist` admin file, not `theme/admin.css`: listmonk loads custom CSS before its own, so the build step raises every selector's specificity.

To change the brand colour, edit `--brand` (and `--brand-hover`, `--brand-soft`) at the top of both files and re-run. To use a real logo on the public pages, set **Settings → General → Logo URL**.

## Going to production

Follow [DEPLOY.md](DEPLOY.md). It covers server checks (port 25, PTR, blocklists), DNS records, the official Postal install, HTTPS, provisioning, connecting listmonk, deliverability testing, warm-up and backups. Afterwards, change the email template (**Campaigns → Templates**) to the company branding.

## Configuration (`.env`)

| Variable | Purpose |
| --- | --- |
| `DB_PASSWORD` | PostgreSQL password |
| `LISTMONK_ADMIN_USER` / `LISTMONK_ADMIN_PASSWORD` | Super admin, created on the very first start only |
| `TZ` | Time zone for listmonk and the issue schedule |
| `LISTMONK_URL` | Where the scripts reach listmonk |
| `LISTMONK_API_USER` / `LISTMONK_API_TOKEN` | API credentials; `npm run setup` creates them if the token is empty |
| `ROOT_URL` | Public base URL used in email links |
| `FROM_EMAIL` | Default sender, e.g. `Infylearn Newsletter <newsletter@yourcompany.com>` |
| `LIST_NAME` | Name of the newsletter list |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_AUTH` (`none`/`plain`/`login`/`cram`), `SMTP_TLS` (`none`/`STARTTLS`/`TLS`) | Mail delivery (for Postal: `cram`, see DEPLOY.md) |
| `ISSUE_DAYS`, `ISSUE_TIME` | Issue schedule, default `1,15` at `10:00` |
| `EMAIL_CHECKER_URL`, `EMAIL_CHECKER_USER`, `EMAIL_CHECKER_PASSWORD` | Optional import screening |

## Licensing

Postal is MIT licensed. listmonk is AGPL-3.0. Running it unmodified for our own newsletters is fine. If we modify listmonk itself and offer it to others over a network, those changes must be published. The scripts here only talk to its API.
