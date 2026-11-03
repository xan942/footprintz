// art.js — grows a flower into a cell model, without drawing anything itself.
// The genome (signals + genome seed) sets the shape; the growth seed sets every detail.
// The result is an ordered list of cell writes, so a view can replay it as growth.
// Written from scratch; cbonsai is the inspiration only. Nothing here reads a canvas.

import { makeRandom } from "./seed.js";

export const WIDTH = 48;   // cells across
export const HEIGHT = 32;  // cells down

// Colour slots: each palette below lists its colours in this order.
// Exported because pixel.js also uses a cell's slot to tell its role (a leaf "*" vs a petal "*").
export const STEM = 0;
export const LEAF = 1;
export const PETAL = 2;
export const CENTRE = 3;
export const POT = 4;
export const FADED_PETAL = 5;

// ── Trait tables (draft: the final mapping goes in the wiki) ─────────────

// OS -> growth rule. height: share of the free rows; sway: chance of leaning each step;
// fork: chance of a new branch each step; leaf: chance of a leaf each step
const GROWTH_RULES = {
    Linux:    { height: 0.80, sway: 0.35, fork: 0.10, leaf: 0.30 }, // bushy
    Windows:  { height: 1.00, sway: 0.15, fork: 0.05, leaf: 0.25 }, // tall and upright
    macOS:    { height: 0.90, sway: 0.50, fork: 0.05, leaf: 0.20 }, // long arcs
    Android:  { height: 0.65, sway: 0.30, fork: 0.12, leaf: 0.40 }, // short and leafy
    iOS:      { height: 0.65, sway: 0.45, fork: 0.08, leaf: 0.35 },
    ChromeOS: { height: 0.75, sway: 0.25, fork: 0.08, leaf: 0.25 },
    hidden:   { height: 0.60, sway: 0.15, fork: 0.03, leaf: 0.10 }  // sparse, for a hidden OS
};

// Timezone region -> palette: stem, leaf, petal, centre, pot, faded petal
const PALETTES = {
    America:   ["#73a857", "#9ece6a", "#f7768e", "#e0af68", "#a9b1d6", "#a8707e"],
    Europe:    ["#5f9e8f", "#73daca", "#bb9af7", "#e0af68", "#a9b1d6", "#8c7bab"],
    Asia:      ["#7a9a4e", "#b9c95f", "#ff9e64", "#f7768e", "#a9b1d6", "#a88266"],
    Africa:    ["#a08a4e", "#d6c060", "#e0af68", "#f7768e", "#a9b1d6", "#a08c66"],
    Australia: ["#4f9aa8", "#7dcfff", "#ff9e64", "#e0af68", "#a9b1d6", "#a88266"],
    Pacific:   ["#4f8fa8", "#7dcfff", "#7aa2f7", "#e0af68", "#a9b1d6", "#7183a8"],
    other:     ["#7f849c", "#9aa0b4", "#c0caf5", "#a9b1d6", "#a9b1d6", "#7f849c"]  // also a hidden zone
};

// GPU vendor group -> leaf glyphs. Only characters in the font subset (ASCII + box drawing)
const LEAF_GLYPHS = {
    AMD: ["&", "%", "&"],
    NVIDIA: ["*", "+", "x"],
    Intel: ["o", "0", "o"],
    Apple: ["(", ")", "~"],
    "Qualcomm-ARM": ["^", "v", "^"],
    software: ["[", "]", "="],
    hidden: [".", ",", "."]             // the deliberately plain set
};

const PETAL_GLYPHS = ["*", "#", "%", "o", "0", "+"]; // not "@": that marks the centre

// ── Traits ───────────────────────────────────────────────────────────────

// More cores -> more stems
function stemCount(cores) {
    if (cores === null || cores <= 2) {
        return 1;
    }
    if (cores <= 4) {
        return 2;
    }
    if (cores <= 16) {
        return 3;
    }
    return 4;
}

// "America/Los_Angeles" -> "America"; anything else falls back to the plain palette
function paletteName(zone) {
    if (zone === null) {
        return "other";
    }
    const region = zone.split("/")[0];
    if (PALETTES[region] !== undefined) {
        return region;
    }
    return "other";
}

// picks one entry from a list using a seeded random function
function pick(list, random) {
    return list[Math.floor(random() * list.length)];
}

// Turns a footprint into its fixed traits. The tables give related plants to similar
// setups; the genome seed then nudges them, so two footprints sharing every trait still differ.
export function makeTraits(signals, genome) {
    const random = makeRandom(genome);

    let osName = signals.os.value;
    if (osName === null) {
        osName = "hidden";
    }
    let gpuName = "hidden";
    if (signals.gpu.value !== null) {
        gpuName = signals.gpu.value.group;
    }

    let leanBias = 1;                               // which way the main stem prefers to lean
    if (random() < 0.5) {
        leanBias = -1;
    }

    return {
        rule: GROWTH_RULES[osName],
        stems: stemCount(signals.cores.value),
        palette: PALETTES[paletteName(signals.timezone.value)],
        leaves: LEAF_GLYPHS[gpuName],
        petal: pick(PETAL_GLYPHS, random),
        leanBias: leanBias,
        heightScale: 0.85 + random() * 0.15         // 0.85 to 1.0 of the rule's height
    };
}

// ── Growth ───────────────────────────────────────────────────────────────

