// signals.js — collects the browser signals that feed the genome (seed.js)
// and the "What they can see" report (report.js).
// Runs only when the visitor clicks Generate. Nothing is sent anywhere: the only
// requests are the ad-blocker check's two empty files, from our own site.
//
// Every signal comes back in the same shape:
//   { value, state, clue }
//   value: what the browser reported (null when hidden)
//   state: "visible" | "hidden" | "spoofed"
//   clue:  one sentence explaining a hidden or spoofed state (null when visible)

// ── Helpers ──────────────────────────────────────────────────────────────

// builds one signal record, so every reader returns the same shape
function signal(value, state, clue) {
    return { value: value, state: state, clue: clue };
}

// SHA-256 of a string, returned as hex text (e.g. "3fa9...")
async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);              // string -> UTF-8 bytes
    const digest = await crypto.subtle.digest("SHA-256", bytes); // browser's built-in hashing
    const array = Array.from(new Uint8Array(digest));          // ArrayBuffer -> plain array of numbers 0-255
    let hex = "";
    for (const byte of array) {
        hex += byte.toString(16).padStart(2, "0");             // each byte -> 2 hex digits ("0a", not "a")
    }
    return hex;
}

// Brave hides itself in the user agent, but adds a navigator.brave object
function isBrave() {
    return navigator.brave !== undefined;
}

// ── OS and browser ───────────────────────────────────────────────────────

// reads an OS name out of a user-agent or navigator.platform string
function osFromString(text) {
    if (/Android/i.test(text)) {        // check before Linux: Android UAs also contain "Linux"
        return "Android";
    }
    if (/iPhone|iPad|iPod/i.test(text)) {
        return "iOS";
    }
    if (/CrOS/i.test(text)) {           // ChromeOS; also before Linux
        return "ChromeOS";
    }
    if (/Win/i.test(text)) {            // "Windows NT 10.0" in the UA, "Win32" in platform
        return "Windows";
    }
    if (/Mac/i.test(text)) {            // "Macintosh" in the UA, "MacIntel" in platform
        return "macOS";
    }
    if (/Linux|X11/i.test(text)) {
        return "Linux";
    }
    return null;                        // nothing recognisable
}

// The UA and navigator.platform are two separate places the OS shows up.
// A UA-switcher extension usually changes only the UA, so a mismatch is the clue.
function readOs(ua) {
    let fromUa = osFromString(ua);
    // iPadOS Safari claims to be a Mac, but Macs have no touchscreen
    if (fromUa === "macOS" && navigator.maxTouchPoints > 1) {
        fromUa = "iOS";
    }
    const fromPlatform = osFromString(navigator.platform);

    if (fromUa === null) {
        return signal(null, "hidden", "The user agent doesn't name an operating system.");
    }

    // Android and ChromeOS report "Linux ..." as their platform, which is honest
    let consistent = false;
    if (fromPlatform === null || fromPlatform === fromUa) {
        consistent = true;
    } else if (fromPlatform === "Linux" && (fromUa === "Android" || fromUa === "ChromeOS")) {
        consistent = true;
    } else if (fromPlatform === "macOS" && fromUa === "iOS" && navigator.maxTouchPoints > 1) {
        consistent = true;              // an iPad's platform says "MacIntel"
    }

    if (consistent) {
        return signal(fromUa, "visible", null);
    } else {
        return signal(fromUa, "spoofed",
            "The user agent says " + fromUa + " but navigator.platform says " + fromPlatform + ".");
    }
}

// Browser name from the UA. Order matters: Edge and Opera UAs also contain "Chrome",
// and Chrome's UA also contains "Safari". On iOS every browser runs on Apple's WebKit,
// so there the name says which app it is, not which engine.
function readBrowser(ua) {
    let name = null;
    if (isBrave()) {
        name = "Brave";
    } else if (/Edg\/|EdgA\/|EdgiOS\//.test(ua)) {  // Edge on desktop, Android and iOS
        name = "Edge";
    } else if (/OPR\/|OPT\//.test(ua)) {            // Opera, and Opera Touch on iOS
        name = "Opera";
    } else if (/Firefox\/|FxiOS\//.test(ua)) {      // also Zen, LibreWolf and Tor Browser; FxiOS: Firefox on iOS
        name = "Firefox";
    } else if (/Chrome\/|CriOS\//.test(ua)) {       // also Chromium; CriOS: Chrome on iOS
        name = "Chrome";
    } else if (/Safari\//.test(ua)) {    // also Epiphany (both WebKit)
        name = "Safari";
    }

    if (name === null) {
        return signal(null, "hidden", "The user agent doesn't match a known browser.");
    }
    return signal(name, "visible", null);
}

