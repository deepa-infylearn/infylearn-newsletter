# Production deployment: listmonk + Postal on our server

listmonk manages subscribers and campaigns. Postal is our own open-source mail server (MIT): it signs each message with DKIM, delivers it to Gmail, Outlook and others, and handles bounces. Nothing goes through a third-party email service.

```
listmonk (newsletter.ourdomain.com) --SMTP--> Postal (postal.ourdomain.com) --port 25--> recipients' mail servers
```

Replace these placeholders everywhere below:

| Placeholder | Meaning |
| --- | --- |
| `ourdomain.com` | Our domain |
| `SERVER_IP` | The server's public IPv4 address |
| `postal.ourdomain.com` | Postal admin UI and mail server hostname |
| `newsletter.ourdomain.com` | listmonk admin UI, signup and unsubscribe pages |
| `news.ourdomain.com` | Sending domain: newsletters come from `newsletter@news.ourdomain.com`. A subdomain keeps newsletter reputation separate from the company's normal email. |

## 0. Check the server first

Postal recommends a server with at least **4 GB RAM, 2 CPUs and 25 GB disk**. listmonk adds little on top. Ubuntu 22.04/24.04 is assumed.

```bash
# 1. Outbound port 25 must be open (many providers block it; ask support to unblock if this fails)
timeout 5 bash -c '</dev/tcp/gmail-smtp-in.l.google.com/25' && echo "port 25 open" || echo "port 25 BLOCKED"

# 2. Ports 25, 80 and 443 must be free (if 80/443 are used by an existing Nginx, see "Existing Nginx" below)
sudo ss -tlnp | grep -E ':(25|80|443) '
```

3. Check that `SERVER_IP` is not on a spam blocklist: https://mxtoolbox.com/blacklists.aspx
4. In the hosting provider's panel, set the **reverse DNS (PTR)** of `SERVER_IP` to `postal.ourdomain.com`. Many receivers reject mail from IPs without a matching PTR.

## 1. DNS records for Postal

| Name | Type | Value |
| --- | --- | --- |
| `postal.ourdomain.com` | A | `SERVER_IP` |
| `newsletter.ourdomain.com` | A | `SERVER_IP` |
| `spf.postal.ourdomain.com` | TXT | `v=spf1 ip4:SERVER_IP ~all` |
| `rp.postal.ourdomain.com` | A | `SERVER_IP` |
| `rp.postal.ourdomain.com` | MX | `10 postal.ourdomain.com` |
| `rp.postal.ourdomain.com` | TXT | `v=spf1 a mx include:spf.postal.ourdomain.com ~all` |
| `routes.postal.ourdomain.com` | MX | `10 postal.ourdomain.com` |
| `postal._domainkey.rp.postal.ourdomain.com` | TXT | output of `postal default-dkim-record` (step 2) |

The sending domain's records come later, in step 4.

## 2. Install Postal (official installer)

```bash
# Docker, git, jq and the Postal helper (official prerequisite steps)
sudo apt-get update && sudo apt-get install -y ca-certificates curl git jq
curl -fsSL https://get.docker.com | sudo sh
sudo git clone https://github.com/postalserver/install /opt/postal/install
sudo ln -s /opt/postal/install/bin/postal /usr/bin/postal

# MariaDB for Postal (choose a strong password and keep it safe)
sudo docker run -d --name postal-mariadb -p 127.0.0.1:3306:3306 --restart always \
  -e MARIADB_DATABASE=postal -e MARIADB_ROOT_PASSWORD='STRONG_DB_PASSWORD' \
  -v postal-mariadb:/var/lib/mysql mariadb:11.4 --innodb-log-file-size=256M

# Generate config for version 3.3.7 (the version tested with this setup)
sudo postal bootstrap postal.ourdomain.com --version 3.3.7
```

Edit `/opt/postal/config/postal.yml`:

- `main_db.password` and `message_db.password`: the MariaDB password above
- `dns:` section:

```yaml
dns:
  mx_records:
    - postal.ourdomain.com
  spf_include: spf.postal.ourdomain.com
  return_path_domain: rp.postal.ourdomain.com
  route_domain: routes.postal.ourdomain.com
  track_domain: track.postal.ourdomain.com
```

Then:

```bash
sudo postal initialize
sudo postal start
sudo postal default-dkim-record   # publish this as the postal._domainkey.rp.postal.ourdomain.com TXT record
```

## 3. HTTPS with Caddy

Replace `/opt/postal/config/Caddyfile` with:

```
postal.ourdomain.com {
  reverse_proxy 127.0.0.1:5000
}

newsletter.ourdomain.com {
  reverse_proxy 127.0.0.1:9000
}
```

```bash
sudo docker run -d --name postal-caddy --restart always --network host \
  -v /opt/postal/config/Caddyfile:/etc/caddy/Caddyfile -v /opt/postal/caddy-data:/data caddy:2
```

