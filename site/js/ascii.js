// ascii.js — draws the cell model as coloured text. This is the main view.
// One <span> per cell, made once and reused, so the live loop doesn't keep adding to the page.

import { WIDTH, HEIGHT } from "./art.js";

// Fills the container with an empty grid and returns the functions that draw on it
export function createAsciiView(container) {
    const cells = [];                               // cells[y][x] is one <span>
    container.textContent = "";                     // removes any earlier grid

    for (let y = 0; y < HEIGHT; y++) {
        const row = [];
        for (let x = 0; x < WIDTH; x++) {
            const span = document.createElement("span");
            span.textContent = " ";
            container.appendChild(span);
            row.push(span);
        }
        container.appendChild(document.createTextNode("\n")); // ends the row inside the <pre>
        cells.push(row);
    }

    // blanks every cell, ready for the next plant
    function clear() {
        for (const row of cells) {
            for (const span of row) {
                span.textContent = " ";
            }
        }
    }

    // draws one write from the cell model
    function draw(cell, palette) {
        const span = cells[cell.y][cell.x];
        span.textContent = cell.glyph;
        // .style from a script file is allowed by the CSP (only inline style="" markup is blocked)
        span.style.color = palette[cell.colour];
    }

    return { clear: clear, draw: draw };
}
