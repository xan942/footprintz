// CloudFront Function (cloudfront-js-2.0), viewer response on the default behaviour
// of footprintz.fyi. Adds the security headers to every page and file served from S3.
//
// A function, not a response headers policy: the Free plan allows only AWS-managed
// policies, and the managed SecurityHeadersPolicy has no CSP and still sends the
// obsolete X-XSS-Protection.
//
// Not covered (CloudFront never runs a viewer-response function for them):
//   - responses made by a viewer-request function: /ip on both distributions and the
//     www redirect; ip.js sets its own headers;
//   - error responses, i.e. origin status 400 or higher, which includes /404.html
//     served for a missing file, and WAF blocks.

// Rollout switch: true sends Content-Security-Policy-Report-Only (the browser only
// logs violations to the console); false enforces the policy. Flip to false once the
// checklist passes in every browser with no CSP warnings.
var CSP_REPORT_ONLY = false;

var CSP = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'", // fonts/JetBrainsMono-Regular.woff2; default-src 'none' would block it
    "img-src 'self' data: blob:",
    "connect-src 'self' https://ipv4.footprintz.fyi", // the IPv4 line fetches ipv4.footprintz.fyi/ip
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "upgrade-insecure-requests",
].join("; ");

function handler(event) {
    var headers = event.response.headers;

    headers[CSP_REPORT_ONLY ? "content-security-policy-report-only" : "content-security-policy"] = { value: CSP };
    // Two years, every subdomain; no "preload" (a one-way door, see Phase 5 Step 1).
    headers["strict-transport-security"] = { value: "max-age=63072000; includeSubDomains" };
    headers["x-content-type-options"] = { value: "nosniff" };
    headers["referrer-policy"] = { value: "no-referrer" };
    headers["permissions-policy"] = { value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" };
    headers["cross-origin-opener-policy"] = { value: "same-origin" };
    headers["cross-origin-resource-policy"] = { value: "same-site" };

    return event.response;
}
