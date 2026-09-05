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
        if (app.__lpQueueHooked) return;
        app.__lpQueueHooked = true;

        const origQueuePrompt = app.queuePrompt.bind(app);
        // origQueuePrompt'tan once `await` yok — araya giren gecikme
        // "'execution_start' fired before prompt was made" uyarisini tetikliyor.
        app.queuePrompt = (...args) => {
            const nodes = (app.graph?._nodes || []).filter((n) => n.comfyClass === NODE);
            if (nodes.length) {
                for (const n of nodes) n.__lpReset?.(); // gutter aninda lo'ya doner
                api.fetchApi("/bulentgercek/list_pick/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: nodes.map((n) => String(n.id)) }),
                }).catch((e) => console.warn("[list_pick] reset call failed", e));
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

        const resD = addReadonlyRow(node, "lp_result", "generation result");
        const cntD = addReadonlyRow(node, "lp_count", "count");

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

        // ComfyUI'nin Vue tabanli cok-satirli widget'i (listW.inputEl) node
        // yuklendikten sonra asenkron olusabiliyor; ayrica bir Vue yeniden
        // render'i ekledigimiz gutter div'ini DOM'dan atabiliyor. Bu yuzden:
        // inputEl gelene kadar rAF ile yokla, kopmussa yeniden bagla.
        const attachGutterNow = () => {
            if (gutter) {
                if (gutter.element?.isConnected) return true;
                gutter.destroy?.();
                gutter = null;
            }
            const el = listW.inputEl;
            if (!el) return false;
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
            // gec gelen layout icin birkac takip render'i
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
            tick(180); // ~3 sn boyunca dene, sonra birak (draw yeniden tetikler)
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
            ensureGutter();
            setTimeout(() => { ensureGutter(); sync(); fitSize(); }, 0);
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
