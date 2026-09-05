import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE = "ListPick";
const LIST = "string_list";
const IDX = "start_index";
const SKIP = "skip_empty";
const MODE = "control_after_generation";

const ROW_H = 26;
const ROW_SLOT = ROW_H + 8;
const NODE_PAD = 10;

const GUTTER_MIN_W = 22;
const GUTTER_GAP = 8;
const COL_IDLE = "#5f5f5f";
const COL_EMPTY = "#3f3f3f";
const COL_ACTIVE = "#e2b04a";

function splitLines(text) {
    if (typeof text !== "string") return [];
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function lineCount(text, skipEmpty) {
    if (typeof text !== "string" || text.length === 0) return 0;
    let lines = splitLines(text);
    if (skipEmpty) lines = lines.filter((l) => l.trim() !== "");
    return lines.length;
}

/* ---------- salt okunur gosterge satiri (DOM widget) ---------- */

function makeRow(label) {
    const row = document.createElement("div");
    Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        boxSizing: "border-box",
        width: "100%",
        height: ROW_H + "px",
        padding: "0 12px",
        margin: "0",
        background: "#1b1b1b",
        border: "1px solid #3a3a3a",
        borderRadius: ROW_H / 2 + "px",
        font: "12px Arial, sans-serif",
        color: "#787878",
        overflow: "hidden",
        pointerEvents: "none",
        userSelect: "none",
    });

    const l = document.createElement("span");
    l.textContent = label;
    l.style.whiteSpace = "nowrap";

    const v = document.createElement("span");
    v.textContent = "-";
    Object.assign(v.style, {
        color: "#d8d8d8",
        whiteSpace: "nowrap",
        marginLeft: "8px",
    });

    row.appendChild(l);
    row.appendChild(v);
    return { row, valueEl: v };
}

function addDisplay(node, name, label) {
    const { row, valueEl } = makeRow(label);

    if (typeof node.addDOMWidget !== "function") {
        const w = node.addWidget("text", label, "-", () => {}, { serialize: false });
        w.disabled = true;
        return { set: (v) => { w.value = String(v); } };
    }

    const w = node.addDOMWidget(name, "lp_display", row, {
        serialize: false,
        hideOnZoom: false,
        getValue: () => valueEl.textContent,
                                setValue: (v) => { valueEl.textContent = String(v); },
                                getMinHeight: () => ROW_SLOT,
                                getMaxHeight: () => ROW_SLOT,
    });
    if (w) {
        w.serialize = false;
        w.computeSize = () => [0, ROW_SLOT];
    }

    return { set: (v) => { valueEl.textContent = String(v); } };
}

/* ---------- satir numarasi gutter'i ---------- */

function attachGutter(textarea, getSkip, getActive) {
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

    textarea.addEventListener("scroll", () => {
        gutter.scrollTop = textarea.scrollTop;
    });

    if (window.ResizeObserver) {
        let lastW = -1;
        const ro = new ResizeObserver(() => {
            if (textarea.clientWidth !== lastW) {
                lastW = textarea.clientWidth;
                render();
            }
        });
        ro.observe(textarea);
    }

    return { render };
}

/* ---------- extension ---------- */

