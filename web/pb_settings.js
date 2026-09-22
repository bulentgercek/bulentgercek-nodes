/* Prompt Builder — browser-wide settings.
 *
 * Kept under a single localStorage key. These are NOT written to the workflow: they
 * describe how this user likes to work (default category names, the seed delimiter
 * for new nodes, the modal layout). Per-node data — the categories and that node's
 * delimiter — lives in hidden widgets inside the workflow JSON instead.
 */

const KEY = "bulentgercek.prompt_builder.settings";

export const DEFAULTS = {
    defaultCategories: "Base List, Camera List, Pose List, Clothing List, Environment List",
    defaultDelimiter: ". ",
    windowConfig: "small",   // "small" | "wide" | "three" | "four" | "twocol"
    uiSize: "small",         // "small" | "medium" | "large" — modal chrome
    listFontSize: "small",   // "small" | "medium" | "large" — category line lists
    compactRows: "off",      // "off" | "on" — max-height plus inner scroll on cards
    fitTextMaster: "on",     // "off" | "on" — bulk Fit Text. ON: every cat.fit=true and
                             // the per-card buttons are locked. Toggling writes to all.
};

// Compact rows: card lists stop growing past a set height and scroll inside instead,
// which roughly levels the grid rows. The column layout itself does not change.
export const COMPACT_OPTS = {
    off: { label: "Off" },
    on:  { label: "On" },
};

// Base font size for the modal chrome (header, buttons, labels, card controls).
// Children scale from it through em/inherit.
export const UI_SIZES = {
    small:  { label: "Small",  px: 13 },
    medium: { label: "Medium", px: 15 },
    large:  { label: "Large",  px: 17 },
};

// Font size for the category line lists, their gutters and the debug readout.
export const LIST_SIZES = {
    small:  { label: "Small",  px: 12 },
    medium: { label: "Medium", px: 14 },
    large:  { label: "Large",  px: 16 },
};

// The modal always fills the screen with even margins; this setting only decides how
// many columns the card grid uses. Every mode collapses to fewer columns on a narrow
// window.
export const WINDOW_CONFIGS = {
    small:  { label: "1 Column",     mode: 1 },
    wide:   { label: "2 Columns",    mode: 2 },
    three:  { label: "3 Columns",    mode: 3 },
    four:   { label: "4 Columns",    mode: 4 },
    twocol: { label: "Auto (Float)", mode: "auto" },
};

export function loadSettings() {
    // Stored settings are merged over the defaults, so a key added in a later version
    // is filled in for users who already have a saved object.
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...DEFAULTS };
        const v = JSON.parse(raw);
        return { ...DEFAULTS, ...(v && typeof v === "object" ? v : {}) };
    } catch (e) {
        return { ...DEFAULTS };
    }
}

export function saveSettings(patch) {
    const next = { ...loadSettings(), ...patch };
    try {
        localStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) {
        /* localStorage may be disabled or full; settings then last for this session only */
    }
    return next;
}

export function parseCategoryNames(csv) {
    return String(csv || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
}
