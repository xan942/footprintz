// report.js — the page's "What they can see" and "Shrink your footprint" sections.
// Displays, never scores: each line shows its own state and who can see it.
// The line list is fixed, so a line the browser hides still appears, as "hidden".
// All text goes in through textContent, because the values come from the browser.

// ── Lines ────────────────────────────────────────────────────────────────

// Builds one report line from one signal
function line(id, label, observer, reading, text, phrase) {
    return {
        id: id,
        label: label,
        observer: observer,          // the group the line appears under
        state: reading.state,
        text: text,                  // ignored when the state is hidden
        clue: reading.clue,
        phrase: phrase               // this line's part of the closing sentence
    };
}

// OS and browser share a line, so the line takes its state from the pair
function osBrowserLine(os, browser) {
    let reading = os;
    if (os.state === "hidden") {
        reading = browser;           // a hidden OS mustn't hide a browser name we did read
    }
    let text = "";
    if (os.value !== null) {
        text = os.value;
    }
    if (browser.value !== null) {
        if (text !== "") {
            text += ", ";
        }
        text += browser.value;
    }
    return line("osBrowser", "OS + browser", "Any site", reading, text, "your system");
}

function screenText(value) {
    if (value === null) {
        return "";
    }
    return value.width + "x" + value.height + " at " + value.ratio.toFixed(2) + "x";
}

function gpuText(value) {
    if (value === null) {
        return "";
    }
    return value.group + " (reported as " + value.renderer + ")";
}

function appearanceText(value) {
    let text = "light mode";
    if (value.dark) {
        text = "dark mode";
    }
    if (value.reducedMotion) {
        text += ", reduced motion";
    }
    return text;
}

function privacyText(value) {
    let text = "GPC off";
    if (value.gpc) {
        text = "GPC on";
    }
    if (value.dnt) {
        text += ", DNT on";
    } else {
        text += ", DNT off";
    }
    return text;
}

function adBlockerText(value) {
    if (value === true) {
        return "detected";
    }
    return "none detected";          // DNS-level blockers can't be seen, so never just "none"
}

function webRtcText(value) {
    if (value === null) {
        return "";
    }
    return value.join(", ");
}

function languagesText(value) {
    return value.join(", ");
}

// "en-US, 12-hour clock, 1,234.5"
function formatsText(value) {
    let text = value.locale;
    if (value.clock !== null) {
        text += ", " + value.clock + " clock";
    }
    text += ", " + value.number;
    return text;
}

// "38 installed, e.g. Google US English, Google UK English Female, ..."
function voicesText(value) {
    if (value === null) {
        return "";
    }
    const examples = value.slice(0, 3);          // the first three names are enough to show the idea
    let text = value.length + " installed, e.g. " + examples.join(", ");
    if (value.length > 3) {
        text += ", ...";
    }
    return text;
}

// "24-bit, sRGB, no HDR"
function colourText(value) {
    let text = value.depth + "-bit, " + value.gamut;
    if (value.hdr) {
        text += ", HDR";
    } else {
        text += ", no HDR";
    }
    return text;
}

// e.g. "mouse or trackpad", "mouse or trackpad and 5 touch points reported",
// "mouse or trackpad, touch input and 10 touch points reported".
// Touch items end in "reported": they're the browser's claim, not proof of a touchscreen.
// Chromium claims touch input and Linux browsers count touchpad fingers even on a
// touchpad-only laptop (see readPointer in signals.js).
function pointerText(value) {
    const parts = [];
    if (value.fine) {
        parts.push("mouse or trackpad");
    }
    if (value.coarse) {
        parts.push("touch input");
    }
    if (value.touchPoints > 0) {
        parts.push(value.touchPoints + " touch points");
    }

    if (parts.length === 0) {
        return "no pointer reported";
    }

    // joins as "a", "a and b", or "a, b and c"
    let text = parts[0];
    for (let i = 1; i < parts.length; i++) {
        if (i === parts.length - 1) {
            text += " and " + parts[i];          // the last item gets "and"
        } else {
            text += ", " + parts[i];             // the ones before it get a comma
        }
    }

    if (value.coarse || value.touchPoints > 0) {
        text += " reported";                     // once, at the end, only when touch is claimed
    }
    return text;
}

