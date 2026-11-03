// pixel.js — draws the cell model as pixel art on a canvas. This is the alternative view.
// Each cell is 5 pixels wide and 10 tall. Text cells are about twice as tall as they are
// wide, and art.js grows its plants for that shape, so square cells would squash every
// flower to half its height.
// The sprites are botanical, not letters: each GPU vendor's leaf glyphs become their own
// leaf shape, and petals are small separate shapes, nudged off the grid so a bloom reads
// as a loose cluster. Sprites are shaded with light from the top left: each cell gets a
// darker and a lighter tone, both mixed from its own palette colour.
// A glyph with no sprite for its role falls back to a solid block that fills the whole
// cell, so adding a new glyph to art.js can never break this view.
// The canvas itself is small (240 x 320); CSS scales it up with image-rendering: pixelated.
// Nothing here reads the canvas back (no getImageData), so Brave's canvas noise and
// LibreWolf's canvas prompt never affect the art.

import { WIDTH, HEIGHT, STEM, LEAF, PETAL, CENTRE, POT, FADED_PETAL } from "./art.js";

const CELL_WIDTH = 5;     // canvas pixels per cell, across
const CELL_HEIGHT = 10;   // canvas pixels per cell, down: twice the width, like a text cell

const SHADE_AMOUNT = 0.35;      // how far "+" pixels move toward black (0 = no change, 1 = black)
const HIGHLIGHT_AMOUNT = 0.35;  // how far "*" pixels move toward white

// ── Sprites ──────────────────────────────────────────────────────────────
// Each sprite is 10 rows of 5 characters, top row first:
//   "#" the cell's palette colour     "+" a darker shade of it (the side facing away from the light)
//   "*" a lighter highlight of it     "." empty, so the page background shows through
// The light comes from the top left, so shade sits on bottom and right edges and
// highlights on top and left edges. Shapes only 1 pixel wide stay flat: a thin line
// has no sides to shade.
// Sprites are looked up by role first, then glyph, because some glyphs play two roles:
// "*" is an NVIDIA leaf and also a petal, and the two should look different.

// Stems use the full 10 rows, so stem cells stacked on top of each other join into one
// unbroken line. Each stem is 2 pixels thick: the lit pixel, then its shadow to the right.
// "/" and "\" run corner to corner, so a leaning stem steps across cleanly.
const STEM_SPRITES = {
    "|": ["..#+.", "..#+.", "..#+.", "..#+.", "..#+.",
          "..#+.", "..#+.", "..#+.", "..#+.", "..#+."],
    "/": ["....#", "....#", "...#+", "...#+", "..#+.",     // the top two rows have no room
          "..#+.", ".#+..", ".#+..", "#+...", "#+..."],    // for a shadow, so they stay thin
    "\\": ["#+...", "#+...", ".#+..", ".#+..", "..#+.",    // "\\" is one backslash: a lone
           "..#+.", "...#+", "...#+", "....#", "....#"]    // "\" starts an escape in a string
};

// Leaves: one shape per GPU vendor group (LEAF_GLYPHS in art.js), so the GPU trait shows
// as a kind of leaf rather than a choice of punctuation.
const LEAF_SPRITES = {
    // AMD: broad leaves, slanting opposite ways
    "&": [".....", "...*#", "..*##", ".*##+", "*##+.",
          "##+..", "#+...", "+....", ".....", "....."],
    "%": [".....", "*#...", "*##..", "###+.", ".###+",
          "..##+", "...#+", "....+", ".....", "....."],

    // NVIDIA: spiky, serrated leaves ("x" is all thin spikes, so it stays flat)
    "*": [".....", "#.#.#", ".*##.", "*###+", ".##+.",
          "####+", ".#++.", "#.#.+", ".....", "....."],
    "+": [".....", "..#..", "#.#.#", ".*#+.", "*###+",
          ".##+.", "#.#.+", "..+..", ".....", "....."],
    "x": [".....", "#...#", "##.##", ".###.", "..#..",
          ".###.", "##.##", "#...#", ".....", "....."],

    // Intel: round berries, one or a pair
    "o": [".....", ".....", ".....", ".*##.", "*###+",
          "####+", "###++", ".+++.", ".....", "....."],
    "0": [".....", ".*#..", "*##+.", "##++.", ".++..",
          "..*#.", ".*##+", ".##++", "..++.", "....."],

    // Apple: curled crescents, and a tendril (thin, so flat)
    "(": [".....", "..*##", ".*#..", "*#...", "*#...",
          "##...", "#+...", ".#+..", "..#++", "....."],
    ")": [".....", "*##..", "..*#.", "...#+", "...#+",
          "...#+", "...#+", "..#+.", "#++..", "....."],
    "~": [".....", ".###.", "#...#", "#.#.#", "#..#.",
          ".#...", "..##.", "....#", ".....", "....."],

    // Qualcomm-ARM: needles, like a conifer sprig pointing up or down (thin, so flat)
    "^": ["..#..", "..#..", ".#.#.", ".#.#.", "#.#.#",
          "#.#.#", "..#..", "..#..", ".....", "....."],
    "v": ["..#..", "..#..", "#.#.#", "#.#.#", ".#.#.",
          ".#.#.", "..#..", "..#..", ".....", "....."],

    // software renderer: square, blocky leaves, each block lit like a small cube
    "[": [".....", "*#+..", "##+..", "+++..", ".....",
          "..*#+", "..##+", "..+++", ".....", "....."],
    "]": [".....", "..*#+", "..##+", "..+++", ".....",
          "*#+..", "##+..", "+++..", ".....", "....."],
    "=": [".....", "*###+", "+++++", ".....", ".....",
          "*###+", "+++++", ".....", ".....", "....."],

    // hidden GPU: tiny buds, still the deliberately plain set (too small to shade)
    ".": [".....", ".....", ".....", ".....", "..#..",
          ".###.", "..#..", ".....", ".....", "....."],
    ",": [".....", ".....", ".....", ".....", ".#...",
          "###..", ".#.#.", "..###", "...#.", "....."]
};

