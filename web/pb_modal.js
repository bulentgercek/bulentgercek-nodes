/* Prompt Builder modal — the category editor.
 *
 * Its own overlay appended to document.body: app.extensionManager.dialog only
 * offers single-line prompt/confirm dialogs, which is nowhere near enough for a
 * multi-line editor. Category cards are laid out in the array's order, in one or
 * more columns. Every change writes the hidden `categories` JSON widget and
 * refreshes the node's `Last Prompt` preview.
 */

import { attachGutter } from "./lib/gutter.js";
import { splitLines } from "./lib/text.js";
import { loadSettings, saveSettings, parseCategoryNames, WINDOW_CONFIGS, UI_SIZES, LIST_SIZES, COMPACT_OPTS } from "./pb_settings.js";

const COMPACT_MAX = "16em"; // Compact mode cap for a card textarea, in em so it follows the font

const MODES = ["fixed", "increment", "decrement", "randomize"];

let currentModal = null;

function newId(existing) {
    let id;
    do {
        id = "c_" + Math.random().toString(36).slice(2, 8);
    } while (existing.has(id));
    return id;
}

function newCategory(existing) {
    return { id: newId(existing), name: "", enabled: true, mode: "fixed", start_index: 0, lines: "" };
}

function parse(raw) {
    try {
        const v = JSON.parse(raw || "[]");
        return Array.isArray(v) ? v : [];
    } catch (e) {
        return [];
    }
}

function activeLineCount(raw) {
    return splitLines(raw ?? "").filter((l) => l.trim() !== "").length;
}

function el(tag, style, props) {
    const e = document.createElement(tag);
    if (style) Object.assign(e.style, style);
    if (props) Object.assign(e, props);
    return e;
}

function btnStyle(kind) {
    const base = {
        background: "#3a3a3a", color: "#e0e0e0", border: "1px solid #4a4a4a",
        borderRadius: "5px", padding: "5px 10px", cursor: "pointer",
        fontSize: "0.92em", fontFamily: "Arial, sans-serif", lineHeight: "1",
    };
    if (kind === "accent") { base.background = "#3d5a80"; base.borderColor = "#4a6fa0"; }
    if (kind === "danger") { base.background = "#5a2d2d"; base.borderColor = "#7a3d3d"; base.padding = "5px 8px"; }
    if (kind === "mini") { base.padding = "4px 8px"; }
    return base;
}

async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
    } catch (e) {
        const t = document.createElement("textarea");
        t.value = text;
        Object.assign(t.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
        document.body.appendChild(t);
        t.select();
        try { document.execCommand("copy"); } catch (_) { /* ignore */ }
        t.remove();
    }
}