// ── Timezone and language ────────────────────────────────────────────────

// Timezones that privacy browsers report instead of the real one.
// LibreWolf with resistFingerprinting reports Atlantic/Reykjavik (checked 2026-11-01), which is
// also a real timezone. It has to stay, so the clues say "may" for people really in Iceland.
const SPOOF_TIMEZONES = ["UTC", "Etc/UTC", "Etc/GMT", "Atlantic/Reykjavik"];

function readTimezone() {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone; // IANA name, e.g. "America/Los_Angeles"

    if (zone === undefined || zone === null || zone === "") {
        return signal(null, "hidden", "The browser gave no timezone.");
    }
    if (SPOOF_TIMEZONES.includes(zone)) {
        return signal(zone, "spoofed",
            "Privacy browsers report this zone instead of the real one, though it may be genuine if you're in Iceland or on UTC.");
    }
    return signal(zone, "visible", null);
}

function readLanguages() {
    let list = navigator.languages;               // preference order, e.g. ["en-US", "en"]
    if (list === undefined || list.length === 0) {
        list = [navigator.language];              // older browsers: only the first choice
    }
    return signal(Array.from(list), "visible", null); // Array.from: a plain copy, not the browser's frozen list
}

// ── Hardware ─────────────────────────────────────────────────────────────

function readScreen(resistFingerprinting) {
    const value = {
        width: screen.width,                     // in CSS pixels, not physical pixels
        height: screen.height,
        ratio: window.devicePixelRatio           // physical pixels per CSS pixel (1.5 on a scaled laptop screen)
    };

    // resistFingerprinting reports the window size as the screen size.
    // A real screen is almost never exactly the size of the browser window
    // (a full-screen browser is the exception, and gets this clue by mistake).
    if (resistFingerprinting || (screen.width === window.innerWidth && screen.height === window.innerHeight)) {
        return signal(value, "spoofed", "The screen size matches the browser window exactly.");
    }
    return signal(value, "visible", null);
}

function readCores(resistFingerprinting) {
    const cores = navigator.hardwareConcurrency; // logical CPU threads 

    if (typeof cores !== "number" || cores < 1) {
        return signal(null, "hidden", "The browser doesn't report a core count.");
    }
    if (isBrave()) {
        // Brave's default protection reports a random number between 2 and the real count
        return signal(cores, "spoofed", "Brave reports a random core count.");
    }
    if (resistFingerprinting) {
        return signal(cores, "spoofed", "This browser looks like it reports a standard core count, not the real one.");
    }
    return signal(cores, "visible", null);
}

// Sorts a GPU name into a vendor group (see "GPU trait" in Locked Decisions).
// Software renderers go first: their names can include a real vendor, e.g.
// "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))".
function gpuGroup(renderer) {
    if (/SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(renderer)) {
        return "software";
    }
    if (/NVIDIA|GeForce|Quadro/i.test(renderer)) {
        return "NVIDIA";
    }
    if (/AMD|Radeon|\bATI\b/i.test(renderer)) {   // \b = word boundary, so "ATI" can't match inside a longer word
        return "AMD";
    }
    if (/Intel/i.test(renderer)) {
        return "Intel";
    }
    if (/Apple/i.test(renderer)) {
        return "Apple";
    }
    if (/Adreno|Mali|Qualcomm|PowerVR|Immortalis/i.test(renderer)) {
        return "Qualcomm-ARM";                    // phone and tablet GPUs
    }
    return null;                                  // generic or spoofed, e.g. resistFingerprinting's "Mozilla"
}