app.registerExtension({
    name: "bulentgercek.list_pick",

    async setup() {
        if (app.__lpQueueHooked) return;
        app.__lpQueueHooked = true;

        const origQueuePrompt = app.queuePrompt.bind(app);
        app.queuePrompt = async (...args) => {
            const nodes = (app.graph?._nodes || []).filter((n) => n.comfyClass === NODE);
            if (nodes.length) {
                for (const n of nodes) n.__lpReset?.(); // gutter aninda lo'ya doner
                try {
                    await api.fetchApi("/bulentgercek/list_pick/reset", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ ids: nodes.map((n) => String(n.id)) }),
                    });
                } catch (e) {
                    console.warn("[list_pick] reset call failed", e);
                }
            }
            return origQueuePrompt(...args);
        };

        // Queue tamamen bosaldiginda (kuyrukta ve calisan is kalmadiginda)
        // gutter'i son gerceklesen sonuc yerine yine ayarlanan degerlere dondur.
        let lastQueueRemaining = 0;
        api.addEventListener("status", (e) => {
            const remaining = e?.detail?.exec_info?.queue_remaining ?? 0;
            if (remaining === 0 && lastQueueRemaining > 0) {
                for (const n of app.graph?._nodes || []) {
                    if (n.comfyClass === NODE) n.__lpReset?.();
                }
            }
            lastQueueRemaining = remaining;
        });
    },

    async nodeCreated(node) {
        if (node.comfyClass !== NODE) return;

        const find = (n) => node.widgets?.find((w) => w.name === n);
        const listW = find(LIST);
        const idxW = find(IDX);
        const skipW = find(SKIP);
        const modeW = find(MODE);
        if (!listW || !idxW) return;

        const resD = addDisplay(node, "lp_result", "generation result");
        const cntD = addDisplay(node, "lp_count", "count");

        let activeIndex = -1;
        let previewMode = true; // true: activeIndex bir sonraki pick() tahmini; false: gercek sonuc
        let stateLo = null;
        let stateMax = null;
        let gutter = null;

        const fitSize = () => {
            const min = node.computeSize();
            node.setSize([
                Math.max(node.size[0], min[0]),
                         Math.max(node.size[1], min[1] + NODE_PAD),
            ]);
            node.setDirtyCanvas?.(true, true);
        };

        let lastText = null;
        let lastSkip = null;
        let lastMode = null;
        let lastIdx = null;

        const sync = () => {
            const skip = skipW ? !!skipW.value : true;
            const text = typeof listW.value === "string" ? listW.value : "";
            const n = lineCount(text, skip);
            const max = n > 0 ? n - 1 : 0;

            idxW.options = idxW.options || {};
            idxW.options.min = 0;
            idxW.options.max = max;

            if (typeof idxW.value !== "number" || Number.isNaN(idxW.value)) idxW.value = 0;
            if (idxW.value > max) idxW.value = max;
            if (idxW.value < 0) idxW.value = 0;

            cntD.set(n);

            const lo = idxW.value;
            const mode = modeW ? modeW.value : "fixed";
            const loChanged = stateLo !== lo || stateMax !== max;

            if (n === 0) {
                resD.set("-");
                activeIndex = -1;
                previewMode = true;
            } else if (mode === "fixed") {
                // fixed her zaman deterministik: sonuc = lo, run'a gerek yok
                resD.set(lo);
                activeIndex = lo;
                previewMode = true;
                stateLo = lo;
                stateMax = max;
            } else if (mode === "randomize") {
                // gercek sonuc gelene kadar bilinemez
                if (previewMode) {
                    resD.set("-");
                    activeIndex = -1;
                }
                if (loChanged) {
                    stateLo = lo;
                    stateMax = max;
                }
            } else {
                // increment / decrement: backend'in reset kosuluyla ayni mantik —
                // lo/count degistiyse veya henuz gercek sonuc yoksa bir sonraki
                // pick() kesin olarak lo'yu secer (bkz. list_pick.py reset kosulu).
                if (previewMode || loChanged) {
                    resD.set(lo);
                    activeIndex = lo;
                    previewMode = true;
                    stateLo = lo;
                    stateMax = max;
                }
            }

            gutter?.render();
            node.setDirtyCanvas?.(true, true);
        };

        const hookTextarea = () => {
            const el = listW.inputEl;
            if (el && !el.__lpHooked) {
                el.__lpHooked = true;
                el.addEventListener("input", sync);
                el.addEventListener("change", sync);
                gutter = attachGutter(
                    el,
                    () => (skipW ? !!skipW.value : true),
                                      () => activeIndex
                );
                gutter?.render();
            }
        };

        for (const w of [listW, skipW, modeW, idxW]) {
            if (!w) continue;
            const cb = w.callback;
            w.callback = function (...a) {
                const r = cb?.apply(this, a);
                sync();
                return r;
            };
        }

        node.__lpReset = () => {
            previewMode = true;
            sync();
        };

        const onConf = node.onConfigure;
        node.onConfigure = function (...a) {
            const r = onConf?.apply(this, a);
            setTimeout(() => { hookTextarea(); sync(); fitSize(); }, 0);
            return r;
        };

        const onExec = node.onExecuted;
        node.onExecuted = function (message) {
            const r = onExec?.apply(this, arguments);
            const d = message?.list_pick?.[0];
            if (d) {
                activeIndex = d.index;
                resD.set(d.index < 0 ? "-" : d.index);
                cntD.set(d.count);
                previewMode = false;
                stateLo = idxW.value;
                stateMax = d.count > 0 ? d.count - 1 : 0;
                gutter?.render();
                node.setDirtyCanvas?.(true, true);
            }
            return r;
        };

        const onDraw = node.onDrawForeground;
        node.onDrawForeground = function (...a) {
            const curSkip = skipW ? skipW.value : null;
            const curMode = modeW ? modeW.value : null;
            if (
                listW.value !== lastText ||
                curSkip !== lastSkip ||
                curMode !== lastMode ||
                idxW.value !== lastIdx
            ) {
                lastText = listW.value;
                lastSkip = curSkip;
                lastMode = curMode;
                lastIdx = idxW.value;
                hookTextarea();
                sync();
            }
            return onDraw?.apply(this, a);
        };

        setTimeout(() => { hookTextarea(); sync(); fitSize(); }, 0);
    },
});
