# Newsletter platform evaluation: listmonk vs Plunk

**Requirement:** send website newsletters twice a month using an open-source, self-hosted solution instead of a service like Mailchimp.

**Recommendation: listmonk.** It is built specifically for newsletters, works with any email delivery provider (or our own mail server), and was tested end to end locally. Plunk is not a good fit because its self-hosted version sends only through Amazon SES, so it does not remove the vendor dependency.

## Comparison

| | listmonk | Plunk |
| --- | --- | --- |
| Purpose | Newsletter and mailing-list manager | Email platform for transactional email, campaigns and automations |
| License | AGPL-3.0 | AGPL-3.0 |
| Maturity | v6.2.0 stable (v7 in beta), ~24k GitHub stars, actively maintained | v0.17 (pre-1.0), ~5.6k stars, actively maintained |
| Email delivery | **Any SMTP server**: SES, Brevo, Postmark, or a self-hosted mail server; several can run at once | **Amazon SES only** in the self-hosted setup (AWS keys required) |
| Infrastructure | 1 app + PostgreSQL | App + PostgreSQL + Redis + MinIO (S3 storage) + AWS SES |
| Lists, double opt-in, signup forms | Yes | Contacts and segments |
| Campaign editor and templates | Rich text, Markdown, HTML, drag-and-drop builder | Yes |
| Scheduling | Per-campaign send time (no recurring campaigns) | Campaigns + workflow automation |
| Analytics and bounces | Views, clicks, bounces; bounce handling via mailbox or provider webhooks | Opens, clicks, bounces |
| Unsubscribe | Unsubscribe link + one-click `List-Unsubscribe` headers (Gmail/Yahoo requirement) | Yes |
| API | Full API with scoped tokens | Yes |

## What was built and tested (listmonk)

A ready-to-run setup is in this folder (`compose.yaml` and the scripts in `scripts/`). It was tested locally with a test inbox (Mailpit), so no real email was sent:

- Website signup form → confirmation email → subscriber confirmed
- CSV import with each address screened by our Email Checker app first. Non-existent domains, domains that refuse mail and disposable addresses were skipped, and duplicates were removed.
- Draft campaigns created automatically for the 1st and 15th of each month at 10:00 IST
- A campaign sent only to confirmed subscribers, personalised with their first name, with working one-click unsubscribe

## Email delivery: Postal (decided)

We have our own server and domain, so emails are delivered by **Postal** (MIT license, ~17k GitHub stars, v3.3.7), an open-source mail server built for sending from applications. No third-party email service is involved.

Tested locally with listmonk → Postal → test inbox:

- listmonk authenticates to Postal and Postal accepts and delivers the campaign; the delivery log shows "Sent".
- Postal adds a DKIM signature with our sending domain (`d=news.<domain>`) once its DNS check passes, plus its own return path for bounce handling.
- A provisioning script creates Postal's mail server, sending domain and SMTP credential, and prints the exact DNS records to publish.

To go live (step by step in [DEPLOY.md](DEPLOY.md)):

1. **Server check:** outbound port 25 open (many providers block it), at least 4 GB RAM, reverse DNS (PTR) for the server IP, IP not on spam blocklists.
2. **DNS records:** Postal's own records, plus SPF, DKIM, return path and DMARC for the sending domain (we recommend a subdomain such as `news.ourdomain.com` to protect the main domain's email reputation).
3. **Warm-up:** a new IP has no reputation, so start with smaller sends and grow volume over the first few weeks.

Note: listmonk has no built-in "every 2 weeks" campaign. Our `plan-issues` script creates the drafts ahead of time; an editor fills in the content and clicks Schedule.