function readGpu() {
    const canvas = document.createElement("canvas"); // never added to the page
    let gl = null;
    try {
        gl = canvas.getContext("webgl");
    } catch (error) {
        gl = null;                                   // some browsers throw instead of returning null
    }
    if (gl === null) {
        return signal(null, "hidden", "WebGL is turned off, so the GPU can't be read.");
    }

    // Firefox puts the GPU name in plain RENDERER and has deprecated the
    // WEBGL_debug_renderer_info extension (it logs a console warning when asked).
    // Chromium and WebKit still put only "WebKit WebGL" in RENDERER, so the
    // extension is asked only when RENDERER doesn't name a vendor.
    let renderer = gl.getParameter(gl.RENDERER);
    if (gpuGroup(renderer) === null) {
        const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
        if (debugInfo !== null) {
            renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL); // the real ("unmasked") name
        }
    }

    // hand the GPU context back now instead of waiting for garbage collection
    const loseContext = gl.getExtension("WEBGL_lose_context");
    if (loseContext !== null) {
        loseContext.loseContext();
    }

    const group = gpuGroup(renderer);
    if (group === null) {
        return signal(null, "hidden", "The browser reports only \"" + renderer + "\".");
    }
    return signal({ group: group, renderer: renderer }, "visible", null);
}

// ── Preferences and privacy signals ──────────────────────────────────────

function readAppearance(resistFingerprinting) {
    const value = {
        dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
    };
    if (resistFingerprinting) {
        return signal(value, "spoofed", "This browser looks like it reports standard display settings, not yours.");
    }
    return signal(value, "visible", null);
}

// Global Privacy Control and Do Not Track: signals the visitor's browser sends
// asking sites not to sell or track their data
function readPrivacySignals() {
    const gpc = navigator.globalPrivacyControl === true;
    let dnt = false;
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1") { // window.doNotTrack: older Safari/Edge
        dnt = true;
    }
    return signal({ gpc: gpc, dnt: dnt }, "visible", null);
}

// Tries to load one script from our own site. Resolves with "loaded", "failed", or
// "timeout" after ms milliseconds, so a slow connection isn't mistaken for a block.
// A script tag, not fetch(): the EasyList rule covers only the "script" request type.
function canLoadScript(path, ms) {
    return new Promise(function (resolve) {
        const script = document.createElement("script");
        const timer = setTimeout(finish, ms, "timeout"); // give up after ms milliseconds

        function finish(result) {
            clearTimeout(timer);
            script.remove();                            // the files are empty; nothing needs to stay
            resolve(result);
        }

        script.addEventListener("load", function () {
            finish("loaded");
        });
        script.addEventListener("error", function () {
            finish("failed");
        });
        script.src = path;                              // same origin, so CSP's script-src 'self' allows it
        document.head.appendChild(script);              // the request starts here
    });
}

// Ad-blocker check: load two empty files from our own site.
// adasync.js has an ad-like name (EasyList: /adasync.js$script); plain.js is the control.
// Only "control loaded, bait failed" means a blocker: anything else could be the
// network or a missing file, so the line reads hidden rather than guessing.
// Blockers that work only by hiding page elements, or at the DNS level, aren't seen.
async function readAdBlocker() {
    const control = await canLoadScript("bait/plain.js", 2000);
    if (control !== "loaded") {
        return signal(null, "hidden", "The test files didn't load, so an ad blocker can't be checked.");
    }

    const bait = await canLoadScript("bait/adasync.js", 2000);
    if (bait === "loaded") {
        return signal(false, "visible", null);
    } else if (bait === "failed") {
        return signal(true, "visible", null);
    }
    return signal(null, "hidden", "The test file took too long to load, so an ad blocker can't be checked.");
}

// ── Canvas fingerprint ───────────────────────────────────────────────────

// LibreWolf and Tor Browser run Firefox's resistFingerprinting, which forces a UTC+0
// timezone and shows a permission prompt when a site reads a canvas.
// Firefox + one of those zones is our tell. A real Firefox user in UTC or Iceland also matches —
// they lose the canvas line and get a "looks spoofed" tag, which is the safe direction.
function looksLikeResistFingerprinting(browser, timezone) {
    if (browser === "Firefox" && SPOOF_TIMEZONES.includes(timezone)) {
        return true;
    }
    return false;
}