// Grows one plant. The share of report lines that are visible (visibleLines out of
// totalLines) sets the bloom, as in "Bloom follows the report".
// Returns { writes: [{ x, y, glyph, colour }, ...], palette }; a later write replaces an earlier one.
export function growPlant(traits, visibleLines, totalLines, seed) {
    const random = makeRandom(seed);
    const writes = [];

    // records one cell, ignoring anything outside the grid
    function write(x, y, glyph, colour) {
        if (x >= 0 && x < WIDTH && y >= 0 && y < HEIGHT) {
            writes.push({ x: x, y: y, glyph: glyph, colour: colour });
        }
    }

    // the pot is plain for now; Phase 7's server signals will shape it
    const middle = Math.floor(WIDTH / 2);
    const rimY = HEIGHT - 3;
    for (let x = middle - 7; x <= middle + 7; x++) {
        write(x, rimY, "=", POT);
    }
    write(middle - 6, rimY + 1, "\\", POT);
    for (let x = middle - 5; x <= middle + 5; x++) {
        write(x, rimY + 1, "_", POT);
    }
    write(middle + 6, rimY + 1, "/", POT);

    // Bloom size follows the share of visible lines, so adding lines to the report
    // doesn't make every flower bigger. The cut-offs are the ones the first 11-line
    // list used: 5 of 11 for radius 2, 10 of 11 for radius 3, under 6 of 11 for faded petals.
    const share = visibleLines / totalLines;        // 0 (nothing visible) to 1 (everything)
    let radius = 1;
    if (share >= 10 / 11) {
        radius = 3;
    } else if (share >= 5 / 11) {
        radius = 2;
    }
    let petalColour = PETAL;
    if (share < 6 / 11) {
        petalColour = FADED_PETAL;                  // a small footprint gets a quieter flower
    }

    // opens a flower ring by ring, so it appears to unfold
    function bloom(centreX, centreY, size) {
        for (let ring = 1; ring <= size; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring * 2; dx <= ring * 2; dx++) {
                    // terminal cells are about twice as tall as wide, so x counts for half
                    const distance = Math.sqrt((dx / 2) * (dx / 2) + dy * dy);
                    if (distance <= ring && distance > ring - 1 && random() < 0.7) {  // gaps keep it looking like petals
                        write(centreX + dx, centreY + dy, traits.petal, petalColour);
                    }
                }
            }
        }
        write(centreX, centreY, "@", CENTRE);
    }

    // Each tip is a growing end. Forks add tips; a tip that runs out of life blooms.
    const tips = [];
    const forks = [];                               // new tips waiting for the next round
    const freeRows = rimY - 3;
    const stemLife = Math.round(freeRows * traits.rule.height * traits.heightScale);
    for (let i = 0; i < traits.stems; i++) {
        const offset = i - (traits.stems - 1) / 2;  // spreads the stems evenly around the middle
        let lean = traits.leanBias;
        if (offset < 0) {
            lean = -1;
        } else if (offset > 0) {
            lean = 1;
        }
        tips.push({
            x: middle + Math.round(offset * 4),
            y: rimY,
            lean: lean,
            sway: traits.rule.sway,
            life: Math.round(stemLife * (0.8 + random() * 0.2)), // stems finish at different heights
            depth: 0
        });
    }

    // moves one tip up a row; returns false when it has finished
    function growTip(tip) {
        let step = 0;
        const roll = random();
        if (roll < tip.sway) {
            step = tip.lean;
        } else if (roll < tip.sway * 1.25) {
            step = -tip.lean;                       // sometimes lean back, for a natural wobble
        }
        tip.x += step;
        tip.y -= 1;

        let glyph = "|";
        if (step > 0) {
            glyph = "/";
        } else if (step < 0) {
            glyph = "\\";
        }
        write(tip.x, tip.y, glyph, STEM);

        if (random() < traits.rule.leaf) {
            let side = 1;
            if (random() < 0.5) {
                side = -1;
            }
            write(tip.x + side, tip.y, pick(traits.leaves, random), LEAF);
        }

        // a fork leaves sideways with less life; depth 2 stops branches of branches of branches
        if (tip.depth < 2 && tip.life > 4 && random() < traits.rule.fork) {
            let forkLean = 1;
            if (random() < 0.5) {
                forkLean = -1;
            }
            forks.push({
                x: tip.x,
                y: tip.y,
                lean: forkLean,
                sway: 0.8,
                life: Math.round(tip.life * 0.6),
                depth: tip.depth + 1
            });
        }

        tip.life -= 1;
        if (tip.life <= 0 || tip.y <= radius + 1) { // keeps the flower inside the grid
            let size = radius;
            if (tip.depth > 0 && radius > 1) {
                size = radius - 1;                  // side branches carry smaller flowers
            }
            bloom(tip.x, tip.y - 1, size);
            return false;
        }
        return true;
    }

    // all tips take a step together, so the stems grow side by side
    let active = tips;
    while (active.length > 0) {
        const stillGrowing = [];
        for (const tip of active) {
            if (growTip(tip)) {
                stillGrowing.push(tip);
            }
        }
        for (const fork of forks) {                 // forks from this round start on the next
            stillGrowing.push(fork);
        }
        forks.length = 0;                           // empties the list for the next round
        active = stillGrowing;
    }

    return { writes: writes, palette: traits.palette };
}