// The fixed list of 17 lines, in page order. Lines are grouped by observer, so a new
// line goes inside its group, not at the end.
export function buildLines(signals) {
    return [
        // every server you connect to sees this one, so it leads the "Any site" group
        line("ip", "IP address", "Any site", signals.ip,
            signals.ip.value, "your network and rough location"),
        osBrowserLine(signals.os, signals.browser),
        line("timezone", "Timezone", "Any site", signals.timezone,
            signals.timezone.value, "roughly where you are"),
        line("formats", "Date + number format", "Any site", signals.formats,
            formatsText(signals.formats.value), "how your region writes times and numbers"),
        line("languages", "Languages", "Any site", signals.languages,
            languagesText(signals.languages.value), "the languages you read"),
        line("speechVoices", "Speech voices", "Any site", signals.speechVoices,
            voicesText(signals.speechVoices.value), "the voices installed on your system"),
        line("screen", "Screen", "Any site", signals.screen,
            screenText(signals.screen.value), "your screen"),
        line("colour", "Colour", "Any site", signals.colour,
            colourText(signals.colour.value), "your display's colour range"),
        line("pointer", "Pointer", "Any site", signals.pointer,
            pointerText(signals.pointer.value), "whether you use touch or a mouse"),
        line("cores", "CPU cores", "Any site", signals.cores,
            signals.cores.value, "your processor"),
        line("gpu", "GPU", "Any site", signals.gpu,
            gpuText(signals.gpu.value), "your graphics hardware"),
        line("appearance", "Appearance", "Any site", signals.appearance,
            appearanceText(signals.appearance.value), "your display preferences"),
        line("privacySignals", "Privacy signals", "Advertisers", signals.privacySignals,
            privacyText(signals.privacySignals.value), "whether you ask not to be tracked"),
        line("adBlocker", "Ad blocker", "Advertisers", signals.adBlocker,
            adBlockerText(signals.adBlocker.value), "whether you block ads"),
        line("canvas", "Canvas fingerprint", "Advertisers", signals.canvas,
            signals.canvas.value, "a drawing test that helps tell this device from others"),
        line("audio", "Audio fingerprint", "Advertisers", signals.audio,
            signals.audio.value, "a sound test that does the same"),
        line("webrtc", "WebRTC local address", "Attackers and bots", signals.webrtc,
            webRtcText(signals.webrtc.value), "your local network address")
    ];
}

// The bloom's total: every line except placeholders. A pending line isn't really
// hidden, so counting it would shrink every visitor's bloom for no reason.
export function countReal(lines) {
    let count = 0;
    for (const item of lines) {
        if (item.state !== "pending") {
            count += 1;
        }
    }
    return count;
}

// The bloom's input: visible lines, leaving out any a previewed fix would hide
export function countVisible(lines, previewHidden) {
    let count = 0;
    for (const item of lines) {
        if (item.state === "visible" && !previewHidden.has(item.id)) {
            count += 1;
        }
    }
    return count;
}

// "what these lines add up to": built only from visible lines, and with no number
function closingText(lines) {
    const phrases = [];
    for (const item of lines) {
        if (item.state === "visible") {
            phrases.push(item.phrase);
        }
    }
    if (phrases.length === 0) {
        return "Together, these lines show very little about you.";
    }
    return "Together, these lines show " + phrases.join("; ") + ".";
}

// ── Fixes ────────────────────────────────────────────────────────────────

// hides: the lines a preview greys out. An empty list gets no preview, because that
// fix changes what a line says rather than hiding it. Fix wording is a first draft.
const FIXES = {
    resistFingerprinting: {
        title: "Turn on resistFingerprinting",
        how: "In Firefox-based browsers, set privacy.resistFingerprinting to true in about:config. LibreWolf has it on already. Some sites will break, and your timezone will read as Iceland's (UTC+0).",
        hides: ["timezone", "formats", "screen", "colour", "pointer", "cores", "gpu", "appearance", "canvas"]
    },
    torBrowser: {
        title: "Use Tor Browser for private browsing",
        how: "Your OS and browser family can't be fully hidden, but Tor Browser makes you look like every other Tor user, turns off speech voices, and also hides your IP address.",
        hides: ["timezone", "formats", "speechVoices", "screen", "colour", "pointer", "cores", "gpu", "appearance", "canvas"]
    },
    audioNoise: {
        title: "Use a browser that adds noise to audio reads",
        how: "Brave changes the audio test's result slightly for each site and session, so the fingerprint can't link your visits together.",
        hides: ["audio"]
    },
    globalPrivacyControl: {
        title: "Turn on Global Privacy Control",
        how: "In Firefox-based browsers, it's in Settings under Privacy. Brave has it on already. It asks sites not to sell or share your data.",
        hides: []
    },
    adBlocker: {
        title: "Install uBlock Origin",
        how: "It blocks requests to ad and tracking servers, which cuts down what those companies can collect about you across sites.",
        hides: []
    },
    webrtc: {
        title: "Stop WebRTC sharing your local address",
        how: "In uBlock Origin's settings, tick \"Prevent WebRTC from leaking local IP addresses\".",
        hides: ["webrtc"]
    }
};

