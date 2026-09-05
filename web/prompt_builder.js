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
const MAX_CAT_OUT = 32; // prompt_builder.py MAX_CAT_OUT ile ayni olmali

/* ---------- yardimcilar ---------- */

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

// backend'le ayni: bos satirlar elenir, deger sonda trim'lenir
function activeLines(raw) {
    return splitLines(raw ?? "").filter((l) => l.trim() !== "");
}

// Last Prompt rozetleri — gutter sarisi (#e2b04a).
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

    // Backend RETURN_TYPES 33 STRING (all + kategori basina 1). Kutuphane
    // onizlemesi ve yeni node SADECE "all" ile baslasin; kategori slotlari
    // syncOutputs ile eklenir. Aksi halde node "carsaf gibi" 33 slotla gelir.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE) return;
        const trim = (k, v) => { if (Array.isArray(nodeData[k])) nodeData[k] = v; };
        trim("output", (nodeData.output || ["STRING"]).slice(0, 1));
        trim("output_name", ["all"]);
        trim("output_is_list", (nodeData.output_is_list || []).slice(0, 1));
        trim("output_tooltips", (nodeData.output_tooltips || []).slice(0, 1));
    },

    async setup() {
        if (app.__pbQueueHooked) return;
        app.__pbQueueHooked = true;

        const origQueuePrompt = app.queuePrompt.bind(app);
        // Not: origQueuePrompt'tan once `await` KULLANMA — araya giren gecikme
        // "'execution_start' fired before prompt was made" uyarisini tetikliyor.
        // Reset'i fire-and-forget gonder; backend route'u onemsiz, prompt worker'a
        // dusmeden cok once varir.
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

        // Queue tamamen bosalinca onizlemeyi gercek sonuc yerine tahmine dondur.
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

        // delimiter + categories gizli: serialize kalir (workflow'a yazilir),
        // ekranda gorunmez. Ikisi de modal / Settings uzerinden duzenlenir.
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

        let previewMode = true;   // true: tahmin, false: gercek run sonucu
        const lastReal = {};      // cat.id -> son gerceklesen (trim'li) deger
        const lastIndex = {};     // cat.id -> son gerceklesen index
        let modalRefresh = null;  // modal acikken run sonrasi kartlari tazeler

        // bir kategorinin aktif (vurgulanacak) index'i — modal gutter'i icin.
        // randomize: kullaniciya son kalinan yeri GOSTERME (hep isaretsiz).
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

        // "Open Prompt Builder" — DOM buton (canvas widget'i cok ince, tiklamasi zor).
        // Sabit yukseklik: getMaxHeight yoksa bosalan alani doldurur ve Last Prompt'u
        // asagi iterdi.
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
        // basili tutuldukca acik gri (mouse down; click degil)
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

        // Output slot'larini kategorilere esitle: slot 0 = "All" (birlesmis prompt,
        // her zaman), sonrasi kategori basina bir STRING. Etiket = category.name
        // (bossa "cat N"). Kablolar kategori id'sine gore korunur; reorder / rename
        // / ekle / sil hepsinde dogru kalir. Yalniz yapisal degisiklikte calisir.
        const syncOutputs = () => {
            const cats = parseCats(catsW.value);
            const n = Math.min(cats.length, MAX_CAT_OUT);

            const sig = n + "|" + cats.slice(0, n)
                .map((c) => (c && c.id != null ? c.id : "") + " " +
                    ((c && c.name != null ? String(c.name) : "").trim()))
                .join("|");
            if (sig === node.__pbOutSig) return;
            node.__pbOutSig = sig;

            node.outputs = node.outputs || [];
            const graph = node.graph;

            // slot -> kategori id haritasi yoksa / bayatsa pozisyonel tureti
            // (workflow yuklendiginde outputs configure ile geri gelir ama harita gelmez)
            if (!Array.isArray(node.__pbSlotIds) ||
                node.__pbSlotIds.length !== node.outputs.length) {
                node.__pbSlotIds = [null];
                for (let i = 1; i < node.outputs.length; i++) {
                    node.__pbSlotIds.push(String(cats[i - 1]?.id ?? ""));
                }
            }

            // 1) mevcut kategori kablolarini id'ye gore snapshot'la
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

            // 2) slot 0 = All (linkleri korunur)
            if (!node.outputs.length) node.addOutput("All", "STRING");
            node.outputs[0].name = "All";
            node.outputs[0].label = "All";
            node.outputs[0].type = "STRING";

            // 3) tum kategori slot'larini kaldir, n tane taze ekle (bayat link kalmasin)
            while (node.outputs.length > 1) node.removeOutput(node.outputs.length - 1);
            for (let k = 0; k < n; k++) node.addOutput("", "STRING");

            // 4) etiketle + id haritasini yenile
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

            // 5) kablolari kategori id'sine gore geri bagla
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

        // Last Prompt: her katilan kategorinin basina rozet [Mode][index] + metin,
        // delimiter ile birlesir. realById verilirse gercek run sonucu, yoksa tahmin.
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
                out.push(badgeEl(nameTag));                       // Kategori
                out.push(badgeEl(MODE_ABBR[mode] || "Fixd"));     // Mode
                out.push(badgeEl(idx == null ? "?" : String(idx))); // Index
                out.push(document.createTextNode(val));
                vals.push(val);
            }
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

        // delimiter / categories degisince onizlemeyi (ve categories'te output
        // slot'larini) tazele
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

        let configured = false; // workflow'dan yuklendi mi (yeni node degil)

        const onConf = node.onConfigure;
        node.onConfigure = function (...a) {
            configured = true;
            const r = onConf?.apply(this, a);
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

        // ilk cizimden once slotlari kategorilere gore ayarla
        syncOutputs();

        setTimeout(() => {
            hideWidget(catsW);
            hideWidget(delimW);
            // yeni node (workflow'dan yuklenmedi) → delimiter'i global tohumdan baslat
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
