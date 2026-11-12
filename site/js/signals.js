// signals.js — collects the browser signals that feed the genome (seed.js)
// and the "What they can see" report (report.js).
// Runs only when the visitor clicks Generate. Nothing is sent anywhere: the only
// requests go to our own site (the ad-blocker check's two empty files, and /ip,
// which answers with the visitor's address) and carry no results.
// No reader here may trigger a permission prompt.
//
// Every signal comes back in the same shape:
//   { value, state, clue }
//   value: what the browser reported (null when hidden)
//   state: "visible" | "hidden" | "spoofed" | "pending"
//   clue:  one sentence explaining a hidden, spoofed or pending state (null when visible)
//   "pending" marks a line with nothing to show yet: only the IP line, when /ip
//   doesn't answer (the local dev server, or a network failure).

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
    } else if (/Safari\//.test(ua)) {
        // Safari exists only on Apple systems. Elsewhere a "Safari/" UA is another
        // WebKit browser, such as GNOME Web (Epiphany) on Linux.
        const os = osFromString(ua);
        if (os === "macOS" || os === "iOS") {
            name = "Safari";
        } else {
            name = "WebKit (e.g. GNOME Web)";
        }
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
    // Brave reports a common screen size instead of the real one (checked 2026-11-06 on
    // a test laptop: Brave said 1280x800, then 1440x900 at 90% zoom; Chromium said 1896x1185).
    // As with LibreWolf, seed.js then hashes "spoofed" instead of the size, so zooming
    // doesn't change Brave's plant.
    if (isBrave()) {
        return signal(value, "spoofed", "Brave reports a common screen size, not yours.");
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

function readGpu(ua, resistFingerprinting) {
    // LibreWolf asks the visitor before allowing WebGL (seen 2026-11-06: "Blocked ... from
    // creating WebGL context but prompting the user"), so we don't even ask for it there.
    // Same reason the canvas check is skipped. Under resistFingerprinting the renderer
    // would only say "Mozilla" anyway, which is hidden too, so the genome doesn't change.
    if (resistFingerprinting) {
        return signal(null, "hidden",
            "This browser looks like one that asks before allowing WebGL, so we skip it to avoid the prompt.");
    }

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

    // WebKit browsers report every GPU as "Apple GPU" on purpose, to hide the real one.
    // On a Mac, iPhone or iPad that can be true, but on any other system it can't be.
    // The value is kept as reported, so the genome and the art follow what the browser says.
    const os = osFromString(ua);
    if (group === "Apple" && os !== "macOS" && os !== "iOS") {
        return signal({ group: group, renderer: renderer }, "spoofed",
            "WebKit browsers report every GPU as an Apple GPU, which can't be right on " + os + ".");
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
        // Brave Shields (Standard mode) blocks only third-party ads, so it lets our
        // same-site bait through. "None detected" would be wrong for a Brave user,
        // so the line reads hidden instead (and the uBlock fix isn't suggested).
        // Shields in Aggressive mode does block the bait, and lands in "failed" below.
        if (isBrave()) {
            return signal(null, "hidden", "Brave Shields blocks third-party ads, which a same-site test can't see.");
        }
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
        // gathering may already be finished by the time we get here; if so, the
        // "complete" event has already fired and would never reach the listener below
        if (pc.iceGatheringState === "complete") {
            resolve();
            return;
        }
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

// ── Date and number formats ──────────────────────────────────────────────

// How the browser writes times and numbers. These follow the visitor's region settings,
// so they can show a region even when the language list says only "en-US".
function readFormats(resistFingerprinting) {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;   // e.g. "en-US", "en-GB"

    // hourCycle: "h11"/"h12" = 12-hour clock, "h23"/"h24" = 24-hour clock
    const hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    let clock = null;                                // stays null if the browser doesn't say
    if (hourCycle === "h11" || hourCycle === "h12") {
        clock = "12-hour";
    } else if (hourCycle === "h23" || hourCycle === "h24") {
        clock = "24-hour";
    }

    const number = (1234.5).toLocaleString();        // "1,234.5" in the US, "1.234,5" in Germany

    const value = { locale: locale, clock: clock, number: number };
    if (resistFingerprinting) {
        return signal(value, "spoofed", "This browser looks like it reports the standard US formats, not yours.");
    }
    return signal(value, "visible", null);
}

// ── Speech voices ────────────────────────────────────────────────────────

// Chromium fills the voice list a moment after the page asks, and announces it with a
// "voiceschanged" event. Firefox has it ready at once. Waits up to ms milliseconds.
function waitForVoices(ms) {
    return new Promise(function (resolve) {
        const first = speechSynthesis.getVoices();
        if (first.length > 0) {
            resolve(first);                          // already there: no need to wait
            return;
        }
        const timer = setTimeout(function () {
            resolve(speechSynthesis.getVoices());    // whatever is there when time runs out
        }, ms);
        speechSynthesis.addEventListener("voiceschanged", function () {
            clearTimeout(timer);
            resolve(speechSynthesis.getVoices());
        }, { once: true });                          // once: the listener removes itself after firing
    });
}

// The text-to-speech voices installed on the system. The list depends on the OS and the
// language packs installed, so it says a lot about the machine. Nothing is spoken.
async function readSpeechVoices() {
    if (typeof speechSynthesis === "undefined") {
        return signal(null, "hidden", "Speech synthesis is turned off.");  // Tor Browser turns it off
    }

    const voices = await waitForVoices(1000);
    if (voices.length === 0) {
        return signal(null, "hidden", "The browser listed no voices.");
    }

    const names = [];
    for (const voice of voices) {
        names.push(voice.name);                      // e.g. "Google US English", "English (America)"
    }
    return signal(names, "visible", null);
}

// ── Display colour and pointer ───────────────────────────────────────────

// Colour depth, colour range (gamut) and HDR support, all read without a prompt
function readColour(resistFingerprinting) {
    let gamut = "sRGB";                              // the standard range every screen covers
    if (window.matchMedia("(color-gamut: rec2020)").matches) {
        gamut = "Rec. 2020";                         // check the widest first: a Rec. 2020 screen also matches p3
    } else if (window.matchMedia("(color-gamut: p3)").matches) {
        gamut = "P3";                                // wide colour, e.g. recent Macs and phones
    }

    const value = {
        depth: screen.colorDepth,                    // bits per pixel, usually 24 or 30
        gamut: gamut,
        hdr: window.matchMedia("(dynamic-range: high)").matches
    };
    if (resistFingerprinting) {
        return signal(value, "spoofed", "This browser looks like it reports a standard display, not yours.");
    }
    return signal(value, "visible", null);
}

// Touch or mouse. any-pointer checks every input device, not only the main one,
// so a laptop with a touchscreen reports both.
// maxTouchPoints alone doesn't prove a touchscreen: on Linux, browsers also count a
// precision touchpad's fingers (test laptop: touchpad only, yet Chromium reports 10).
function readPointer(resistFingerprinting) {
    let touchPoints = navigator.maxTouchPoints;      // how many fingers the screen tracks at once
    if (typeof touchPoints !== "number") {
        touchPoints = 0;                             // older browsers: treat as no touchscreen
    }

    const value = {
        touchPoints: touchPoints,
        fine: window.matchMedia("(any-pointer: fine)").matches,     // a mouse, trackpad or stylus
        coarse: window.matchMedia("(any-pointer: coarse)").matches  // a finger
    };
    if (resistFingerprinting) {
        return signal(value, "spoofed", "This browser looks like it reports a standard pointer, not yours.");
    }
    return signal(value, "visible", null);
}

// ── Audio fingerprint ────────────────────────────────────────────────────

// Resolves with "timeout" after ms milliseconds, for racing against a slow promise
function timeout(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms, "timeout");          // the third argument is passed to resolve
    });
}

// Renders a short tone through a compressor without playing it, then hashes the result.
// Like the canvas test, the numbers differ slightly between machines because of the
// audio code and the processor's maths. OfflineAudioContext makes no sound and needs no prompt.
async function readAudio() {
    const AudioContextType = window.OfflineAudioContext || window.webkitOfflineAudioContext; // webkit: older Safari
    if (typeof AudioContextType !== "function") {
        return signal(null, "hidden", "Audio processing is turned off.");
    }

    let samples = null;
    try {
        const context = new AudioContextType(1, 5000, 44100); // 1 channel, 5000 samples, 44,100 per second

        const oscillator = context.createOscillator();        // the tone
        oscillator.type = "triangle";
        oscillator.frequency.value = 10000;                   // 10 kHz

        const compressor = context.createDynamicsCompressor(); // squashes loud parts; its maths varies most
        compressor.threshold.value = -50;                     // starts compressing at -50 dB
        compressor.knee.value = 40;
        compressor.ratio.value = 12;
        compressor.attack.value = 0;
        compressor.release.value = 0.25;

        oscillator.connect(compressor);                       // tone -> compressor -> output
        compressor.connect(context.destination);
        oscillator.start(0);

        // a browser that stalls the render shouldn't hold up the whole report
        const result = await Promise.race([context.startRendering(), timeout(2000)]);
        if (result === "timeout") {
            return signal(null, "hidden", "The audio test took too long to finish.");
        }
        samples = result.getChannelData(0);                   // the rendered sound, as numbers
    } catch (error) {
        return signal(null, "hidden", "Audio processing is blocked in this browser.");
    }

    let total = 0;
    for (let i = 4500; i < 5000; i++) {
        total += Math.abs(samples[i]);                        // the last 500 samples, after the compressor settles
    }
    const hash = await sha256Hex(total.toString());
    const short = hash.slice(0, 16);                          // the same length as the canvas fingerprint

    if (isBrave()) {
        return signal(short, "spoofed", "Brave adds random noise to audio reads, so this changes every session.");
    }
    return signal(short, "visible", null);
}

// ── Public IP address ────────────────────────────────────────────────────

// A browser can't read its own public IP; only the network side sees it. A CloudFront
// Function (infra/functions/ip.js) answers /ip on this site with the visitor's address
// (event.viewer.ip) as plain text, uncached; nothing logs or stores it.
// Anything other than an address (the local dev server's 404, a timeout, a network
// error) leaves the line pending, so it stays out of the bloom total rather than
// counting as hidden: a site always sees your IP, so failing to fetch it hides nothing.
// The IP stays out of the genome (seed.js): it changes with the network, so it would
// change the flower every time the visitor switched Wi-Fi.
async function readIp() {
    const controller = new AbortController();
    const timer = setTimeout(function () {
        controller.abort();                                     // give up after 2 s
    }, 2000);
    try {
        const response = await fetch("/ip", { cache: "no-store", signal: controller.signal });
        const text = (await response.text()).trim();
        // an IPv4 or IPv6 address only: digits, hex letters, dots and colons
        if (response.ok && /^[0-9a-fA-F.:]{2,45}$/.test(text)) {
            return signal(text, "visible", null);
        }
        return signal(null, "pending", "Shown on the live site.");
    } catch (error) {
        return signal(null, "pending", "Couldn't reach this site's /ip check.");
    } finally {
        clearTimeout(timer);
    }
}

// ── Entry point ──────────────────────────────────────────────────────────

// Reads every signal. The quick ones run first; the slow ones then run at the same
// time, so the wait is the slowest one rather than all of them added up. That is
// usually about 1 s, but up to about 4 s if both ad-blocker files hit their
// 2 s limit (that check loads them one after the other).
export async function collectSignals() {
    const ua = navigator.userAgent;
    const browser = readBrowser(ua);
    const timezone = readTimezone();
    const rfp = looksLikeResistFingerprinting(browser.value, timezone.value);

    // Promise.all waits for all six, and its results keep this order
    const slow = await Promise.all([readAdBlocker(), readCanvas(rfp), readWebRtc(),
                                    readSpeechVoices(), readAudio(), readIp()]);

    return {
        ip: slow[5],
        os: readOs(ua),
        browser: browser,
        timezone: timezone,
        languages: readLanguages(),
        screen: readScreen(rfp),
        cores: readCores(rfp),
        gpu: readGpu(ua, rfp),
        appearance: readAppearance(rfp),
        privacySignals: readPrivacySignals(),
        adBlocker: slow[0],
        canvas: slow[1],
        webrtc: slow[2],
        formats: readFormats(rfp),
        speechVoices: slow[3],
        colour: readColour(rfp),
        pointer: readPointer(rfp),
        audio: slow[4]
    };
}
