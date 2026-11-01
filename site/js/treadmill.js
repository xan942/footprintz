// treadmill.js — the footprints beside the page header. Decoration only: it reads no
// signals, so it can run before Generate. Each foot lands at the right end of the belt,
// gets carried left, and slides off the far end. The belt fills whatever width its box has.

const HEIGHT = 11;     // cells down: two feet of 5 rows, with one empty row between
const STRIDE = 50;     // cells between one foot and the next on the same side
const TICK_MS = 120;   // time between steps of the belt

// Footprint outlines seen from above, walking right: heel on the left, toes on the right.
// The big toe and the curve of the arch are on the inside, so the two feet mirror each other.
const LEFT_FOOT = [
    "      .------------.  o  ",
    "   .-'              `. o ",
    " .'                   ) o",
    "(          ____      /  O",
    " `-.____.-'    `---'   ()"
];
const RIGHT_FOOT = [
    " .-----.       .---.   ()",
    "(       `----'      \\  O",
    " `.                   ) o",
    "   `-.              .' o ",
    "      `------------'  o  "
];
const FOOT_WIDTH = LEFT_FOOT[0].length;

// The left foot sits on the upper lane; the right foot starts half a stride later
const LANES = [
    { sprite: LEFT_FOOT, row: 0, delay: 0 },
    { sprite: RIGHT_FOOT, row: 6, delay: STRIDE / 2 }
];

// copies a foot into the grid, cutting off anything past the left end
function drawFoot(grid, sprite, left, top, columns) {
    for (let y = 0; y < sprite.length; y++) {
        for (let i = 0; i < sprite[y].length; i++) {
            const x = left + i;
            if (x >= 0 && x < columns) {
                grid[top + y][x] = sprite[y].charAt(i);
            }
        }
    }
}

// Builds the whole picture for one step of the belt, as text
function frame(step, columns) {
    const grid = [];
    for (let y = 0; y < HEIGHT; y++) {
        grid.push(new Array(columns).fill(" "));
    }

    const landing = columns - FOOT_WIDTH;  // where a foot first appears: the right end

    for (const lane of LANES) {
        // % STRIDE: every stride the positions repeat, and a new foot lands at the right end
        let left = landing - ((step + lane.delay) % STRIDE);
        while (left > -FOOT_WIDTH) {
            drawFoot(grid, lane.sprite, left, lane.row, columns);
            left -= STRIDE;              // the next foot along, further down the belt
        }
    }

    const rows = [];
    for (const row of grid) {
        rows.push(row.join(""));
    }
    return rows.join("\n");
}

// How many cells fit across the box. A test string is measured, because the width of
// one character depends on the font and its size.
function measureColumns(box) {
    const probe = document.createElement("span");
    probe.textContent = "0000000000";
    box.textContent = "";
    box.appendChild(probe);
    const cellWidth = probe.getBoundingClientRect().width / 10;
    probe.remove();
    return Math.floor(box.clientWidth / cellWidth);
}

// Starts the belt inside box. With reduced motion on, it shows one still frame instead.
export function startTreadmill(box) {
    let step = 0;
    let columns = measureColumns(box);

    // measures again, then redraws the current step at the new width
    function resize() {
        columns = measureColumns(box);
        box.textContent = frame(step, columns);
    }

    resize();
    new ResizeObserver(resize).observe(box); // the window was resized
    document.fonts.ready.then(resize);       // the web font changed the character width

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    setInterval(function () {
        if (document.hidden) {
            return;                      // pauses while the tab isn't visible
        }
        step += 1;
        box.textContent = frame(step, columns); // same one element, updated in place
    }, TICK_MS);
}
