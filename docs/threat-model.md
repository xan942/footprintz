# Footprintz — Threat Model

**Scope:** the live static site at `footprintz.fyi` (including `www` and the
IPv4-only `ipv4` endpoint), the data API under `/api/*` and its database table, and
the accounts and tools that control them.
**Out of scope until built:** an origin server, admin dashboard and invite-only area.
Each gets a section here when it ships.
**Last reviewed:** 2026-11-21

## 1. System overview

```
Visitor ─► DNS (DNSSEC-signed) ─► CloudFront (flat-rate plan, WAF)
                                     ├─ /       ─► S3 bucket (private; only CloudFront can read)
                                     ├─ /ip     ─► edge function (echoes the visitor's IP)
                                     └─ /api/*  ─► serverless function (signed by CloudFront) ─► database table
Page ─► ipv4.footprintz.fyi ─► second CloudFront distribution (IPv6 off) ─► same edge function

Administrator ─► AWS single sign-on (MFA) ─► infrastructure-as-code / CLI ─► AWS
              └─► scoped DNS API token ─► DNS provider
```

Everything the visitor sees is computed in their own browser. The site stores
nothing about visitors: no cookies, no accounts, no analytics, no access logs. The only
stored data is what a player deliberately submits to the game scoreboard: three
initials and a score, plus the server's time.

## 2. Assets

| Asset | Why it matters |
|---|---|
| Visitors' privacy | The site's whole point is showing a footprint, never collecting one. A leak breaks its promise |
| Site integrity | Tampered JavaScript could fingerprint visitors for someone else or attack their browsers |
| The domain | Whoever controls DNS controls the site, its certificates and its reputation |
| The AWS account | Can change the bucket, the distributions and the bill |
| The DNS provider account and API token | Control DNS |
| Infrastructure state and its passphrase | Map of every resource; losing the passphrase means losing the state |
| The source repository | Source of truth for the code; a push to the main branch deploys the site |
| Scoreboard data | Should hold only what players submit, and stay readable |
| The API function's role | Its permissions are what an attacker would get by breaking the function |
| Availability and cost | The site should stay up without running up a bill |

## 3. Threat actors

| Actor | Likely goal | Realistic? |
|---|---|---|
| Automated scanners and bots | Find leaked secrets (`/.env`, `/.git/config`), known vulnerabilities | **Seen**: probes began within hours of the certificate appearing in Certificate Transparency logs |
| Opportunistic attacker | Take over the domain, an account or a dangling DNS record | Medium |
| Supply-chain attacker | Poison a dependency, CI action or provider | Low (the site has no dependencies; the API uses only the cloud provider's own libraries) |
| Flooder / denial of wallet | Take the site down or run up costs | Low impact (flat-rate plan; the API's capacity is capped) |
| Score cheater | Post fake high scores or offensive initials | **Likely** once the game is public |
| Malicious website | Read a visitor's `/ip` answer or frame the site | Low |
| Targeted attacker | Personal interest in this site | Unlikely |

## 4. Entry points and trust boundaries

1. **Public HTTPS** to both distributions: every request passes the WAF first.
2. **Visitor's browser:** the page treats its own inputs (user agent, IP addresses) as untrusted text.
3. **DNS:** the DNS provider account, registrar and API token.
4. **AWS control plane:** single sign-on, the root user, CLI sessions.
5. **Code path:** admin workstation → source repository → CI pipeline (a push to the main branch) → S3. The API's code is built on the admin workstation and shipped by the infrastructure tool.
6. **Local secrets:** infrastructure state, its passphrase, API tokens.
7. **Data API** (`/api/*`): JSON over HTTPS through CloudFront only. The function's own
   URL refuses any call that CloudFront hasn't signed.

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

### Data API and database

| Threat | Mitigation | Status |
|---|---|---|
| Direct calls that skip CloudFront and the WAF | The function URL requires a signed request; only the site's distribution may invoke it (origin access control) | ✅ |
| Request flood / denial of wallet | At most 5 copies of the function run at once; fixed table capacity with no auto scaling (extra requests get `503`); the per-IP rate limit; flat-rate plan | ✅ |
| Injection | No query is built from input text: typed SDK calls with a fixed partition key | ✅ |
| Malformed or oversized input | Exactly two fields accepted (3 letters A–Z, a whole-number score within a cap); body at most 1 KB; JSON content type required | ✅ |
| Forged high scores | The game runs in the browser, so any score can be forged; the cap and the rate limit only bound the junk | ⚠️ |
| Offensive initials | Not filtered yet | ⚠️ |
| Error details leak | Short fixed error messages; full errors only in the function's logs (kept 14 days) | ✅ |
| Personal data in scores | Stores initials, score and server time only: no IP address, user agent or cookie | ✅ |
| Over-privileged function | Its role can only read and add rows in one table and write its own logs: no update, delete or scan | ✅ |
| Accidental table deletion | Deletion protection on the table | ✅ |
| Stale or shared answers from a cache | Every answer is `no-store`, and CloudFront caching is off for `/api/*` | ✅ |
| A refused API call shows the site's HTML "not found" page | The distribution-wide error page also rewrites the API's `403`s; reveals nothing, but clients must expect non-JSON answers | ⚠️ |

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
| Malicious dependency in the API | Only the cloud provider's own Go modules, pinned with checksums | ✅ |
| Tampered infrastructure providers | Provider lock file pins versions and checksums | ✅ |
| Secrets committed to git | Secret scanner as a pre-commit hook; state and plan files ignored by git; full-history scan before any change in repo visibility | ✅ |
| Theft of the infrastructure state | State encrypted with a passphrase, kept only on an encrypted admin workstation | ✅ |
| Hijacked CI action or deploy credentials | Short-lived OIDC credentials (no stored keys), trusted only from the main branch of this repository, limited to this bucket and distribution; actions pinned to commit SHAs | ✅ |
| Source host account takeover | Phishing-resistant 2FA, recovery codes kept offline | ✅ |

## 6. OWASP Top 10:2025 mapping

| Category | Where it applies |
|---|---|
| A01 Broken Access Control | Bucket policy; CORS on `/ip`; signed-only function URL; least-privilege function role |
| A02 Security Misconfiguration | **The most likely failure for a static site.** Bucket policy, headers, DNS records; checked by infrastructure drift checks and header scanners |
| A03 Software Supply Chain Failures | Provider lock file; CI action pinning; Go module checksums |
| A04 Cryptographic Failures | TLS policy, HSTS, encrypted state |
| A05 Injection | XSS: CSP and no HTML injection points; API: no queries built from input |
| A06 Insecure Design | Privacy model: everything computed in the browser; the API stores only what a player submits |
| A07 Authentication Failures | Admin side only: MFA everywhere; no visitor logins |
| A08 Software or Data Integrity Failures | Deploy path |
| A09 Security Logging and Alerting Failures | Audit trail, cost and budget alerts; API function logs |
| A10 Mishandling of Exceptional Conditions | `/ip` failures degrade gracefully; blocked requests get a static page that reveals nothing; the API answers fixed errors and `503` when throttled |

## 7. Review triggers

Revisit this document when:
- a new component ships (origin server, admin or invite-only area), or the API gains a route or table;
- a new subdomain, third-party service or dependency is added;
- a credential is rotated or an account's sign-in method changes;
- an incident or near-miss happens.