export function openPromptBuilderModal(node, ctx) {
    if (currentModal) currentModal.close();

    const catsW = ctx.catsW;

    let working = parse(catsW.value).map((c) => {
        const w = {
            id: String(c.id ?? ""),
            name: typeof c.name === "string" ? c.name : "",
            enabled: c.enabled !== false,
            mode: MODES.includes(c.mode) ? c.mode : "fixed",
            start_index: Number.isFinite(+c.start_index) ? Math.max(0, Math.floor(+c.start_index)) : 0,
            lines: typeof c.lines === "string" ? c.lines : "",
        };
        // h is the textarea height in px and fit is the auto-grow toggle. Both are
        // UI-only fields that the backend ignores, kept here so the layout survives a
        // save and reload.
        if (Number.isFinite(+c.h) && +c.h > 0) w.h = Math.round(+c.h);
        if (c.fit === true) w.fit = true;
        return w;
    });
    {
        const seen = new Set(working.map((c) => c.id).filter(Boolean));
        for (const c of working) {
            if (!c.id) { c.id = newId(seen); seen.add(c.id); }
        }
    }

    let settings = loadSettings();
    let currentCfg = WINDOW_CONFIGS[settings.windowConfig] ? settings.windowConfig : "small";
    let currentUi = UI_SIZES[settings.uiSize] ? settings.uiSize : "small";
    let currentList = LIST_SIZES[settings.listFontSize] ? settings.listFontSize : "small";
    let compact = settings.compactRows === "on";
    let fitMaster = settings.fitTextMaster === "on"; // bulk Fit Text lock
    if (fitMaster) for (const c of working) c.fit = true; // ON means every card fits

    const gutters = [];
    let dragState = null;   // drag-and-drop state
    let dragIndicator = null;

    const commit = () => {
        catsW.value = JSON.stringify(working);
        catsW.callback?.(catsW.value);
    };
    let commitRaf = 0;
    const scheduleCommit = () => {
        if (commitRaf) return;
        commitRaf = requestAnimationFrame(() => { commitRaf = 0; commit(); });
    };
    const destroyGutters = () => {
        for (const g of gutters.splice(0)) g?.destroy?.();
    };

    /* ---------- overlay (backdrop only; the panel itself is full screen) ---------- */
    const overlay = el("div", {
        position: "fixed", inset: "0", zIndex: "10000",
        background: "rgba(0,0,0,0.55)",
        font: "13px Arial, sans-serif",
    });
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) close(); });
    for (const ev of ["keydown", "keyup", "wheel", "pointerdown", "pointermove", "pointerup"]) {
        overlay.addEventListener(ev, (e) => e.stopPropagation());
    }
    let activeSubClose = null; // closer for an open sub-panel (Export/Import), if any
    const onKey = (e) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            if (activeSubClose) activeSubClose(); else close();
        }
    };
    document.addEventListener("keydown", onKey, true);

    // The panel fills the screen with an even margin on every side.
    const M = "28px";
    const panel = el("div", {
        position: "fixed", top: M, right: M, bottom: M, left: M,
        background: "#262626", color: "#dcdcdc",
        border: "1px solid #3a3a3a", borderRadius: "10px",
        display: "flex", flexDirection: "column", overflow: "hidden",
        boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
    });
    overlay.appendChild(panel);

    /* ---------- header ---------- */
    const header = el("div", {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", borderBottom: "1px solid #3a3a3a", flex: "0 0 auto",
    });
    header.appendChild(el("div", { fontWeight: "bold", fontSize: "1.1em" },
        { textContent: "Prompt Builder" }));
    const hRight = el("div", { display: "flex", alignItems: "center", gap: "8px" });
    const settingsBtn = el("button", btnStyle(), { textContent: "Settings" });
    const closeX = el("button", btnStyle(), { textContent: "✕", title: "Close (Esc)" });
    closeX.addEventListener("click", close);
    hRight.appendChild(settingsBtn);
    hRight.appendChild(closeX);
    header.appendChild(hRight);
    panel.appendChild(header);

    /* ---------- toolbar ---------- */
    const toolbar = el("div", {
        display: "flex", gap: "8px", padding: "10px 16px",
        borderBottom: "1px solid #3a3a3a", flex: "0 0 auto", flexWrap: "wrap",
    });
    const addBtn = el("button", btnStyle("accent"), { textContent: "+ Add Category" });
    addBtn.addEventListener("click", () => {
        const c = newCategory(new Set(working.map((x) => x.id)));
        if (fitMaster) c.fit = true;
        working.push(c);
        render();
        commit();
        cardsBox.scrollTop = cardsBox.scrollHeight;
    });
    const addDefBtn = el("button", btnStyle(), { textContent: "+ Add defaults" });
    addDefBtn.title = "Add the list from Settings › Default categories";
    addDefBtn.addEventListener("click", () => {
        const names = parseCategoryNames(loadSettings().defaultCategories);
        if (!names.length) { window.alert("Settings › Default categories is empty."); return; }
        const seen = new Set(working.map((c) => c.id));
        for (const nm of names) {
            const c = newCategory(seen);
            c.name = nm;
            if (fitMaster) c.fit = true;
            seen.add(c.id);
            working.push(c);
        }
        render();
        commit();
        cardsBox.scrollTop = cardsBox.scrollHeight;
    });
    const exportBtn = el("button", btnStyle(), { textContent: "Export" });
    exportBtn.title = "Copy this category set (with delimiter) as JSON to move it to another node";
    exportBtn.addEventListener("click", doExport);
    const importBtn = el("button", btnStyle(), { textContent: "Import" });
    importBtn.title = "Replace this node's categories from exported JSON";
    importBtn.addEventListener("click", doImport);

    toolbar.appendChild(addBtn);
    toolbar.appendChild(addDefBtn);
    toolbar.appendChild(exportBtn);
    toolbar.appendChild(importBtn);
    panel.appendChild(toolbar);

    /* ---------- sub-panel (Export / Import) ---------- */
    function openSubPanel(titleText, contentNode, actions) {
        const back = el("div", {
            position: "fixed", inset: "0", zIndex: "10002",
            background: "rgba(0,0,0,0.5)",
            display: "flex", alignItems: "center", justifyContent: "center",
            font: "13px Arial, sans-serif",
        });
        for (const ev of ["keydown", "keyup", "wheel", "pointerdown", "pointermove", "pointerup"]) {
            back.addEventListener(ev, (e) => e.stopPropagation());
        }
        const sp = el("div", {
            background: "#262626", color: "#dcdcdc", border: "1px solid #3a3a3a",
            borderRadius: "10px", width: "min(720px, 92vw)", maxHeight: "80vh",
            display: "flex", flexDirection: "column", boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        });
        const hd = el("div", {
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "12px 16px", borderBottom: "1px solid #3a3a3a", flex: "0 0 auto",
        });
        hd.appendChild(el("div", { fontWeight: "bold", fontSize: "1.05em" }, { textContent: titleText }));
        const x = el("button", btnStyle(), { textContent: "✕", title: "Close" });
        hd.appendChild(x);
        sp.appendChild(hd);
        const body = el("div", { padding: "14px 16px", overflow: "auto", flex: "1 1 auto" });
        body.appendChild(contentNode);
        sp.appendChild(body);
        const ft = el("div", {
            display: "flex", gap: "8px", justifyContent: "flex-end", flexWrap: "wrap",
            padding: "10px 16px", borderTop: "1px solid #3a3a3a", flex: "0 0 auto",
        });
        sp.appendChild(ft);
        back.appendChild(sp);

        const close = () => {
            back.remove();
            if (activeSubClose === close) activeSubClose = null;
        };
        x.addEventListener("click", close);
        back.addEventListener("pointerdown", (e) => { if (e.target === back) close(); });
        for (const a of actions) {
            const b = el("button", btnStyle(a.kind), { textContent: a.label });
            b.addEventListener("click", () => a.onClick(close, b));
            ft.appendChild(b);
        }
        document.body.appendChild(back);
        activeSubClose = close;
        return { close, panel: sp };
    }

    const jsonAreaStyle = {
        width: "100%", minHeight: "300px", boxSizing: "border-box",
        background: "#1b1b1b", color: "#c8c8c8", border: "1px solid #3a3a3a",
        borderRadius: "6px", padding: "8px", resize: "vertical",
        font: "12px ui-monospace, Consolas, monospace", lineHeight: "1.4", outline: "none",
    };

    function doExport() {
        const payload = JSON.stringify(
            { delimiter: ctx.getDelimiter(), categories: working }, null, 2);
        const ta = el("textarea", jsonAreaStyle, { readOnly: true, value: payload });
        ta.addEventListener("pointerdown", (e) => e.stopPropagation());
        openSubPanel("Export categories", ta, [
            {
                label: "Copy", kind: "accent",
                onClick: (_c, btn) => {
                    copyText(payload);
                    const orig = btn.textContent;
                    btn.textContent = "Copied";
                    setTimeout(() => { btn.textContent = orig; }, 1000);
                },
            },
            {
                label: "Download .json",
                onClick: () => {
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
                    a.download = "prompt-builder-categories.json";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                },
            },
            { label: "Close", onClick: (c) => c() },
        ]);
        requestAnimationFrame(() => { ta.focus(); ta.select(); });
    }

    function doImport() {
        const ta = el("textarea", jsonAreaStyle, { value: "", placeholder: "Paste exported JSON here…" });
        ta.addEventListener("pointerdown", (e) => e.stopPropagation());
        const err = el("div", { color: "#e07a7a", fontSize: "12px", marginTop: "6px", minHeight: "16px" });
        const box = el("div", {});
        box.appendChild(ta);
        box.appendChild(err);
        openSubPanel("Import categories", box, [
            {
                label: "Import", kind: "accent",
                onClick: (close) => {
                    let data;
                    try { data = JSON.parse(ta.value); }
                    catch (e) { err.textContent = "Invalid JSON."; return; }
                    const arr = Array.isArray(data) ? data
                        : (data && Array.isArray(data.categories)) ? data.categories : null;
                    if (!arr) { err.textContent = "No 'categories' array found in the JSON."; return; }
                    if (working.length && !window.confirm(
                        `Replace this node's ${working.length} categor${working.length === 1 ? "y" : "ies"} with ${arr.length} imported?`)) return;

                    const seen = new Set();
                    const next = arr.filter((c) => c && typeof c === "object").map((c) => {
                        const w = {
                            id: newId(seen),
                            name: typeof c.name === "string" ? c.name : "",
                            enabled: c.enabled !== false,
                            mode: MODES.includes(c.mode) ? c.mode : "fixed",
                            start_index: Number.isFinite(+c.start_index) ? Math.max(0, Math.floor(+c.start_index)) : 0,
                            lines: typeof c.lines === "string" ? c.lines : "",
                        };
                        seen.add(w.id);
                        if (Number.isFinite(+c.h) && +c.h > 0) w.h = Math.round(+c.h);
                        if (c.fit === true || fitMaster) w.fit = true;
                        return w;
                    });
                    if (!Array.isArray(data) && typeof data.delimiter === "string") {
                        ctx.setDelimiter(data.delimiter);
                    }
                    working.length = 0;
                    for (const w of next) working.push(w);
                    render();
                    commit();
                    close();
                },
            },
            { label: "Cancel", onClick: (c) => c() },
        ]);
        requestAnimationFrame(() => ta.focus());
    }

    /* ---------- settings panel (expands and collapses) ---------- */
    // Visibility is driven through style.display: an inline display value would beat
    // the user agent's `display:none` for the `hidden` attribute. Starts collapsed.
    const setBox = el("div", {
        padding: "12px 16px", borderBottom: "1px solid #3a3a3a", background: "#222",
        display: "none", flexDirection: "column", gap: "10px", flex: "0 0 auto",
    });
    let setOpen = false;
    settingsBtn.addEventListener("click", () => {
        setOpen = !setOpen;
        setBox.style.display = setOpen ? "flex" : "none";
        settingsBtn.style.background = setOpen ? "#3d5a80" : "#3a3a3a";
        settingsBtn.style.borderColor = setOpen ? "#4a6fa0" : "#4a4a4a";
    });

    const mkField = (labelText, help) => {
        const row = el("div", { display: "flex", flexDirection: "column", gap: "3px" });
        row.appendChild(el("div", { fontSize: "0.85em", color: "#9a9a9a" },
            { textContent: labelText }));
        const inp = el("input", {
            width: "100%", boxSizing: "border-box", background: "#1a1a1a", color: "#ddd",
            border: "1px solid #3a3a3a", borderRadius: "5px", padding: "6px 8px",
            fontSize: "0.95em",
        }, { type: "text" });
        row.appendChild(inp);
        if (help) {
            row.appendChild(el("div", { fontSize: "0.78em", color: "#777" },
                { textContent: help }));
        }
        setBox.appendChild(row);
        return inp;
    };

    const defCatsInp = mkField("Default categories",
        "Comma-separated. '+ Add defaults' inserts these. Applies to all nodes (this browser).");
    defCatsInp.value = settings.defaultCategories;
    defCatsInp.addEventListener("input", () => {
        settings = saveSettings({ defaultCategories: defCatsInp.value });
    });

    // One field, two jobs: it writes this node's delimiter, which is saved with the
    // workflow, AND stores the same value as the default for new nodes.
    const delimInp = mkField("Delimiter",
        "Joins the categories for this node, and becomes the default for new nodes.");
    delimInp.value = ctx.getDelimiter();
    delimInp.addEventListener("input", () => {
        ctx.setDelimiter(delimInp.value);
        settings = saveSettings({ defaultDelimiter: delimInp.value });
    });

    // Everything except the full-width text fields above lives in this grid, so the
    // segmented controls flow side by side while there is room.
    const segGrid = el("div", {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: "12px 20px",
    });
    setBox.appendChild(segGrid);

    // A label plus option buttons, with the selected one highlighted; returns { paint }.
    const mkSegmented = (labelText, entries, getCurrent, onPick) => {
        const row = el("div", { display: "flex", flexDirection: "column", gap: "4px" });
        row.appendChild(el("div", { fontSize: "0.85em", color: "#9a9a9a" },
            { textContent: labelText }));
        const wrap = el("div", { display: "flex", gap: "6px", flexWrap: "wrap" });
        const btns = {};
        const paint = () => {
            const cur = getCurrent();
            for (const [k, b] of Object.entries(btns)) {
                const on = k === cur;
                b.style.background = on ? "#3d5a80" : "#3a3a3a";
                b.style.borderColor = on ? "#4a6fa0" : "#4a4a4a";
            }
        };
        for (const key of Object.keys(entries)) {
            const b = el("button", btnStyle("mini"), { textContent: entries[key].label });
            b.addEventListener("click", () => { onPick(key); paint(); });
            btns[key] = b;
            wrap.appendChild(b);
        }
        row.appendChild(wrap);
        segGrid.appendChild(row);
        paint();
        return { paint };
    };

    mkSegmented("Window layout", WINDOW_CONFIGS, () => currentCfg, (key) => {
        currentCfg = key;
        settings = saveSettings({ windowConfig: key });
        applyWindowConfig();
    });
    mkSegmented("UI Size", UI_SIZES, () => currentUi, (key) => {
        currentUi = key;
        settings = saveSettings({ uiSize: key });
        applyUiSize();
    });
    mkSegmented("List Text Size", LIST_SIZES, () => currentList, (key) => {
        currentList = key;
        settings = saveSettings({ listFontSize: key });
        applyListSize();
    });
    mkSegmented("Compact Rows", COMPACT_OPTS, () => (compact ? "on" : "off"), (key) => {
        compact = key === "on";
        settings = saveSettings({ compactRows: key });
        render();
    });
    // Bulk setter and lock. On: every cat.fit becomes true and the per-card buttons
    // lock. Off: every cat.fit becomes false and the buttons unlock. It deliberately
    // does not try to restore what each card had before.
    const fitAllSeg = mkSegmented(
        "Toggle Fit Text All",
        COMPACT_OPTS,
        () => (fitMaster ? "on" : "off"),
        (key) => {
            fitMaster = key === "on";
            settings = saveSettings({ fitTextMaster: key });
            for (const c of working) c.fit = fitMaster;
            render();
            commit();
        },
    );

    panel.appendChild(setBox);

    /* ---------- cards (they run to the bottom; there is no separate footer) ---------- */
    const cardsBox = el("div", {
        overflow: "auto", padding: "12px 16px", flex: "1 1 auto",
        display: "grid", gap: "12px", alignItems: "start",
        gridTemplateColumns: "1fr",
    });
    panel.appendChild(cardsBox);

    /* ---------- window config: column count only ---------- */
    // The fixed modes (1..4) fall back to however many columns actually fit on a narrow
    // window; "auto" simply fits as many as the width allows.
    const MIN_COL = 380;
    let lastGrid = "";
    function applyWindowConfig() {
        const mode = (WINDOW_CONFIGS[currentCfg] || WINDOW_CONFIGS.small).mode;
        let grid;
        if (mode === "auto") {
            grid = "repeat(auto-fill, minmax(460px, 1fr))";
        } else {
            const fit = Math.floor(cardsBox.clientWidth / MIN_COL) || 1;
            const n = Math.max(1, Math.min(mode, fit));
            grid = `repeat(${n}, 1fr)`;
        }
        if (grid !== lastGrid) {
            lastGrid = grid;
            cardsBox.style.gridTemplateColumns = grid;
            requestAnimationFrame(refresh);
        }
        updateAxis();
    }

    // The real column count, read back from the computed grid tracks. With one column
    // the reorder arrows read ↑/↓ ("Move up/down"), with more they read ←/→.
    let lastAxisHoriz = null;
    function columnsNow() {
        const t = getComputedStyle(cardsBox).gridTemplateColumns;
        if (!t || t === "none") return 1;
        return Math.min(t.trim().split(/\s+/).length, Math.max(1, working.length));
    }
    function updateAxis() {
        const horiz = columnsNow() > 1;
        if (horiz === lastAxisHoriz) return;
        lastAxisHoriz = horiz;
        for (const card of cardsBox.children) card.__setAxis?.(horiz);
    }
    // UI Size sets the panel's base font-size; children follow through em/inherit.
    function applyUiSize() {
        panel.style.fontSize = (UI_SIZES[currentUi] || UI_SIZES.small).px + "px";
    }
    // List Text Size touches the card textarea, gutter and readout, which have to be
    // rebuilt rather than restyled.
    function applyListSize() { render(); }
    let autoRefreshRaf = 0;
    const ro = new ResizeObserver(() => {
        if ((WINDOW_CONFIGS[currentCfg] || {}).mode !== "auto") {
            applyWindowConfig();
        } else if (!autoRefreshRaf) {
            // In "auto" mode CSS changes the column count on its own, which changes the
            // card width, so every fit-enabled box has to be re-fitted to it.
            autoRefreshRaf = requestAnimationFrame(() => { autoRefreshRaf = 0; refresh(); });
        }
        updateAxis();
    });
    ro.observe(cardsBox);

    /* ---------- render ---------- */
    function render() {
        destroyGutters();
        cardsBox.textContent = "";
        if (fitAllSeg) fitAllSeg.paint(); // keep the "Toggle Fit Text All" highlight in sync
        if (!working.length) {
            cardsBox.appendChild(el("div",
                { color: "#888", padding: "24px", textAlign: "center" },
                { textContent: "No categories yet.  Add one with '+ Add Category' or '+ Add defaults'." }));
            return;
        }
        working.forEach((cat, i) => cardsBox.appendChild(buildCard(cat, i)));
        // Re-fit once the grid columns and the scrollbar have settled. A single
        // animation frame (the one inside buildCard) fired too early after opening
        // Settings, after a drag-and-drop, and after Toggle Fit Text All.
        requestAnimationFrame(() => requestAnimationFrame(refresh));
    }

    function buildCard(cat, index) {
        const lpx = (LIST_SIZES[currentList] || LIST_SIZES.small).px;
        const taMinH = Math.round(90 * lpx / 12); // keeps the visible line count roughly fixed

        const card = el("div", {
            border: "1px solid #3d3d3d", borderRadius: "8px",
            background: cat.enabled ? "#2d2d2d" : "#232323",
            padding: "10px", display: "flex", flexDirection: "column", gap: "8px",
        });

        const top = el("div", { display: "flex", alignItems: "center", gap: "8px" });

        const grip = el("span", {
            cursor: "grab", color: "#777", userSelect: "none",
            fontSize: "1.15em", padding: "0 2px", touchAction: "none",
        }, { textContent: "⠿", title: "Drag to reorder" });
        grip.addEventListener("pointerdown", (e) => startDrag(e, index, card, grip));
        top.appendChild(grip);

        const nameIn = el("input", {
            flex: "1 1 auto", minWidth: "60px", background: "#1e1e1e", color: "#ddd",
            border: "1px solid #3a3a3a", borderRadius: "5px", padding: "5px 8px",
            fontSize: "1em",
        }, { type: "text", value: cat.name, placeholder: "category name (optional)" });
        nameIn.addEventListener("input", () => { cat.name = nameIn.value; commit(); });
        top.appendChild(nameIn);

        const up = el("button", btnStyle("mini"));
        up.disabled = index === 0;
        up.addEventListener("click", () => move(index, -1));
        top.appendChild(up);

        const down = el("button", btnStyle("mini"));
        down.disabled = index === working.length - 1;
        down.addEventListener("click", () => move(index, +1));
        top.appendChild(down);

        // The reorder arrows follow the layout axis: vertical ↑↓ or horizontal ←→.
        card.__setAxis = (horiz) => {
            up.textContent = horiz ? "←" : "↑";
            up.title = horiz ? "Move left" : "Move up";
            down.textContent = horiz ? "→" : "↓";
            down.title = horiz ? "Move right" : "Move down";
        };
        card.__setAxis(lastAxisHoriz === true);

        const enWrap = el("label", {
            display: "flex", alignItems: "center", gap: "4px",
            color: "#bbb", userSelect: "none",
        }, { title: "Only affects the All output" });
        const enCb = el("input", null, { type: "checkbox", checked: cat.enabled });
        enCb.addEventListener("change", () => { cat.enabled = enCb.checked; commit(); render(); });
        enWrap.appendChild(enCb);
        enWrap.appendChild(el("span", null, { textContent: "enabled" }));
        top.appendChild(enWrap);

        const del = el("button", btnStyle("danger"), { textContent: "🗑", title: "Delete" });
        del.addEventListener("click", () => {
            if (window.confirm(`Delete category "${cat.name || cat.id}"?`)) {
                working.splice(index, 1);
                render();
                commit();
            }
        });
        top.appendChild(del);
        card.appendChild(top);

        // fitOn mirrors this card's Fit Text state (cat.fit). "Toggle Fit Text All" sets
        // it in bulk rather than overriding it, while Compact Rows beats both.
        let fitOn = !!cat.fit;
        const isFitActive = () => !compact && fitOn;

        const taWrap = el("div", { position: "relative" });
        const ta = el("textarea", {
            display: "block", width: "100%", minHeight: taMinH + "px", boxSizing: "border-box",
            height: cat.h ? cat.h + "px" : "",
            // Compact always wins: a capped height plus inner scrolling
            maxHeight: compact ? COMPACT_MAX : "",
            background: "#1b1b1b", color: "#d0d0d0",
            border: "1px solid #3a3a3a", borderRadius: "6px",
            padding: "6px 8px", font: `${lpx}px ui-monospace, Consolas, monospace`,
            lineHeight: "1.4",
            resize: (compact || isFitActive()) ? "none" : "vertical",
            opacity: cat.enabled ? "1" : "0.55",
        }, { value: cat.lines, placeholder: "one item per line" });
        taWrap.appendChild(ta);
        card.appendChild(taWrap);

        // A height the user dragged is stored with the category. The observer's first
        // firing only establishes the baseline — it is layout, not a user action — so
        // just the later, real changes are saved. Nothing is stored while Compact or Fit
        // is active, since the height is managed there.
        let baseH = null;
        let lastH = cat.h || 0;
        const hRo = new ResizeObserver(() => {
            if (compact || isFitActive()) return;
            const h = Math.round(ta.getBoundingClientRect().height);
            if (h <= 0) return;
            if (baseH === null) { baseH = h; lastH = h; return; }
            if (Math.abs(h - lastH) >= 2) {
                lastH = h;
                cat.h = h;
                scheduleCommit();
            }
        });
        hRo.observe(ta);

        const bottom = el("div", {
            display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap",
        });

        const siWrap = el("label", { display: "flex", alignItems: "center", gap: "5px", color: "#bbb" });
        siWrap.appendChild(el("span", null, { textContent: "start_index" }));
        const siIn = el("input", {
            width: "64px", background: "#1e1e1e", color: "#ddd",
            border: "1px solid #3a3a3a", borderRadius: "5px", padding: "4px 6px",
            fontSize: "0.92em",
        }, { type: "number", min: "0", step: "1", value: String(cat.start_index) });
        siWrap.appendChild(siIn);
        bottom.appendChild(siWrap);

        const modeWrap = el("label", { display: "flex", alignItems: "center", gap: "5px", color: "#bbb" });
        modeWrap.appendChild(el("span", null, { textContent: "mode" }));
        const modeSel = el("select", {
            background: "#1e1e1e", color: "#ddd",
            border: "1px solid #3a3a3a", borderRadius: "5px", padding: "4px 6px",
            fontSize: "0.92em",
        });
        for (const m of MODES) {
            const o = el("option", null, { value: m, textContent: m });
            if (m === cat.mode) o.selected = true;
            modeSel.appendChild(o);
        }
        modeWrap.appendChild(modeSel);
        bottom.appendChild(modeWrap);

        // Fit Text is a per-category toggle: while on, the box grows with the content
        // even as you type; switching it off freezes the current height and hands
        // resizing back to the user. It is meaningless in Compact mode, where the button
        // is dimmed and its clicks ignored — do NOT set the `disabled` attribute, as a
        // disabled button shows no tooltip and the explanation would be lost.
        const fitBtn = el("button", btnStyle("mini"), { textContent: "Fit Text" });
        bottom.appendChild(fitBtn);

        const dbg = el("span", {
            color: "#888", marginLeft: "auto",
            font: `${Math.min(lpx, 14)}px ui-monospace, monospace`,
        });
        bottom.appendChild(dbg);
        card.appendChild(bottom);

        const g = attachGutter(ta, () => ctx.activeIndexFor(cat));
        gutters.push({ destroy: () => { g?.destroy?.(); hRo.disconnect(); } });

        let raf = 0;
        const scheduleRender = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => { raf = 0; g?.render(); });
        };
        const updateDbg = () => {
            const idx = ctx.activeIndexFor(cat);
            dbg.textContent = `index ${idx < 0 ? "–" : idx} · count ${activeLineCount(cat.lines)}`;
        };

        // --- Fit Text toggle ---
        const applyFit = () => {          // size to content and record it in cat.h
            ta.style.height = "auto";
            const h = Math.round(ta.scrollHeight + 2); // +2 covers the 1px border (border-box)
            ta.style.height = h + "px";
            cat.h = h;
            if (baseH === null) baseH = h;
            lastH = h;                    // stops the observer from storing this as a user resize
            scheduleCommit();
            g?.render();
        };
        const paintFit = () => {
            if (compact) { // Compact outranks everything
                fitBtn.title = "Disabled on Compact Rows Mode";
                Object.assign(fitBtn.style, {
                    background: "#232323", color: "#565656", borderColor: "#333", cursor: "default",
                });
                return;
            }
            if (fitMaster) { // Toggle Fit Text All is on: locked, dark blue, dim text
                fitBtn.title = "Disabled on Toggle Fit Text All";
                Object.assign(fitBtn.style, {
                    background: "#14335a", borderColor: "#2b5188",
                    color: "#6f89ac", cursor: "default",
                });
                return;
            }
            fitBtn.title = fitOn
                ? "Auto-grow ON — click to freeze at current height"
                : "Auto-grow the box to fit all lines";
            Object.assign(fitBtn.style, {
                background: fitOn ? "#1f4e8f" : "#3a3a3a",
                borderColor: fitOn ? "#3f77c8" : "#4a4a4a",
                color: fitOn ? "#dbe8fb" : "#e0e0e0",
                cursor: "pointer",
            });
        };
        const setFit = (on) => {         // only ever called while compact is off
            fitOn = on;
            cat.fit = on;
            ta.style.resize = on ? "none" : "vertical";
            if (on) {
                applyFit();
            } else {
                // Freeze at whatever height is on screen right now.
                const h = Math.round(ta.getBoundingClientRect().height);
                if (h > 0) { ta.style.height = h + "px"; cat.h = h; lastH = h; }
            }
            paintFit();
            commit();
        };
        fitBtn.addEventListener("click", () => {
            if (compact || fitMaster) return; // locked
            setFit(!fitOn);
        });
        paintFit();
        if (isFitActive()) requestAnimationFrame(applyFit); // apply once on load

        ta.addEventListener("input", () => {
            cat.lines = ta.value;
            commit();
            scheduleRender();
            updateDbg();
            if (isFitActive()) applyFit(); // live growth while fit is on
        });
        siIn.addEventListener("input", () => {
            let v = parseInt(siIn.value, 10);
            if (!Number.isFinite(v) || v < 0) v = 0;
            cat.start_index = v;
            commit();
            scheduleRender();
            updateDbg();
        });
        modeSel.addEventListener("change", () => {
            cat.mode = modeSel.value;
            commit();
            scheduleRender();
            updateDbg();
        });

        requestAnimationFrame(() => { g?.render(); updateDbg(); });
        card.__refresh = () => {
            // Re-fit the box after a width or layout change; otherwise just redraw.
            if (isFitActive()) applyFit(); else g?.render();
            updateDbg();
        };
        return card;
    }

    function move(index, dir) {
        const j = index + dir;
        if (j < 0 || j >= working.length) return;
        [working[index], working[j]] = [working[j], working[index]];
        render();
        commit();
    }

    /* ---------- drag-and-drop reorder (pointer events, the ⠿ grip only) ---------- */

    function startDrag(e, from, card, grip) {
        if (e.button !== 0 || dragState) return;
        e.preventDefault();
        e.stopPropagation();
        try { grip.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        dragState = { from, to: from, card, grip, pid: e.pointerId,
                      x0: e.clientX, y0: e.clientY, active: false };
        // Capture phase, so the overlay's bubble-phase stopPropagation cannot swallow
        // these before they arrive.
        window.addEventListener("pointermove", onDragMove, true);
        window.addEventListener("pointerup", endDrag, true);
        window.addEventListener("pointercancel", endDrag, true);
    }

    function dragIndicatorEl() {
        if (dragIndicator) return dragIndicator;
        dragIndicator = el("div", {
            position: "fixed", background: "#e2b04a", borderRadius: "2px",
            pointerEvents: "none", zIndex: "10001",
            boxShadow: "0 0 6px rgba(226, 176, 74, 0.7)",
        });
        document.body.appendChild(dragIndicator);
        return dragIndicator;
    }

    function onDragMove(e) {
        const st = dragState;
        if (!st) return;
        if (!st.active) {
            if (Math.abs(e.clientX - st.x0) < 4 && Math.abs(e.clientY - st.y0) < 4) return;
            st.active = true;
            st.card.style.opacity = "0.35";
            st.grip.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
        }

        const cards = Array.from(cardsBox.children);
        const px = e.clientX, py = e.clientY;
        let to = cards.length;
        for (let i = 0; i < cards.length; i++) {
            const r = cards[i].getBoundingClientRect();
            if (py < r.top || (py <= r.bottom && px < r.left + r.width / 2)) { to = i; break; }
        }
        st.to = to;

        const ref = cards[Math.min(to, cards.length - 1)];
        if (!ref) return;
        const r = ref.getBoundingClientRect();
        const oneCol = columnsNow() <= 1;
        const ind = dragIndicatorEl();
        ind.style.display = "block";
        if (oneCol) {
            const y = to >= cards.length ? r.bottom + 4 : r.top - 6;
            Object.assign(ind.style, {
                left: r.left + "px", width: r.width + "px", height: "3px", top: y + "px",
            });
        } else {
            const x = to >= cards.length ? r.right + 5 : r.left - 8;
            Object.assign(ind.style, {
                left: x + "px", width: "3px", height: r.height + "px", top: r.top + "px",
            });
        }
    }

    function endDrag() {
        const st = dragState;
        dragState = null;
        if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
        window.removeEventListener("pointermove", onDragMove, true);
        window.removeEventListener("pointerup", endDrag, true);
        window.removeEventListener("pointercancel", endDrag, true);
        if (!st) return;
        try { st.grip.releasePointerCapture(st.pid); } catch (_) { /* ignore */ }
        st.grip.style.cursor = "grab";
        document.body.style.userSelect = "";
        if (!st.active) return;
        st.card.style.opacity = "";

        const { from, to } = st;
        if (to === from || to === from + 1) return; // dropped where it already was
        const [item] = working.splice(from, 1);
        working.splice(to > from ? to - 1 : to, 0, item);
        render();
        commit();
    }

    function refresh() {
        for (const card of cardsBox.children) card.__refresh?.();
    }

    function close() {
        if (currentModal !== self) return;
        if (activeSubClose) activeSubClose(); // an open Export/Import sub-panel
        if (commitRaf) { cancelAnimationFrame(commitRaf); commitRaf = 0; commit(); }
        // Clean up a drag that is still in progress: the indicator and the window
        // listeners would otherwise outlive the modal.
        window.removeEventListener("pointermove", onDragMove, true);
        window.removeEventListener("pointerup", endDrag, true);
        window.removeEventListener("pointercancel", endDrag, true);
        dragState = null;
        if (dragIndicator) { dragIndicator.remove(); dragIndicator = null; }
        document.body.style.userSelect = "";
        destroyGutters();
        ro.disconnect();
        document.removeEventListener("keydown", onKey, true);
        overlay.remove();
        currentModal = null;
        ctx.registerRefresh?.(null);
    }

    const self = { close, refresh };
    currentModal = self;
    ctx.registerRefresh?.(refresh);

    applyUiSize();
    applyWindowConfig();
    render();
    document.body.appendChild(overlay);
    updateAxis();
    requestAnimationFrame(applyWindowConfig); // re-evaluate columns against the real width
    return self;
}
