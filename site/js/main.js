// main.js — wires the page to the modules: Generate collects the signals,
// starts the live flower and fills in the report.

import { collectSignals } from "./signals.js";
import { genomeSeed, growthSeed } from "./seed.js";
import { makeTraits, growPlant } from "./art.js";
import { createAsciiView } from "./ascii.js";
import { renderReport } from "./report.js";

const TICK_MS = 30;          // time between animation steps
const WRITES_PER_TICK = 3;   // cells drawn each step
const HOLD_TICKS = 150;      // finished flower stays for 150 ticks (about 4.5 s)

const button = document.getElementById("generate");
const reportBox = document.getElementById("report");
const artBox = document.getElementById("art");

const view = createAsciiView(artBox);
let loopTimer = null;        // the running loop, so it can be stopped
let reducedMotion = false;   // the visitor's preference, read on Generate

// Draws a whole plant at once
function drawAll(plant) {
    view.clear();
    for (const cell of plant.writes) {
        view.draw(cell, plant.palette);
    }
}

// Grow -> hold -> clear -> regrow from the same genome, forever (like cbonsai -l -i)
function startLoop(traits, visibleLines) {
    let plant = growPlant(traits, visibleLines, growthSeed());
    let position = 0;        // how many writes have been drawn
    let held = 0;            // how many ticks the finished flower has been held

    view.clear();
    loopTimer = setInterval(function () {
        if (document.hidden) {
            return;          // pauses while the tab isn't visible
        }

        if (position < plant.writes.length) {
            for (let i = 0; i < WRITES_PER_TICK && position < plant.writes.length; i++) {
                view.draw(plant.writes[position], plant.palette);
                position += 1;
            }
        } else if (held < HOLD_TICKS) {
            held += 1;
        } else {
            plant = growPlant(traits, visibleLines, growthSeed()); // the old plant is thrown away here
            position = 0;
            held = 0;
            view.clear();
        }
    }, TICK_MS);
}

// Replaces whatever is growing with a new flower of this size
function showFlower(traits, visibleLines) {
    clearInterval(loopTimer);
    if (reducedMotion) {
        drawAll(growPlant(traits, visibleLines, growthSeed())); // one finished flower, no loop
    } else {
        startLoop(traits, visibleLines);
    }
}

// Signals are collected only after the visitor clicks Generate (consent rule)
button.addEventListener("click", async function () {
    button.disabled = true; // stops a second click while the first one is still collecting
    reportBox.textContent = "collecting...";
    clearInterval(loopTimer); // stops the previous flower, if there is one

    try {
        const signals = await collectSignals();
        const genome = await genomeSeed(signals);
        const traits = makeTraits(signals, genome);
        reducedMotion = signals.appearance.value.reducedMotion;

        // a preview toggle regrows the same plant type at the new size
        const visibleLines = renderReport(reportBox, signals, function (previewCount) {
            showFlower(traits, previewCount);
        });

        // a screen reader can't read ASCII art, so the label describes it
        artBox.setAttribute("aria-label", "A flower grown from your browser's footprint.");
        showFlower(traits, visibleLines);
    } catch (error) {
        console.error(error);   // the detail goes to DevTools, not onto the page
        reportBox.textContent = "Something stopped the report from finishing. Try Generate again.";
    } finally {
        button.disabled = false; // finally: runs on success and on failure
    }
});