// Petals are small separate shapes with empty space around them, like the leaves.
// Cell-filling petals merged into slabs and stripes; with gaps, a bloom reads as a
// cluster of petals around its centre. Each petal glyph (PETAL_GLYPHS in art.js)
// keeps its own shape, so the genome's petal choice still shows.
const PETAL_SPRITES = {
    "o": [".....", ".....", "..*..", ".*##.", ".*#+.",     // round pill
          ".##+.", ".#++.", "..+..", ".....", "....."],
    "0": [".....", "..*..", ".*##.", ".*#+.", ".##+.",     // long oval
          ".##+.", ".##+.", ".#++.", "..+..", "....."],
    "*": [".....", "..*..", "..#..", ".*##.", ".##+.",     // teardrop with a pointed tip
          ".##+.", ".#++.", "..+..", ".....", "....."],
    "#": [".....", ".....", "..*..", ".*#+.", ".##+.",     // small diamond: 3 wide, so its
          ".#++.", "..+..", ".....", ".....", "....."],    // points never touch a neighbour's
    "%": [".....", ".....", ".*.#.", ".*##.", ".##+.",     // ruffled at both ends
          ".##+.", ".#++.", ".#.+.", ".....", "....."],
    "+": [".....", ".....", "..*..", ".*#+.", ".#.+.",     // four small lobes around a gap
          ".#++.", "..+..", ".....", ".....", "....."]
};

// Nudges a petal a little inside its cell, so the petals of a bloom don't sit in
// straight rows and columns (which made blooms look like cross-stitch).
// The nudge comes from the cell's position, not from a random number, so the same
// cell always moves the same way and a redraw after a view switch looks identical.
// Returns { x, y } in canvas pixels: x is -1, 0 or 1; y is -2 to 2.
function petalNudge(cell) {
    const x = ((cell.x * 7 + cell.y * 13) % 3) - 1;   // % 3 gives 0-2; minus 1 gives -1 to 1
    const y = ((cell.x * 11 + cell.y * 5) % 5) - 2;   // % 5 gives 0-4; minus 2 gives -2 to 2
    return { x: x, y: y };                            // different multipliers, so x and y don't move together
}

// The flower centre: a full disc with one speckle, larger than any petal so it stands out
const CENTRE_SPRITES = {
    "@": [".....", ".*##.", "**##+", "*###+", "##.#+",
          "###++", "##+++", ".+++.", ".....", "....."]
};

// The pot: a solid rim band, a solid body, and slanted sides, so it reads as one pot
// rather than the ASCII "===" and "\___/" lines. The rim's top edge catches the light;
// the left side faces the light and the right side faces away.
const POT_SPRITES = {
    "=": [".....", ".....", ".....", ".....", "*****",     // rim band, lower half of its row
          "#####", "#####", "#####", "#####", "+++++"],
    "_": ["#####", "#####", "#####", "#####", "#####",     // body, under the rim
          "#####", "+++++", ".....", ".....", "....."],
    "\\": ["*####", "*####", ".*###", ".*###", "..*##",    // left side: narrows downward
           "..*##", "...++", ".....", ".....", "....."],
    "/": ["####+", "####+", "###+.", "###+.", "##+..",     // right side: mirror of the left
          "##+..", "++...", ".....", ".....", "....."]
};

