/* Line-number gutter.
 *
 * Puts an absolutely positioned, read-only div to the left of a textarea. It adds
 * NOTHING to the text: prompt fragments have to stay byte-for-byte what the user
 * typed. Numbers are the index the backend sees, so a skipped blank line gets a
 * faint dot instead of a number, wrapped continuation lines get blank space, and
 * the active index is highlighted.
 */

import { splitLines } from "./text.js";

const GUTTER_MIN_W = 22;
const GUTTER_GAP = 8;
const COL_IDLE = "#5f5f5f";
const COL_EMPTY = "#3f3f3f";
const COL_ACTIVE = "#e2b04a";

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {() => number} getActive  index to highlight; return -1 for none
 * @param {() => boolean} [getSkip] whether blank lines are skipped (default: always)
 * @returns {{ render: () => void, element: HTMLElement, destroy: () => void } | null}
 */
export function attachGutter(textarea, getActive, getSkip = () => true) {
    const parent = textarea.parentElement;
    if (!parent) return null;
    // The gutter positions itself against the parent, which therefore must not be
    // static. Touching the textarea's own layout would fight ComfyUI's sizing.
    if (getComputedStyle(parent).position === "static") {
        parent.style.position = "relative";
    }

    const gutter = document.createElement("div");
    Object.assign(gutter.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
        textAlign: "right",
        zIndex: "1",
    });
    parent.appendChild(gutter);

    // Hidden twin of the textarea, used to measure how tall each line renders once
    // it wraps. There is no API for "height of line N", so it gets measured.
    const mirror = document.createElement("div");
    Object.assign(mirror.style, {
        position: "absolute",
        left: "0px",
        top: "0px",
        visibility: "hidden",
        pointerEvents: "none",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        wordBreak: "normal",
        boxSizing: "content-box",
    });
    parent.appendChild(mirror);

    let lastPad = -1;

    const render = () => {
        const skip = getSkip();
        const active = getActive();
        const lines = splitLines(textarea.value || "");

        // Width follows the largest index, so a 100-line list does not clip its own
        // numbers and a short one does not waste space.
        let counted = 0;
        for (const l of lines) {
            if (!(skip && l.trim() === "")) counted++;
        }
        const digits = String(Math.max(0, counted - 1)).length;
        const gw = Math.max(GUTTER_MIN_W, 8 + digits * 7);

        // Padding is only written when it actually changes: assigning it on every
        // render costs a layout pass per keystroke.
        const pad = gw + GUTTER_GAP;
        if (pad !== lastPad) {
            textarea.style.paddingLeft = pad + "px";
            lastPad = pad;
        }

        // Both the mirror and the gutter must inherit the textarea's typography, or
        // the measured heights describe a different font than the one on screen.
        const cs = getComputedStyle(textarea);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const padT = parseFloat(cs.paddingTop) || 0;
        const contentW = Math.max(10, textarea.clientWidth - padL - padR);

        for (const el of [mirror, gutter]) {
            el.style.fontFamily = cs.fontFamily;
            el.style.fontSize = cs.fontSize;
            el.style.fontWeight = cs.fontWeight;
            el.style.lineHeight = cs.lineHeight;
            el.style.letterSpacing = cs.letterSpacing;
        }
        mirror.style.width = contentW + "px";
        gutter.style.width = gw + "px";
        gutter.style.paddingTop = padT + "px";

        mirror.textContent = "";
        const probes = [];
        for (const l of lines) {
            const d = document.createElement("div");
            // A zero-width space keeps an empty line one line tall instead of zero.
            d.textContent = l === "" ? "\u200b" : l;
            mirror.appendChild(d);
            probes.push(d);
        }

        const heights = probes.map((d) => d.offsetHeight);

        gutter.textContent = "";
        let n = 0;
        lines.forEach((l, i) => {
            const isEmpty = l.trim() === "";
            const row = document.createElement("div");
            row.style.height = heights[i] + "px";
            row.style.overflow = "hidden";
            row.style.paddingRight = "2px";

            // Blank lines are invisible to the backend, so they get a dot rather than
            // a number: the count keeps running underneath them.
            if (skip && isEmpty) {
                row.textContent = "\u00b7";
                row.style.color = COL_EMPTY;
            } else {
                const idx = n++;
                row.textContent = String(idx);
                row.style.color = idx === active ? COL_ACTIVE : COL_IDLE;
                if (idx === active) row.style.fontWeight = "bold";
            }
            gutter.appendChild(row);
        });

        gutter.scrollTop = textarea.scrollTop;
    };

    const onScroll = () => {
        gutter.scrollTop = textarea.scrollTop;
    };
    textarea.addEventListener("scroll", onScroll);

    // Width changes rewrap the text and move every number. Height changes do not, so
    // the observer filters on width to avoid re-rendering while the node is resized.
    let ro = null;
    if (window.ResizeObserver) {
        let lastW = -1;
        ro = new ResizeObserver(() => {
            if (textarea.clientWidth !== lastW) {
                lastW = textarea.clientWidth;
                render();
            }
        });
        ro.observe(textarea);
    }

    // Callers must be able to unhook: a Vue re-render can drop our nodes from the
    // DOM, and the caller then rebuilds the gutter from scratch.
    const destroy = () => {
        textarea.removeEventListener("scroll", onScroll);
        ro?.disconnect();
        gutter.remove();
        mirror.remove();
    };

    return { render, element: gutter, destroy };
}
