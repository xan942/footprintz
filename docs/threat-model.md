# Footprintz — Threat Model

**Scope:** the live static site at `footprintz.fyi` (including `www` and the
IPv4-only `ipv4` endpoint) and the accounts and tools that control it.
**Out of scope until built:** an origin server, API, database, admin dashboard and
invite-only area. Each gets a section here when it ships.
**Last reviewed:** 2026-11-12

## 1. System overview

```
Visitor ─► DNS (DNSSEC-signed) ─► CloudFront (flat-rate plan, WAF)
                                     ├─ /     ─► S3 bucket (private; only CloudFront can read)
                                     └─ /ip   ─► edge function (echoes the visitor's IP)
Page ─► ipv4.footprintz.fyi ─► second CloudFront distribution (IPv6 off) ─► same edge function

Administrator ─► AWS single sign-on (MFA) ─► infrastructure-as-code / CLI ─► AWS
              └─► scoped DNS API token ─► DNS provider
```

Everything the visitor sees is computed in their own browser. The site stores
nothing about visitors: no cookies, no accounts, no analytics, no access logs.

## 2. Assets

| Asset | Why it matters |
|---|---|
| Visitors' privacy | The site's whole point is showing a footprint, never collecting one. A leak breaks its promise |
| Site integrity | Tampered JavaScript could fingerprint visitors for someone else or attack their browsers |
| The domain | Whoever controls DNS controls the site, its certificates and its reputation |
| The AWS account | Can change the bucket, the distributions and the bill |
| The DNS provider account and API token | Control DNS |
| Infrastructure state and its passphrase | Map of every resource; losing the passphrase means losing the state |
| The source repository | Source of truth for the code, and the future deploy source |
| Availability and cost | The site should stay up without running up a bill |

## 3. Threat actors

| Actor | Likely goal | Realistic? |
|---|---|---|
| Automated scanners and bots | Find leaked secrets (`/.env`, `/.git/config`), known vulnerabilities | **Seen**: probes began within hours of the certificate appearing in Certificate Transparency logs |
| Opportunistic attacker | Take over the domain, an account or a dangling DNS record | Medium |
| Supply-chain attacker | Poison a dependency, CI action or provider | Low (no runtime dependencies) |
| Flooder / denial of wallet | Take the site down or run up costs | Low impact (flat-rate plan) |
| Malicious website | Read a visitor's `/ip` answer or frame the site | Low |
| Targeted attacker | Personal interest in this site | Unlikely |

## 4. Entry points and trust boundaries

1. **Public HTTPS** to both distributions: every request passes the WAF first.
2. **Visitor's browser:** the page treats its own inputs (user agent, IP addresses) as untrusted text.
3. **DNS:** the DNS provider account, registrar and API token.
4. **AWS control plane:** single sign-on, the root user, CLI sessions.
5. **Code path:** admin workstation → source repository → (later) CI pipeline → S3.
6. **Local secrets:** infrastructure state, its passphrase, API tokens.

## 5. Threats and mitigations

Status: ✅ mitigated · ⚠️ accepted risk · 🔜 planned

### Domain and DNS

| Threat | Mitigation | Status |
|---|---|---|
| Domain hijack through the DNS provider account | Phishing-resistant 2FA (passkey) on the account and its sign-in provider | ✅ |
| Domain expires and is re-registered | Auto-renew and registrar lock | ✅ |
| Forged DNS answers | DNSSEC | ✅ |
| A rogue certificate authority issues a certificate | CAA records allow only the two CAs in use; no wildcard certificates | ✅ |
| Spoofed mail sent as the domain | Null MX, SPF `-all`, DMARC `p=reject`, null DKIM key | ✅ |
| DNS API token leak | Token limited to one zone and DNS edits, with an expiry date; kept in a password manager and never written to disk or the command line | ✅ |
| Dangling DNS (subdomain takeover) on teardown | Infrastructure code removes DNS records before the resources they point to; CloudFront refuses an alias without a valid certificate for it | ✅ |

### AWS account