// Draws text and shapes, then hashes the pixels. The result differs between machines
// because fonts, anti-aliasing and GPUs render the same drawing slightly differently.
// This is the only place the site reads a canvas back: the art never does (see art.js).
async function readCanvas(resistFingerprinting) {
    if (resistFingerprinting) {
        return signal(null, "hidden",
            "This browser looks like one that asks before letting a site read a canvas, so we skip it to avoid the prompt.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 60;
    const ctx = canvas.getContext("2d");
    if (ctx === null) {
        return signal(null, "hidden", "Canvas drawing is turned off.");
    }

    ctx.textBaseline = "top";
    ctx.font = "16px Arial";                       // a system font, not ours: font differences are the point
    ctx.fillStyle = "#f60";
    ctx.fillRect(100, 5, 80, 30);                  // orange box under part of the text
    ctx.fillStyle = "#069";
    ctx.fillText("footprintz \u{1F33C}", 4, 8);    // \u{1F33C} = blossom emoji, drawn by the system emoji font
    ctx.fillStyle = "rgba(102, 204, 0, 0.7)";      // semi-transparent green: blending adds more variation
    ctx.fillText("footprintz \u{1F33C}", 6, 10);

    const pixels = canvas.toDataURL();             // the image as a base64 PNG string
    const hash = await sha256Hex(pixels);
    const short = hash.slice(0, 16);               // 16 hex digits is plenty to tell machines apart

    if (isBrave()) {
        return signal(short, "spoofed", "Brave adds random noise to canvas reads, so this changes every session.");
    }
    return signal(short, "visible", null);
}

// ── WebRTC local address ─────────────────────────────────────────────────

// Waits until the browser has listed all its network candidates, or ms milliseconds pass
function waitForGathering(pc, ms) {
    return new Promise(function (resolve) {
        const timer = setTimeout(resolve, ms);     // give up after ms milliseconds
        pc.addEventListener("icegatheringstatechange", function () {
            if (pc.iceGatheringState === "complete") {
                clearTimeout(timer);
                resolve();
            }
        });
    });
}

// WebRTC (video calls) lists the computer's network addresses as "candidates".
// With no STUN server only "host" candidates appear — local addresses, no outside request.
async function readWebRtc() {
    if (typeof RTCPeerConnection !== "function") {
        return signal(null, "hidden", "WebRTC is turned off.");
    }

    let pc = null;
    const addresses = [];
    try {
        pc = new RTCPeerConnection({ iceServers: [] }); // empty list = no STUN server
        pc.addEventListener("icecandidate", function (event) {
            if (event.candidate !== null && event.candidate.candidate !== "") {
                // a candidate line looks like:
                // "candidate:842163049 1 udp 1677729535 192.168.12.226 54321 typ host ..."
                const parts = event.candidate.candidate.split(" ");
                const address = parts[4];          // 5th field is the address
                if (!addresses.includes(address)) {
                    addresses.push(address);       // skip duplicates (one per protocol)
                }
            }
        });

        pc.createDataChannel("probe");             // an offer needs at least one channel
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);       // this starts candidate gathering
        await waitForGathering(pc, 1000);
    } catch (error) {
        return signal(null, "hidden", "WebRTC is blocked in this browser.");
    } finally {
        if (pc !== null) {
            pc.close();                            // finally: runs on success and on failure
        }
    }

    if (addresses.length === 0) {
        return signal(null, "hidden", "No local address was offered.");
    }

    // Modern browsers swap the real IP for a random name like "1f2e...a9.local" (mDNS)
    let allMasked = true;
    for (const address of addresses) {
        if (!address.endsWith(".local")) {
            allMasked = false;
        }
    }
    if (allMasked) {
        return signal(null, "hidden", "The browser replaces the local IP with a random .local name.");
    }
    return signal(addresses, "visible", null);
}

// ── Entry point ──────────────────────────────────────────────────────────

// Reads every signal. The quick ones run first; the three slow ones then run at the
// same time, so the wait is the slowest one (about 1 s) rather than all three added up.
export async function collectSignals() {
    const ua = navigator.userAgent;
    const browser = readBrowser(ua);
    const timezone = readTimezone();
    const rfp = looksLikeResistFingerprinting(browser.value, timezone.value);

    // Promise.all waits for all three, and its results keep this order
    const slow = await Promise.all([readAdBlocker(), readCanvas(rfp), readWebRtc()]);

    return {
        os: readOs(ua),
        browser: browser,
        timezone: timezone,
        languages: readLanguages(),
        screen: readScreen(rfp),
        cores: readCores(rfp),
        gpu: readGpu(),
        appearance: readAppearance(rfp),
        privacySignals: readPrivacySignals(),
        adBlocker: slow[0],
        canvas: slow[1],
        webrtc: slow[2]
    };
}
