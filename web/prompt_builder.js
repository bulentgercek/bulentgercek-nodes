/* Prompt Builder — node face.
 *
 * Holds the button that opens the editor modal, the Last Prompt preview, and the
 * output slots that follow the category list. The categories themselves live in a
 * hidden widget and are edited in pb_modal.js; the picking happens on the server.
 */

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { splitLines } from "./lib/text.js";
import { addReadonlyText } from "./lib/readonly_text.js";
import { openPromptBuilderModal } from "./pb_modal.js";
import { loadSettings } from "./pb_settings.js";

const NODE = "PromptBuilder";
const DELIM = "delimiter";
const CATS = "categories";
const NODE_PAD = 10;
const MODES = ["fixed", "increment", "decrement", "randomize"];
const MAX_CAT_OUT = 32; // must match MAX_CAT_OUT in prompt_builder.py

/* ---------- helpers ---------- */

function parseCats(raw) {
    try {
        const v = JSON.parse(raw || "[]");
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

function clampInt(v, lo, hi) {
    let n = parseInt(v, 10);
    if (!Number.isFinite(n)) n = 0;
    return Math.max(lo, Math.min(n, hi));
}

// Same rule as the backend: blank lines drop out, the value is trimmed at the end.
function activeLines(raw) {
    return splitLines(raw ?? "").filter((l) => l.trim() !== "");
}

// Last Prompt badges, in the gutter's yellow (#e2b04a).
const BADGE_COLOR = "#e2b04a";
const MODE_ABBR = { fixed: "Fixd", increment: "Incr", decrement: "Decr", randomize: "Rand" };

function badgeEl(text) {
    const b = document.createElement("span");
    b.textContent = text;
    Object.assign(b.style, {
        display: "inline-block",
        fontSize: "0.82em",
        lineHeight: "1.15",
        padding: "0 4px",
        margin: "0 3px 0 0",
        border: "1px solid rgba(226, 176, 74, 0.55)",
        borderRadius: "4px",
        background: "rgba(226, 176, 74, 0.13)",
        color: BADGE_COLOR,
        fontWeight: "bold",
        letterSpacing: "0.3px",
        verticalAlign: "baseline",
        userSelect: "none",
    });
    return b;
}

/* ---------- extension ---------- */

app.registerExtension({
    name: "bulentgercek.prompt_builder",

    // The backend declares 33 STRING outputs (all + one per category). The library
    // preview and a freshly added node must show ONLY "all"; the category slots are
    // added by syncOutputs. Without this the node arrives as a wall of 33 slots.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE) return;
        const trim = (k, v) => { if (Array.isArray(nodeData[k])) nodeData[k] = v; };
        trim("output", (nodeData.output || ["STRING"]).slice(0, 1));
        trim("output_name", ["all"]);
        trim("output_is_list", (nodeData.output_is_list || []).slice(0, 1));
        trim("output_tooltips", (nodeData.output_tooltips || []).slice(0, 1));
    },

    async setup() {
        // Global hooks, installed once regardless of how many nodes exist.
        if (app.__pbQueueHooked) return;
        app.__pbQueueHooked = true;

        const origQueuePrompt = app.queuePrompt.bind(app);
        // Do NOT await before calling origQueuePrompt: an inserted delay triggers
        // ComfyUI's "'execution_start' fired before prompt was made" warning. The reset
        // is fire-and-forget and still lands long before the prompt reaches the worker.
        app.queuePrompt = (...args) => {
            const nodes = (app.graph?._nodes || []).filter((n) => n.comfyClass === NODE);
            if (nodes.length) {
                for (const n of nodes) n.__pbReset?.();
                api.fetchApi("/bulentgercek/prompt_builder/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: nodes.map((n) => String(n.id)) }),
                }).catch((e) => console.warn("[prompt_builder] reset call failed", e));
            }
            return origQueuePrompt(...args);
        };

        // Once the queue drains, the preview goes back to predicting instead of showing
        // the last realised result.
        let lastQueueRemaining = 0;
        api.addEventListener("status", (e) => {
            const remaining = e?.detail?.exec_info?.queue_remaining ?? 0;
            if (remaining === 0 && lastQueueRemaining > 0) {
                for (const n of app.graph?._nodes || []) {
                    if (n.comfyClass === NODE) n.__pbReset?.();
                }
            }
            lastQueueRemaining = remaining;
        });
    },

    async nodeCreated(node) {
        if (node.comfyClass !== NODE) return;

        const find = (n) => node.widgets?.find((w) => w.name === n);
        const delimW = find(DELIM);
        const catsW = find(CATS);
        if (!catsW) return;

        // delimiter and categories are hidden but still serialised, so they travel with
        // the workflow while the node stays small. Both are edited in the modal.
        const hideWidget = (w) => {
            if (!w || w.__pbHidden) return;
            w.__pbHidden = true;
            w.hidden = true;
            w.computeSize = () => [0, -4];
            const el = w.inputEl || w.element;
            if (el && el.style) el.style.display = "none";
        };
        hideWidget(catsW);
        hideWidget(delimW);

        let previewMode = true;   // true: prediction, false: result of a real run
        const lastReal = {};      // cat.id -> last realised (trimmed) value
        const lastIndex = {};     // cat.id -> last realised index
        let modalRefresh = null;  // refreshes the open modal's cards after a run

        // Which index to highlight for a category, used by the modal's gutter.
        // randomize deliberately shows nothing: the stored position is not where the
        // next run will land, so pointing at it would be a lie.
        const activeIndexFor = (cat) => {
            const cid = String(cat.id);
            const mode = MODES.includes(cat.mode) ? cat.mode : "fixed";
            if (mode === "randomize") return -1;
            if (!previewMode && cid in lastIndex) return lastIndex[cid];
            const lines = activeLines(cat.lines);
            if (!lines.length) return -1;
            return clampInt(cat.start_index ?? 0, 0, lines.length - 1);
        };

        const getDelimiter = () => (delimW ? String(delimW.value ?? "") : ". ");
        const setDelimiter = (v) => {
            if (!delimW) return;
            delimW.value = String(v ?? "");
            delimW.callback?.(delimW.value); // -> previewMode = true; syncPreview()
        };

        const openModal = () => openPromptBuilderModal(node, {
            catsW,
            activeIndexFor,
            getDelimiter,
            setDelimiter,
            registerRefresh: (fn) => { modalRefresh = fn; },
        });

        // "Open Prompt Builder" is a DOM button: the canvas widget is too thin to hit
        // comfortably. Its height is pinned, because without getMaxHeight it would
        // absorb the freed space and push Last Prompt down.
        const OPEN_BG = "#2b2b2b";
        const OPEN_BG_ACTIVE = "#4d4d4d";
        const openWrap = document.createElement("div");
        Object.assign(openWrap.style, { boxSizing: "border-box", width: "100%", padding: "3px 0" });
        const openBtn = document.createElement("button");
        openBtn.type = "button";
        openBtn.textContent = "Open Prompt Builder";
        Object.assign(openBtn.style, {
            boxSizing: "border-box", width: "100%",
            padding: "8px 10px",
            border: "1px solid #454545", borderRadius: "6px",
            background: OPEN_BG, color: "#e6e6e6",
            font: "12px Arial, sans-serif", cursor: "pointer",
            transition: "background 0.08s",
        });
        // Lightens while held down (pointer, not click), so the press is visible even
        // though the modal takes a moment to appear.
        const openRelease = () => { openBtn.style.background = OPEN_BG; };
        openBtn.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
            openBtn.style.background = OPEN_BG_ACTIVE;
        });
        openBtn.addEventListener("pointerup", openRelease);
        openBtn.addEventListener("pointerleave", openRelease);
        openBtn.addEventListener("pointercancel", openRelease);
        openBtn.addEventListener("click", (e) => { e.stopPropagation(); openModal(); });
        openWrap.appendChild(openBtn);
        if (typeof node.addDOMWidget === "function") {
            const bw = node.addDOMWidget("pb_open", "button", openWrap, {
                serialize: false, hideOnZoom: false,
                getMinHeight: () => 40, getMaxHeight: () => 40,
            });
            if (bw) { bw.serialize = false; bw.computeSize = () => [0, 40]; }
        } else {
            const bfallback = node.addWidget("button", "Open Prompt Builder", null, openModal);
            bfallback.serialize = false;
        }

        const preview = addReadonlyText(node, "pb_final", "Last Prompt", {
            minHeight: 96,
        });

        const fitSize = () => {
            const min = node.computeSize();
            node.setSize([
                Math.max(node.size[0], min[0]),
                Math.max(node.size[1], min[1] + NODE_PAD),
            ]);
            node.setDirtyCanvas?.(true, true);
        };

        // Keeps the output slots in step with the categories: slot 0 is "All" (the
        // joined prompt, always present), then one STRING per category labelled with
        // its name, or "cat N" when the name is blank. Wires are preserved by category
        // id, so reordering, renaming, adding and deleting all keep their connections.
        const syncOutputs = () => {
            const cats = parseCats(catsW.value);
            const n = Math.min(cats.length, MAX_CAT_OUT);

            // A signature of ids and names: the whole rebuild only runs when the output
            // structure actually changed, not on every keystroke in a list.
            const sig = n + "|" + cats.slice(0, n)
                .map((c) => (c && c.id != null ? c.id : "") + " " +
                    ((c && c.name != null ? String(c.name) : "").trim()))
                .join("|");
            if (sig === node.__pbOutSig) return;
            node.__pbOutSig = sig;

            node.outputs = node.outputs || [];
            const graph = node.graph;

            // Rebuild the slot -> category id map when it is missing or stale: loading a
            // workflow restores the outputs through configure, but not our map.
            if (!Array.isArray(node.__pbSlotIds) ||
                node.__pbSlotIds.length !== node.outputs.length) {
                node.__pbSlotIds = [null];
                for (let i = 1; i < node.outputs.length; i++) {
                    node.__pbSlotIds.push(String(cats[i - 1]?.id ?? ""));
                }
            }

            // 1) snapshot the existing category wires, keyed by category id
            const saved = {}; // id -> [{nodeId, slot}]
            for (let i = 1; i < node.outputs.length; i++) {
                const id = node.__pbSlotIds[i];
                const links = node.outputs[i] && node.outputs[i].links;
                if (!id || !links || !links.length || !graph) continue;
                const arr = (saved[id] = saved[id] || []);
                for (const lid of links) {
                    const L = graph.links && graph.links[lid];
                    if (L) arr.push({ nodeId: L.target_id, slot: L.target_slot });
                }
            }

            // 2) slot 0 = All; its links are left untouched
            if (!node.outputs.length) node.addOutput("All", "STRING");
            node.outputs[0].name = "All";
            node.outputs[0].label = "All";
            node.outputs[0].type = "STRING";

            // 3) drop every category slot and add n fresh ones, so no stale link survives
            while (node.outputs.length > 1) node.removeOutput(node.outputs.length - 1);
            for (let k = 0; k < n; k++) node.addOutput("", "STRING");

            // 4) label them and rebuild the id map
            const slotIds = [null];
            for (let k = 0; k < n; k++) {
                const c = cats[k] || {};
                const nm = (c.name != null && String(c.name).trim()) || `cat ${k + 1}`;
                const o = node.outputs[k + 1];
                o.name = nm;
                o.label = nm;
                o.type = "STRING";
                slotIds.push(String(c.id ?? ""));
            }
            node.__pbSlotIds = slotIds;

            // 5) reconnect the wires by category id; a category that is gone loses its
            // wire, which is the one case where dropping it is correct
            for (const id in saved) {
                const k = slotIds.indexOf(id);
                if (k < 1) continue;
                for (const t of saved[id]) {
                    const tn = graph && graph.getNodeById && graph.getNodeById(t.nodeId);
                    if (tn) node.connect(k, tn, t.slot);
                }
            }

            fitSize();
        };

        // Last Prompt: each participating category contributes three badges followed by
        // its text, joined with the delimiter. With realById it shows the run's actual
        // result; without it, the prediction.
        const renderPreview = (realById, plainOverride) => {
            const cats = parseCats(catsW.value);
            const delim = delimW ? String(delimW.value ?? "") : ". ";
            const out = [];
            const vals = [];
            let k = -1;
            for (const c of cats) {
                k++;
                if (!c || typeof c !== "object" || c.enabled === false) continue;
                const lines = activeLines(c.lines);
                if (!lines.length) continue;
                const mode = MODES.includes(c.mode) ? c.mode : "fixed";
                const cid = String(c.id ?? "");
                const nm = (c.name != null ? String(c.name) : "").trim();
                const nameTag = nm ? nm.slice(0, 4) : "cat" + (k + 1);
                let idx, val;
                if (realById) {
                    const uc = realById[cid];
                    idx = uc ? uc.index : -1;
                    if (idx < 0 || idx >= lines.length) continue;
                    val = lines[idx].trim();
                } else if (mode === "randomize") {
                    // Nothing can be predicted here, so the last realised value is shown
                    // with a "?" index until a run replaces it.
                    idx = cid in lastIndex ? lastIndex[cid] : null;
                    val = cid in lastReal
                        ? lastReal[cid]
                        : lines[clampInt(c.start_index ?? 0, 0, lines.length - 1)].trim();
                } else {
                    idx = clampInt(c.start_index ?? 0, 0, lines.length - 1);
                    val = lines[idx].trim();
                }
                if (val === "") continue;
                if (out.length) out.push(document.createTextNode(delim));
                out.push(badgeEl(nameTag));                       // category
                out.push(badgeEl(MODE_ABBR[mode] || "Fixd"));     // mode
                out.push(badgeEl(idx == null ? "?" : String(idx))); // index
                out.push(document.createTextNode(val));
                vals.push(val);
            }
            // The plain string is tracked separately so the copy button yields the prompt
            // without badges; after a run the server's own string is authoritative.
            const plain = typeof plainOverride === "string" ? plainOverride : vals.join(delim);
            preview.setSegments(out.length ? out : [document.createTextNode("")], plain);
            node.setDirtyCanvas?.(true, true);
        };

        const syncPreview = () => {
            if (!previewMode) return;
            renderPreview(null);
        };

        node.__pbReset = () => {
            previewMode = true;
            syncPreview();
        };

        // Refresh the preview when delimiter or categories change, and rebuild the
        // output slots when it was the categories.
        for (const w of [delimW, catsW]) {
            if (!w) continue;
            const cb = w.callback;
            const isCats = w === catsW;
            w.callback = function (...a) {
                const r = cb?.apply(this, a);
                previewMode = true;
                if (isCats) syncOutputs();
                syncPreview();
                return r;
            };
        }

        let configured = false; // true once loaded from a workflow, i.e. not a new node

        const onConf = node.onConfigure;
        node.onConfigure = function (...a) {
            configured = true;
            const r = onConf?.apply(this, a);
            // Deferred by one tick: ComfyUI restores widget values after configure, and
            // re-hiding is needed because that restore can undo it.
            setTimeout(() => {
                hideWidget(catsW);
                hideWidget(delimW);
                previewMode = true;
                syncOutputs();
                syncPreview();
                fitSize();
            }, 0);
            return r;
        };

        const onExec = node.onExecuted;
        node.onExecuted = function (message) {
            const r = onExec?.apply(this, arguments);
            const d = message?.prompt_builder?.[0];
            if (d) {
                // The server reports per category by id, so the values survive a reorder
                // between queueing and the result arriving.
                previewMode = false;
                const byId = {};
                const byIdUc = {};
                for (const c of parseCats(catsW.value)) {
                    if (c && c.id != null) byId[String(c.id)] = c;
                }
                for (const uc of d.cats || []) {
                    const cid = String(uc.id);
                    byIdUc[cid] = uc;
                    lastIndex[cid] = uc.index;
                    const c = byId[cid];
                    if (!c || uc.index < 0) continue;
                    const lines = activeLines(c.lines);
                    if (uc.index < lines.length) {
                        lastReal[cid] = lines[uc.index].trim();
                    }
                }
                renderPreview(byIdUc, typeof d.final === "string" ? d.final : "");
                modalRefresh?.();
                node.setDirtyCanvas?.(true, true);
            }
            return r;
        };

        // Slots have to match the categories before the first draw.
        syncOutputs();

        setTimeout(() => {
            hideWidget(catsW);
            hideWidget(delimW);
            // A new node (not loaded from a workflow) starts from the browser-wide
            // delimiter, so the user's habit carries over to every node they add.
            if (!configured && delimW && delimW.value === ". ") {
                const seed = loadSettings().defaultDelimiter;
                if (typeof seed === "string" && seed !== ". ") setDelimiter(seed);
            }
            syncOutputs();
            syncPreview();
            fitSize();
        }, 0);
    },
});