| Threat | Mitigation | Status |
|---|---|---|
| Stolen admin login | Single sign-on with MFA on every sign-in and short sessions; no long-lived access keys | ✅ |
| Root misuse | Root has MFA and no access keys; workload accounts have no root credentials | ✅ |
| Resources created where nobody looks | Organization policy limits which regions can be used | ✅ |
| Unnoticed changes | Organization-wide audit trail with log file validation | ✅ |
| Surprise bill | Monthly budget with alerts, cost anomaly alerts, Free Tier alerts | ✅ |

### Site content and delivery

| Threat | Mitigation | Status |
|---|---|---|
| Direct access to or tampering with the bucket | Bucket private, public access blocked, ACLs off; only the site's distribution can read it; TLS required; only the admin role can write | ✅ |
| Cross-site scripting (XSS) | No third-party scripts; no `innerHTML`, `eval` or inline code; enforced CSP with `default-src 'none'` and `script-src 'self'` | ✅ |
| Clickjacking (site framed by another page) | CSP `frame-ancestors 'none'` | ✅ |
| Downgrade or interception | HTTP → HTTPS redirect; HSTS for 2 years including subdomains; TLS 1.2+ only | ✅ |
| MIME sniffing, referrer leaks, powerful browser features | `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` denying camera, microphone, location, payment and USB | ✅ |
| Another site reads a visitor's `/ip` answer | CORS allows only the site's own origin; answers are never cached | ✅ |
| Error pages (404, WAF blocks) carry no security headers | Static pages with no scripts; CloudFront doesn't run response functions on error responses | ⚠️ |
| `server: AmazonS3` header reveals the backend | No version number; low value to an attacker | ⚠️ |

### Availability and cost

| Threat | Mitigation | Status |
|---|---|---|
| Traffic flood / denial of wallet | Flat-rate plan with no overage charges; per-IP rate limit; AWS Shield Standard; S3 doesn't bill for outsiders' denied requests | ✅ |
| WAF blocks real visitors (false positives) | The IP reputation list targets botnets, not VPN or Tor users; Tor testing pending | 🔜 |
| `/ip` fails | The report shows the line as pending or "none"; the art and other lines still work | ✅ |

### Code, supply chain and secrets

| Threat | Mitigation | Status |
|---|---|---|
| Malicious dependency in the site | Nothing to poison: no package manager, no libraries, no vendored JavaScript | ✅ |
| Tampered infrastructure providers | Provider lock file pins versions and checksums | ✅ |
| Secrets committed to git | Secret scanner as a pre-commit hook; state and plan files ignored by git; full-history scan before any change in repo visibility | ✅ |
| Theft of the infrastructure state | State encrypted with a passphrase, kept only on an encrypted admin workstation | ✅ |
| Hijacked CI action or deploy credentials | Planned: short-lived OIDC credentials (no stored keys), trusted only from the main branch, limited to this bucket and distribution, actions pinned to commit SHAs | 🔜 |
| Source host account takeover | Phishing-resistant 2FA, recovery codes kept offline | ✅ |

## 6. OWASP Top 10:2025 mapping

| Category | Where it applies |
|---|---|
| A01 Broken Access Control | Bucket policy; CORS on `/ip` |
| A02 Security Misconfiguration | **The most likely failure for a static site.** Bucket policy, headers, DNS records; checked by infrastructure drift checks and header scanners |
| A03 Software Supply Chain Failures | Provider lock file; CI action pinning |
| A04 Cryptographic Failures | TLS policy, HSTS, encrypted state |
| A05 Injection | XSS: CSP and no HTML injection points |
| A06 Insecure Design | Privacy model: nothing stored, everything computed in the browser |
| A07 Authentication Failures | Admin side only: MFA everywhere; no visitor logins |
| A08 Software or Data Integrity Failures | Deploy path |
| A09 Security Logging and Alerting Failures | Audit trail, cost and budget alerts |
| A10 Mishandling of Exceptional Conditions | `/ip` failures degrade gracefully; blocked requests get a static page that reveals nothing |

## 7. Review triggers

Revisit this document when:
- a new component ships (origin server, API, database, admin or invite-only area);
- a new subdomain, third-party service or dependency is added;
- a credential is rotated or an account's sign-in method changes;
- an incident or near-miss happens.
