// CloudFront Function (cloudfront-js-2.0), viewer request on the default behaviour.
// Sends www.footprintz.fyi/<path>?<query> to https://footprintz.fyi/<path>?<query>
// with a permanent redirect; every other request passes through unchanged.
function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : "";

    if (host.indexOf("www.") !== 0) {
        return request;
    }

    // Rebuild the query string; a key can repeat (?a=1&a=2), which CloudFront
    // gives as multiValue.
    var parts = [];
    for (var key in request.querystring) {
        var entry = request.querystring[key];
        var values = entry.multiValue ? entry.multiValue : [entry];
        for (var i = 0; i < values.length; i++) {
            parts.push(values[i].value === "" ? key : key + "=" + values[i].value);
        }
    }
    var query = parts.length ? "?" + parts.join("&") : "";

    return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
            location: { value: "https://" + host.substring(4) + request.uri + query },
            "cache-control": { value: "max-age=3600" },
        },
    };
}
