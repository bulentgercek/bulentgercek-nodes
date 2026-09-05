/* Prompt Builder — global (tarayici bazli) ayarlar.
 *
 * localStorage'da tek anahtarda tutulur. Workflow'a YAZILMAZ; kullanicinin
 * calisma aliskanligi (default kategori isimleri, yeni node delimiter tohumu,
 * modal pencere duzeni). Per-node veri (kategoriler, o node'un delimiter'i)
 * ayri: gizli widget'larda, workflow JSON'inda.
 */

const KEY = "bulentgercek.prompt_builder.settings";

export const DEFAULTS = {
    defaultCategories: "Base List, Camera List, Pose List, Clothing List, Environment List",
    defaultDelimiter: ". ",
    windowConfig: "small",   // "small" | "wide" | "three" | "four" | "twocol"
    uiSize: "small",         // "small" | "medium" | "large" — modal geneli
    listFontSize: "small",   // "small" | "medium" | "large" — kategori satir listeleri
    compactRows: "off",      // "off" | "on" — kart textarea'sina max-height + ic scroll
    fitTextMaster: "on",     // "off" | "on" — toplu Fit Text. ON: tum cat.fit=true +
                             // per-kart butonlar kilitli. Toggle On/Off tumune yazar.
};

// Compact rows: acikken kart listeleri belli bir yuksekligi gecmez (ic scroll);
// grid satirlari kabaca esitlenir, dikey bosluklar kuculur. Layout degismez.
export const COMPACT_OPTS = {
    off: { label: "Off" },
    on:  { label: "On" },
};

// Modal geneli taban font boyutu (header, butonlar, etiketler, kart kontrolleri).
// Cocuklar em/inherit ile buna gore olceklenir.
export const UI_SIZES = {
    small:  { label: "Small",  px: 13 },
    medium: { label: "Medium", px: 15 },
    large:  { label: "Large",  px: 17 },
};

// Kategori satir listeleri (+ gutter, debug satiri) font boyutu.
export const LIST_SIZES = {
    small:  { label: "Small",  px: 12 },
    medium: { label: "Medium", px: 14 },
    large:  { label: "Large",  px: 16 },
};

// Modal her zaman tum ekrani (simetrik kenar bosluguyla) kaplar; bu ayar
// yalnizca kart izgarasinin kolon sayisini belirler. Hepsi dar ekranda
// tek kolona duser (float).
export const WINDOW_CONFIGS = {
    small:  { label: "1 Column",     mode: 1 },
    wide:   { label: "2 Columns",    mode: 2 },
    three:  { label: "3 Columns",    mode: 3 },
    four:   { label: "4 Columns",    mode: 4 },
    twocol: { label: "Auto (Float)", mode: "auto" },
};

export function loadSettings() {
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
        /* localStorage kapali olabilir — sessizce gec */
    }
    return next;
}

export function parseCategoryNames(csv) {
    return String(csv || "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");
}
