// CloudFront Function (cloudfront-js-2.0), viewer request.
// Runs on the /ip behaviour of footprintz.fyi (dual-stack) and on every request to
// ipv4.footprintz.fyi (IPv6 off). Answers /ip with the visitor's public IP as plain
// text and never reaches the S3 origin; any other path gets a 404.
// The address is only echoed back: nothing here logs or stores it (the Free plan has
// no access logs either). site/js/signals.js reads it for the report's IPv4 and IPv6 lines.
function handler(event) {
    if (event.request.uri !== "/ip") {
        return {
            statusCode: 404,
            statusDescription: "Not Found",
            headers: { "content-type": { value: "text/plain; charset=utf-8" } },
            body: { encoding: "text", data: "not found" },
        };
    }

    return {
        statusCode: 200,
        statusDescription: "OK",
        headers: {
            "content-type": { value: "text/plain; charset=utf-8" },
            // Each visitor gets their own answer: never cache it anywhere.
            "cache-control": { value: "no-store" },
            // The site's page fetches ipv4.footprintz.fyi/ip cross-origin; allow only it.
            "access-control-allow-origin": { value: "https://footprintz.fyi" },
        },
        body: { encoding: "text", data: event.viewer.ip },
    };
}