// Finds the sprite for one cell: the table for its role, then the glyph in that table.
// Returns undefined when there isn't one, and draw() falls back to a solid block.
function spriteFor(cell) {
    let table = null;
    if (cell.colour === STEM) {
        table = STEM_SPRITES;
    } else if (cell.colour === LEAF) {
        table = LEAF_SPRITES;
    } else if (cell.colour === PETAL || cell.colour === FADED_PETAL) {
        table = PETAL_SPRITES;                  // a faded petal has the same shape, only a quieter colour
    } else if (cell.colour === CENTRE) {
        table = CENTRE_SPRITES;
    } else if (cell.colour === POT) {
        table = POT_SPRITES;
    }

    if (table === null) {
        return undefined;                       // a role this file doesn't know yet
    }
    return table[cell.glyph];
}

// ── Shading ──────────────────────────────────────────────────────────────

// Moves a "#rrggbb" colour part of the way toward another colour.
// target is 0 (black) or 255 (white); amount is 0 (no change) to 1 (all the way).
function mixColour(hex, target, amount) {
    const red = parseInt(hex.slice(1, 3), 16);       // "#73a857" -> "73" -> 115
    const green = parseInt(hex.slice(3, 5), 16);
    const blue = parseInt(hex.slice(5, 7), 16);

    const newRed = Math.round(red + (target - red) * amount);
    const newGreen = Math.round(green + (target - green) * amount);
    const newBlue = Math.round(blue + (target - blue) * amount);
    return "rgb(" + newRed + ", " + newGreen + ", " + newBlue + ")";
}

// Remembers each colour's three tones once worked out, because the same few palette
// colours are drawn thousands of times per plant.
const toneCache = new Map();

// The three tones for one palette colour: { base, shade, highlight }
function tonesFor(hex) {
    let tones = toneCache.get(hex);
    if (tones === undefined) {
        tones = {
            base: hex,
            shade: mixColour(hex, 0, SHADE_AMOUNT),             // toward black
            highlight: mixColour(hex, 255, HIGHLIGHT_AMOUNT)    // toward white
        };
        toneCache.set(hex, tones);
    }
    return tones;
}

// ── View ─────────────────────────────────────────────────────────────────

// Sizes the canvas to the grid and returns the functions that draw on it,
// the same { clear, draw } pair as createAsciiView, so main.js can drive either view.
// Returns null if the browser has canvas drawing turned off.
export function createPixelView(canvas) {
    canvas.width = WIDTH * CELL_WIDTH;      // 240: the drawing surface's real size, not its size on screen
    canvas.height = HEIGHT * CELL_HEIGHT;   // 320

    const ctx = canvas.getContext("2d");   // the 2D drawing tools for this canvas
    if (ctx === null) {
        return null;                        // main.js then offers the ASCII view only
    }

    // empties the canvas, ready for the next plant
    function clear() {
        ctx.clearRect(0, 0, canvas.width, canvas.height); // transparent, so the page background shows through
    }

    // Draws one write from the cell model: the sprite for its role and glyph, shaded in
    // tones of the cell's colour. A later write to the same cell replaces the earlier one,
    // just as in the ASCII view, so the cell is wiped first: a sprite doesn't cover every
    // pixel of its cell.
    function draw(cell, palette) {
        const left = cell.x * CELL_WIDTH;                 // the cell's top-left corner on the canvas
        const top = cell.y * CELL_HEIGHT;
        const tones = tonesFor(palette[cell.colour]);     // the same base colour the ASCII view uses

        ctx.clearRect(left, top, CELL_WIDTH, CELL_HEIGHT);

        const sprite = spriteFor(cell);
        if (sprite === undefined) {
            ctx.fillStyle = tones.base;
            ctx.fillRect(left, top, CELL_WIDTH, CELL_HEIGHT); // no sprite: a solid block
            return;
        }

        // petals get nudged off the grid; stems, leaves and the pot stay put so they keep joining up
        let nudge = { x: 0, y: 0 };
        if (cell.colour === PETAL || cell.colour === FADED_PETAL) {
            nudge = petalNudge(cell);
        }

        for (let row = 0; row < CELL_HEIGHT; row++) {
            for (let column = 0; column < CELL_WIDTH; column++) {
                const pixel = sprite[row].charAt(column);
                const x = column + nudge.x;               // where this pixel lands inside the cell
                const y = row + nudge.y;
                const inside = x >= 0 && x < CELL_WIDTH && y >= 0 && y < CELL_HEIGHT;
                // a pixel nudged past the cell's edge is skipped: drawing it would spill into
                // the next cell, and that cell's clearRect would later cut it off unevenly
                if (inside && pixel !== ".") {
                    if (pixel === "+") {
                        ctx.fillStyle = tones.shade;
                    } else if (pixel === "*") {
                        ctx.fillStyle = tones.highlight;
                    } else {
                        ctx.fillStyle = tones.base;       // "#"
                    }
                    ctx.fillRect(left + x, top + y, 1, 1); // one canvas pixel
                }
            }
        }
    }

    return { clear: clear, draw: draw };
}
