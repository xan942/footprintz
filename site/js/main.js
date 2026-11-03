// main.js — wires the page to the modules: Generate collects the signals,
// starts the live flower and fills in the report. The view toggle switches the
// flower between the ASCII view and the pixel view; both draw the same plant.

import { collectSignals } from "./signals.js";
import { genomeSeed, growthSeed } from "./seed.js";
import { makeTraits, growPlant } from "./art.js";
import { createAsciiView } from "./ascii.js";
import { createPixelView } from "./pixel.js";
import { renderReport, buildLines } from "./report.js";
import { startTreadmill } from "./treadmill.js";

const TICK_MS = 30;          // time between animation steps
const WRITES_PER_TICK = 3;   // cells drawn each step
const HOLD_TICKS = 150;      // finished flower stays for 150 ticks (about 4.5 s)

const button = document.getElementById("generate");
const toggle = document.getElementById("view-toggle");
const reportBox = document.getElementById("report");
const summaryBox = document.getElementById("summary");
const artBox = document.getElementById("art");
const pixelBox = document.getElementById("pixels");

const asciiView = createAsciiView(artBox);
const pixelView = createPixelView(pixelBox); // null if the browser turns canvas drawing off
let view = asciiView;        // the view being drawn on; the toggle swaps it
let plant = null;            // the plant on screen, kept so a view switch can redraw it
let drawn = 0;               // how many of its writes are on screen so far
let loopTimer = null;        // the running loop, so it can be stopped
let reducedMotion = false;   // the visitor's preference, read on Generate
let totalLines = 1;          // how many lines the report has; set on Generate

// Draws the current plant's first `drawn` writes onto the current view, from a blank start.
// Used after a view switch, so the new view picks up exactly where the old one was.
function redraw() {
    view.clear();
    if (plant === null) {
        return;              // nothing has been generated yet
    }
    for (let i = 0; i < drawn; i++) {
        view.draw(plant.writes[i], plant.palette);
    }
}

// Grow -> hold -> clear -> regrow from the same genome, forever (like cbonsai -l -i).
// It reads `view` on every tick, so a view switch mid-growth carries straight on.
function startLoop(traits, visibleLines) {
    plant = growPlant(traits, visibleLines, totalLines, growthSeed());
    drawn = 0;
    let held = 0;            // how many ticks the finished flower has been held

    view.clear();
    loopTimer = setInterval(function () {
        if (document.hidden) {
            return;          // pauses while the tab isn't visible
        }

        if (drawn < plant.writes.length) {
            for (let i = 0; i < WRITES_PER_TICK && drawn < plant.writes.length; i++) {
                view.draw(plant.writes[drawn], plant.palette);
                drawn += 1;
            }
        } else if (held < HOLD_TICKS) {
            held += 1;
        } else {
            plant = growPlant(traits, visibleLines, totalLines, growthSeed()); // the old plant is thrown away here
            drawn = 0;
            held = 0;
            view.clear();
        }
    }, TICK_MS);
}

// Replaces whatever is growing with a new flower of this size
function showFlower(traits, visibleLines) {
    clearInterval(loopTimer);
    if (reducedMotion) {
        plant = growPlant(traits, visibleLines, totalLines, growthSeed()); // one finished flower, no loop
        drawn = plant.writes.length;  // all of it
        redraw();
    } else {
        startLoop(traits, visibleLines);
    }
}

// Swaps between the ASCII and pixel views, then redraws the plant on the new one
function switchView() {
    if (view === asciiView) {
        view = pixelView;
        artBox.hidden = true;            // hidden: the browser stops showing the element
        pixelBox.hidden = false;
        toggle.textContent = "ASCII view"; // the button names the view it switches to
    } else {
        view = asciiView;
        pixelBox.hidden = true;
        artBox.hidden = false;
        toggle.textContent = "pixel view";
    }
    redraw();
}

startTreadmill(document.getElementById("treadmill"));

if (pixelView === null) {
    toggle.hidden = true;    // no canvas drawing: the ASCII view is the only one
} else {
    toggle.addEventListener("click", switchView);
}

// Signals are collected only after the visitor clicks Generate (consent rule)
button.addEventListener("click", async function () {
    button.disabled = true; // stops a second click while the first one is still collecting
    reportBox.textContent = "collecting...";
    summaryBox.textContent = "";
    clearInterval(loopTimer); // stops the previous flower, if there is one

    try {
        const signals = await collectSignals();
        const genome = await genomeSeed(signals);
        const traits = makeTraits(signals, genome);
        reducedMotion = signals.appearance.value.reducedMotion;
        totalLines = buildLines(signals).length; // the bloom uses the share of lines visible, not the count

        // a preview toggle regrows the same plant type at the new size
        const visibleLines = renderReport(reportBox, summaryBox, signals, function (previewCount) {
            showFlower(traits, previewCount);
        });

        // a screen reader can't read ASCII art or a canvas, so the labels describe it
        artBox.setAttribute("aria-label", "A flower grown from your browser's footprint.");
        pixelBox.setAttribute("aria-label", "A flower grown from your browser's footprint.");
        showFlower(traits, visibleLines);
    } catch (error) {
        console.error(error);   // the detail goes to DevTools, not onto the page
        reportBox.textContent = "Something stopped the report from finishing. Try Generate again.";
    } finally {
        button.disabled = false; // finally: runs on success and on failure
    }
});
