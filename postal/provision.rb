# frozen_string_literal: true

# Sets up Postal for the newsletter and prints the DNS records to publish. Safe to re-run.
# Run inside a Postal container with: bundle exec rails runner /opt/postal/provision.rb
#
# Creates (or reuses): admin user, organization, "Live" mail server, sending domain and an SMTP
# credential for listmonk.
#
#   POSTAL_ADMIN_EMAIL / POSTAL_ADMIN_PASSWORD  admin login for the Postal web UI (created if missing)
#   SENDING_DOMAIN                              domain in the newsletter From address, e.g. news.ourdomain.com
#   POSTAL_ORG / POSTAL_SERVER                  names (default "Infylearn" / "Newsletter")
#   SKIP_DOMAIN_VERIFICATION=true               local testing only: mark the domain verified without DNS

admin_email = ENV.fetch("POSTAL_ADMIN_EMAIL")
domain_name = ENV.fetch("SENDING_DOMAIN").downcase
org_name = ENV.fetch("POSTAL_ORG", "Infylearn")
server_name = ENV.fetch("POSTAL_SERVER", "Newsletter")

user = User.find_by(email_address: admin_email)
unless user
  user = User.create!(
    first_name: "Postal", last_name: "Admin", email_address: admin_email,
    password: ENV.fetch("POSTAL_ADMIN_PASSWORD"), admin: true, email_verified_at: Time.now
  )
  puts "Created admin user #{admin_email}"
end

org = Organization.find_by(name: org_name)
unless org
  org = Organization.create!(name: org_name, permalink: Organization.find_unique_permalink(org_name), owner: user)
  org.organization_users.create!(user: user, admin: true, all_servers: true)
  puts "Created organization #{org_name}"
end

server = org.servers.find_by(name: server_name)
unless server
  server = org.servers.create!(name: server_name, permalink: server_name.parameterize, mode: "Live")
  puts "Created mail server #{org_name} / #{server_name}"
end

domain = server.domains.find_by(name: domain_name)
unless domain
  domain = server.domains.create!(name: domain_name, verification_method: "DNS", owner: server)
  puts "Added sending domain #{domain_name}"
end
domain.mark_as_verified if ENV["SKIP_DOMAIN_VERIFICATION"] == "true"

credential = server.credentials.find_by(type: "SMTP", name: "listmonk") ||
             server.credentials.create!(type: "SMTP", name: "listmonk")

config = Postal::Config
puts <<~TEXT

  SMTP settings for listmonk (.env):
    SMTP_HOST=#{config.postal.smtp_hostname}   (or host.docker.internal when listmonk runs on the same server)
    SMTP_PORT=25
    SMTP_AUTH=cram
    SMTP_USERNAME=#{org.permalink}/#{server.permalink}
    SMTP_PASSWORD=#{credential.key}
    SMTP_TLS=none
    FROM_EMAIL=Newsletter <newsletter@#{domain_name}>

  DNS records for the sending domain #{domain_name}:
    #{domain_name.ljust(45)} TXT    #{domain.dns_verification_string}
    #{domain_name.ljust(45)} TXT    #{domain.spf_record}
    #{"#{domain.dkim_record_name}.#{domain_name}".ljust(45)} TXT    #{domain.dkim_record}
    #{domain.return_path_domain.ljust(45)} CNAME  #{config.dns.return_path_domain}
    #{"_dmarc.#{domain_name}".ljust(45)} TXT    v=DMARC1; p=none; rua=mailto:dmarc@#{domain_name}

  Domain verified: #{domain.verified? ? 'yes' : 'no (add the records above, then click Verify in the Postal UI)'}
TEXT