// Which fix answers which line. Lines not listed here have their fix chosen below.
const FIX_FOR_LINE = {
    osBrowser: "torBrowser",
    languages: "torBrowser",
    speechVoices: "torBrowser",
    timezone: "resistFingerprinting",
    formats: "resistFingerprinting",
    screen: "resistFingerprinting",
    colour: "resistFingerprinting",
    pointer: "resistFingerprinting",
    cores: "resistFingerprinting",
    gpu: "resistFingerprinting",
    appearance: "resistFingerprinting",
    canvas: "resistFingerprinting",
    audio: "audioNoise",
    webrtc: "webrtc"
};

// Lists each needed fix once, in line order
export function buildFixes(signals, lines) {
    const needed = [];

    function add(name) {
        if (!needed.includes(FIXES[name])) {
            needed.push(FIXES[name]);
        }
    }

    for (const item of lines) {
        if (item.state === "visible" && FIX_FOR_LINE[item.id] !== undefined) {
            add(FIX_FOR_LINE[item.id]);
        }
    }

    // these two lines are findings because of what they say, not their state:
    // a hidden ad-blocker value is null, so it doesn't trigger the fix
    if (signals.privacySignals.value.gpc === false) {
        add("globalPrivacyControl");
    }
    if (signals.adBlocker.value === false) {
        add("adBlocker");
    }
    return needed;
}

// ── Page ─────────────────────────────────────────────────────────────────

// makes an element with its text already set
function element(tag, className, text) {
    const item = document.createElement(tag);
    item.className = className;
    item.textContent = text;
    return item;
}

// the tag and value shown for one line; spoofing is worded as "looks spoofed", never as fact
function lineRow(item) {
    const row = element("p", "line", "");
    row.appendChild(element("span", "label", item.label + ": "));

    if (item.state === "hidden") {
        row.appendChild(element("span", "tag-hidden", "hidden"));
    } else if (item.state === "pending") {
        row.appendChild(element("span", "tag-pending", "coming soon"));   // placeholder line
    } else {
        row.appendChild(document.createTextNode(String(item.text)));
        if (item.state === "spoofed") {
            row.appendChild(element("span", "tag-spoofed", " looks spoofed"));
        }
    }
    if (item.clue !== null) {
        row.appendChild(element("span", "clue", " (" + item.clue + ")"));
    }
    return row;
}

// Draws the lines into container, beside the flower, and everything else into below.
// onPreview(count) runs on every toggle, even if the count stays the same: regrowing
// the flower each time is deliberate.
export function renderReport(container, below, signals, onPreview) {
    const lines = buildLines(signals);
    const fixes = buildFixes(signals, lines);
    const rows = {};                   // finds a line's row by its id, for greying out
    const activeFixes = new Set();     // the fixes currently previewed

    container.textContent = "";        // removes any earlier report
    container.appendChild(element("h2", "", "What they can see"));

    let observer = null;
    for (const item of lines) {
        if (item.observer !== observer) {
            observer = item.observer;  // lines are in group order, so a change starts a new group
            container.appendChild(element("h3", "", observer));
        }
        const row = lineRow(item);
        rows[item.id] = row;
        container.appendChild(row);
    }

    below.textContent = "";            // removes any earlier summary and fixes
    below.appendChild(element("p", "closing", closingText(lines)));
    below.appendChild(element("p", "note",
        "This is only what any website can see by itself. Advertisers also combine it with cross-site cookies, data brokers and accounts you're logged in to, which this page can't show."));

    // works out which lines are hidden by the ticked fixes, then updates the page and the flower
    function refresh() {
        const previewHidden = new Set();
        for (const fix of activeFixes) {
            for (const id of fix.hides) {
                previewHidden.add(id);
            }
        }
        for (const item of lines) {
            rows[item.id].classList.toggle("previewed", previewHidden.has(item.id));
        }
        onPreview(countVisible(lines, previewHidden));
    }

    below.appendChild(element("h2", "", "Shrink your footprint"));
    if (fixes.length === 0) {
        below.appendChild(element("p", "", "There's nothing to fix on this list."));
    }
    for (const fix of fixes) {
        const block = element("div", "fix", "");
        block.appendChild(element("h3", "", fix.title));
        block.appendChild(element("p", "", fix.how));

        if (fix.hides.length > 0) {
            const label = element("label", "preview", "");
            const box = document.createElement("input");
            box.type = "checkbox";
            box.addEventListener("change", function () {
                if (box.checked) {
                    activeFixes.add(fix);
                } else {
                    activeFixes.delete(fix);
                }
                refresh();
            });
            label.appendChild(box);
            label.appendChild(document.createTextNode(" preview this fix"));
            block.appendChild(label);
        }
        below.appendChild(block);
    }

    return countVisible(lines, new Set());
}
