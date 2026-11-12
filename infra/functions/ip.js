// CloudFront Function (cloudfront-js-2.0), viewer request on the /ip behaviour.
// Answers with the visitor's public IP as plain text and never reaches the S3 origin.
// The address is only echoed back: nothing here logs or stores it (the Free plan has
// no access logs either). site/js/signals.js reads it for the report's IP line.
function handler(event) {
    return {
        statusCode: 200,
        statusDescription: "OK",
        headers: {
            "content-type": { value: "text/plain; charset=utf-8" },
            // Each visitor gets their own answer: never cache it anywhere.
            "cache-control": { value: "no-store" },
        },
        body: { encoding: "text", data: event.viewer.ip },
    };
}
