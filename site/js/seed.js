// seed.js — turns the signals into the two seeds behind the art.
//   Genome seed: fixed per footprint. The same signals always give the same seed.
//   Growth seed: fresh random bytes for every growth run, so no two plants match.
// A seed is four 32-bit whole numbers, which is exactly what makeRandom() needs.

// ── Canonical text ───────────────────────────────────────────────────────

// The signals that shape the genome, in a fixed order. Order is written out here
// because the hash must not depend on the order the signals happened to be collected in.
const GENOME_SIGNALS = ["os", "browser", "timezone", "languages", "screen", "cores",
                        "gpu", "appearance", "privacySignals", "adBlocker", "canvas", "webrtc"];

// One value for each signal. A hidden signal's value is null, so hiding a signal
// changes the genome, the same as any other change to the footprint.
// Values that move without the footprint changing are steadied here, so a stable
// browser keeps its plant across reloads. The report still shows the raw values.
function genomeValue(name, reading) {
    if (name === "gpu" && reading.value !== null) {
        return reading.value.group;     // the vendor group, not the raw name (see "GPU trait")
    }
    if (name === "screen") {
        if (reading.state === "spoofed") {
            return "spoofed";           // a spoofed size follows the window, so it isn't hashed
        }
        return [reading.value.width, reading.value.height]; // no ratio: browser zoom changes it
    }
    if (name === "webrtc" && reading.value !== null) {
        return reading.value.slice().sort(); // a sorted copy: addresses can arrive in any order
    }
    return reading.value;
}

// Builds one string that is identical whenever the footprint is identical
function canonicalise(signals) {
    const values = [];
    for (const name of GENOME_SIGNALS) {
        values.push(genomeValue(name, signals[name]));
    }
    return JSON.stringify(values);      // an array keeps its order, and null stays null
}

// ── Seeds ────────────────────────────────────────────────────────────────

// Genome seed: SHA-256 of the canonical text, cut down to its first four 32-bit numbers.
// Takes a signals object, so the Tor preview can pass in its fixed profile the same way.
export async function genomeSeed(signals) {
    const bytes = new TextEncoder().encode(canonicalise(signals));   // string -> UTF-8 bytes
    const digest = await crypto.subtle.digest("SHA-256", bytes);     // 32 bytes (256 bits)
    const view = new DataView(digest);                               // reads numbers out of raw bytes

    const seed = [];
    for (let i = 0; i < 4; i++) {
        seed.push(view.getUint32(i * 4));   // bytes 0-3, 4-7, 8-11, 12-15; each is one number
    }
    return seed;
}

// Growth seed: four random numbers from the browser's secure random generator
export function growthSeed() {
    const numbers = new Uint32Array(4);     // four empty 32-bit slots
    crypto.getRandomValues(numbers);        // fills them in place
    return Array.from(numbers);             // a plain array, the same shape as genomeSeed()
}

// ── Seeded random generator ──────────────────────────────────────────────

// sfc32 ("Small Fast Counting"), a public-domain generator from the PractRand suite.
// Math.random() can't be used here: it can't be seeded, so a genome couldn't repeat.
// Returns a function; each call gives the next number, from 0 up to (not including) 1.
export function makeRandom(seed) {
    let a = seed[0];                        // the generator's whole memory is these four numbers
    let b = seed[1];
    let c = seed[2];
    let d = seed[3];

    function next() {
        const t = (((a + b) | 0) + d) | 0;  // | 0 forces a wrapped 32-bit whole number
        d = (d + 1) | 0;                    // the counter: guarantees a very long cycle
        a = b ^ (b >>> 9);                  // ^ = XOR, >>> = shift right, filling with zeros
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);         // rotates c's bits left by 21
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;      // >>> 0 = read as unsigned; divide by 2^32 to get 0-1
    }

    // the first few outputs still show the seed's pattern, so throw them away
    for (let i = 0; i < 12; i++) {
        next();
    }
    return next;
}
