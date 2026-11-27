// CloudFront Function (cloudfront-js-2.0), viewer request on the default behaviour.
// 1. Sends www.footprintz.fyi/<path>?<query> to https://footprintz.fyi/<path>?<query>
//    with a permanent redirect.
// 2. Folder addresses (Pachinko, Phase 3): /pachinko gets a permanent redirect to
//    /pachinko/, and any other path ending in "/" (except "/" itself, which
//    default_root_object covers) is served from that folder's index.html.
// Every other request passes through unchanged.

// queryString: rebuild the query string; a key can repeat (?a=1&a=2), which
// CloudFront gives as multiValue.
function queryString(querystring) {
    var parts = [];
    for (var key in querystring) {
        var entry = querystring[key];
        var values = entry.multiValue ? entry.multiValue : [entry];
        for (var i = 0; i < values.length; i++) {
            parts.push(values[i].value === "" ? key : key + "=" + values[i].value);
        }
    }
    return parts.length ? "?" + parts.join("&") : "";
}

// redirect: a permanent redirect to the given address
function redirect(location) {
    return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: {
            location: { value: location },
            "cache-control": { value: "max-age=3600" },
        },
    };
}

function handler(event) {
    var request = event.request;
    var host = request.headers.host ? request.headers.host.value : "";
    var uri = request.uri;

    if (host.indexOf("www.") === 0) {
        return redirect("https://" + host.substring(4) + uri + queryString(request.querystring));
    }

    if (uri === "/pachinko") {
        return redirect("/pachinko/" + queryString(request.querystring));
    }

    if (uri.length > 1 && uri.charAt(uri.length - 1) === "/") {
        request.uri = uri + "index.html";
    }

    return request;
}
