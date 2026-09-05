/* Satir numarasi gutter'i.
 *
 * Textarea'nin soluna absolute konumlu, salt okunur bir div koyar. Metne
 * HICBIR SEY eklemez; prompt fragment'lerinin birebir kalmasi zorunlu.
 * Numaralar backend'in gordugu index'tir: bos satir numara almaz, soluk "."
 * gorur; sarma yapan satirin devam satirlari bos kalir; aktif index sari.
 */

import { splitLines } from "./text.js";

const GUTTER_MIN_W = 22;
const GUTTER_GAP = 8;
const COL_IDLE = "#5f5f5f";
const COL_EMPTY = "#3f3f3f";
const COL_ACTIVE = "#e2b04a";

/**
 * @param {HTMLTextAreaElement} textarea
 * @param {() => number} getActive  vurgulanacak index; yoksa -1 dondur
 * @param {() => boolean} [getSkip] bos satir atlaniyor mu (varsayilan: her zaman)
 * @returns {{ render: () => void, element: HTMLElement, destroy: () => void } | null}
 */
export function attachGutter(textarea, getActive, getSkip = () => true) {
    const parent = textarea.parentElement;
    if (!parent) return null;
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

    // sarma yuksekligini olcmek icin gizli ayna
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

        // en buyuk index'e gore genislik
        let counted = 0;
        for (const l of lines) {
            if (!(skip && l.trim() === "")) counted++;
        }
        const digits = String(Math.max(0, counted - 1)).length;
        const gw = Math.max(GUTTER_MIN_W, 8 + digits * 7);

        const pad = gw + GUTTER_GAP;
        if (pad !== lastPad) {
            textarea.style.paddingLeft = pad + "px";
            lastPad = pad;
        }

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

    const destroy = () => {
        textarea.removeEventListener("scroll", onScroll);
        ro?.disconnect();
        gutter.remove();
        mirror.remove();
    };

    return { render, element: gutter, destroy };
}
