/* List Pick — node face.
 *
 * The server decides which line is picked; this file only previews that decision and
 * shows the result. Two read-only rows carry the last index and the line count, the
 * gutter numbers the list, and a Queue hook makes both snap back to previewing
 * start_index whenever a new queue action starts.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { lineCount } from "./lib/text.js";
import { attachGutter } from "./lib/gutter.js";
import { addReadonlyRow } from "./lib/readonly_row.js";

const NODE = "ListPick";
const LIST = "string_list";
const IDX = "start_index";
const SKIP = "skip_empty";
const MODE = "control_after_generation";

const NODE_PAD = 10;

/* ---------- extension ---------- */

app.registerExtension({
    name: "bulentgercek.list_pick",

    async setup() {
        // The hooks below are global, so they are installed once no matter how many
        // List Pick nodes the graph holds.
        if (app.__lpQueueHooked) return;
        app.__lpQueueHooked = true;

        const origQueuePrompt = app.queuePrompt.bind(app);
        // The reset call is fired but never awaited before handing over to the original
        // queuePrompt: any delay inserted here triggers ComfyUI's
        // "'execution_start' fired before prompt was made" warning.
        app.queuePrompt = (...args) => {
            const nodes = (app.graph?._nodes || []).filter((n) => n.comfyClass === NODE);
            if (nodes.length) {
                for (const n of nodes) n.__lpReset?.(); // gutter returns to lo at once
                api.fetchApi("/bulentgercek/list_pick/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: nodes.map((n) => String(n.id)) }),
                }).catch((e) => console.warn("[list_pick] reset call failed", e));
            }
            return origQueuePrompt(...args);
        };

        // When the queue drains completely, the gutter goes back to previewing the
        // configured values instead of staying on the last realised result.
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

        const resD = addReadonlyRow(node, "lp_result", "generation result");
        const cntD = addReadonlyRow(node, "lp_count", "count");

        let activeIndex = -1;
        // previewMode true: activeIndex is a guess at the next pick(). false: it is the
        // index the server actually returned.
        let previewMode = true;
        let stateLo = null;
        let stateMax = null;
        let gutter = null;

        // The DOM widgets are added after ComfyUI computed the node's size, so the node
        // has to grow to fit them.
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

            // start_index is bounded by the list itself, so the spinner cannot be pushed
            // past the last line.
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
                // fixed is deterministic: the result is lo, no run needed to know it.
                resD.set(lo);
                activeIndex = lo;
                previewMode = true;
                stateLo = lo;
                stateMax = max;
            } else if (mode === "randomize") {
                // Unknowable until a real result arrives, so nothing is highlighted.
                if (previewMode) {
                    resD.set("-");
                    activeIndex = -1;
                }
                if (loChanged) {
                    stateLo = lo;
                    stateMax = max;
                }
            } else {
                // increment / decrement: same reasoning as the server's reset condition.
                // If lo or the line count moved, or no real result has arrived yet, the
                // next pick() is certain to return lo.
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

        // ComfyUI's Vue-based multiline widget creates its textarea (listW.inputEl)
        // asynchronously after the node is built, and a later Vue re-render can drop the
        // gutter div out of the DOM. So: poll for inputEl, and rebuild if it detaches.
        const attachGutterNow = () => {
            if (gutter) {
                if (gutter.element?.isConnected) return true;
                gutter.destroy?.();
                gutter = null;
            }
            const el = listW.inputEl;
            if (!el) return false;
            // The listeners are marked on the element itself: the gutter may be rebuilt
            // many times over the same textarea, the input hooks only once.
            if (!el.__lpHooked) {
                el.__lpHooked = true;
                el.addEventListener("input", sync);
                el.addEventListener("change", sync);
            }
            gutter = attachGutter(
                el,
                () => activeIndex,
                () => (skipW ? !!skipW.value : true)
            );
            if (!gutter) return false;
            gutter.render();
            sync();
            // Follow-up renders for layout that settles a frame or two later.
            requestAnimationFrame(() => gutter?.render());
            setTimeout(() => gutter?.render(), 150);
            return true;
        };

        let pollPending = false;
        const ensureGutter = () => {
            if (gutter && gutter.element?.isConnected) return;
            if (pollPending) return;
            pollPending = true;
            const tick = (tries) => {
                if (attachGutterNow() || tries <= 0) { pollPending = false; return; }
                requestAnimationFrame(() => tick(tries - 1));
            };
            // Give up after roughly three seconds; onDrawForeground will try again.
            tick(180);
        };

        // Widget callbacks are wrapped rather than replaced, so ComfyUI's own handler
        // still runs and the preview refreshes after it.
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
            ensureGutter();
            // A zero timeout lets ComfyUI finish restoring the widget values first.
            setTimeout(() => { ensureGutter(); sync(); fitSize(); }, 0);
            return r;
        };

        const onExec = node.onExecuted;
        node.onExecuted = function (message) {
            const r = onExec?.apply(this, arguments);
            // This is the real result coming back through the "ui" channel; from here on
            // the gutter shows what happened rather than what will happen.
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
            // Draw is the only hook that fires reliably after every kind of change, so it
            // doubles as a watchdog. The previous values are cached to keep it cheap:
            // this runs on every frame the node is visible.
            if (!gutter || !gutter.element?.isConnected) ensureGutter();
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
                ensureGutter();
                sync();
            }
            return onDraw?.apply(this, a);
        };

        ensureGutter();
        setTimeout(() => { ensureGutter(); sync(); fitSize(); }, 0);
    },
});