Caddy fetches the certificates automatically once DNS points at the server.

**Existing Nginx:** if Nginx already serves websites on 80/443, skip Caddy and add two `server` blocks that `proxy_pass` to `http://127.0.0.1:5000` (Postal) and `http://127.0.0.1:9000` (listmonk), with certificates from your usual certbot workflow.

## 4. Create the newsletter mail server, domain and SMTP credential

Copy `postal/provision.rb` from this project to `/opt/postal/config/provision.rb`, then:

```bash
sudo postal dc run --rm \
  -e POSTAL_ADMIN_EMAIL=you@ourdomain.com -e POSTAL_ADMIN_PASSWORD='STRONG_ADMIN_PASSWORD' \
  -e SENDING_DOMAIN=news.ourdomain.com \
  runner bundle exec rails runner /config/provision.rb
```

It creates the Postal admin user, the "Infylearn" organization, the "Newsletter" mail server, the `news.ourdomain.com` domain and an SMTP credential for listmonk. It prints:

- the **SMTP settings** for listmonk's `.env` (step 5)
- the **DNS records for `news.ourdomain.com`**: verification TXT, SPF TXT, DKIM TXT, the `psrp` return-path CNAME and a starter DMARC TXT. Add them all.
  - If `news.ourdomain.com` already has an SPF record, merge the two. A name can have only one SPF record.

Then log in at https://postal.ourdomain.com → **Infylearn → Newsletter → Domains → news.ourdomain.com**, click **Verify**, and on the DNS page click **Check my records again** until SPF, DKIM and Return Path show OK.

> Until the DKIM check passes, Postal signs mail with its own `rp.postal.ourdomain.com` key, so DMARC will not align and inbox placement suffers. Make sure the DNS page is green before the first send.

Re-running the script is safe; it reuses what exists and prints the settings again.

## 5. Install listmonk

Copy this project to `/opt/newsletter`, then:

```bash
cd /opt/newsletter
cp .env.example .env
```

Set in `.env`:

```
DB_PASSWORD=<strong password>
LISTMONK_ADMIN_USER=admin
LISTMONK_ADMIN_PASSWORD=<strong password>
ROOT_URL=https://newsletter.ourdomain.com
FROM_EMAIL=Infylearn Newsletter <newsletter@news.ourdomain.com>
SMTP_HOST=host.docker.internal
SMTP_PORT=25
SMTP_AUTH=cram
SMTP_USERNAME=<from step 4, e.g. infylearn/newsletter>
SMTP_PASSWORD=<from step 4>
SMTP_TLS=none
```

`cram` matters: listmonk refuses to send a PLAIN password over the unencrypted local connection to Postal. CRAM-MD5 never sends the password itself.

```bash
sudo docker compose up -d   # no "--profile dev": the Mailpit test inbox stays off
# Run the setup script with Node from a container (no Node install needed on the server)
sudo docker run --rm --network host -v "$PWD":/app -w /app node:20-alpine node --env-file=.env scripts/setup.js
```

The setup output includes the signup form to embed on our websites. Admin UI: https://newsletter.ourdomain.com/admin

Apply the Infylearn theme for the admin and public pages:

```bash
sudo docker run --rm --network host -v "$PWD":/app -w /app node:20-alpine node --env-file=.env scripts/apply-theme.js
```

(Or paste `theme/dist/admin.css`, `theme/dist/public.css` and `theme/dist/public.js` into **Settings → Appearance**. See README.)

## 6. Test before the first real issue

1. Add yourself (a Gmail and an Outlook address) to the list and send a test campaign.
2. In Gmail, open the message → **Show original**. **SPF, DKIM and DMARC should all say PASS**, with DKIM `d=news.ourdomain.com`.
3. Send one test to the address shown on https://www.mail-tester.com and aim for 9/10 or better.
4. In Postal → **Messages**, check the delivery log for each recipient.

## 7. Running it

- **Warm-up:** a new server IP has no reputation. For the first few weeks send to engaged subscribers first and avoid sudden large volumes. For larger lists, limit speed under listmonk **Settings → Performance** (sliding window, e.g. a few hundred emails per hour at first).
- **Bounces:** Postal processes bounces and adds hard-bounced addresses to its suppression list, so they are not mailed again.
- **DMARC:** reports go to the `rua` address in the DMARC record. After a few clean weeks, tighten to `p=quarantine`.
- **Monitoring:** check `SERVER_IP` against blocklists monthly, and check Postal's message log after each issue.
- **Backups:** Postal's MariaDB (`docker exec postal-mariadb mariadb-dump -uroot -p --all-databases`), listmonk's Postgres (`docker compose exec db pg_dump -U listmonk listmonk`), and `/opt/postal/config` (contains the signing key).
- **Upgrades:** `sudo postal upgrade <version>` for Postal. For listmonk, change the image tag in `compose.yaml`, then `docker compose up -d` (migrations run automatically).
