/* Read-only indicator row.
 *
 * ComfyUI's Vue frontend silently skips widget types it does not know, and
 * addWidget("text", ...) + disabled draws a box without ever showing the value.
 * node.addDOMWidget is the only thing that works, so the pattern lives here once.
 */

export const ROW_H = 26;
// Slot height leaves room below the row: sizing the widget exactly ROW_H tall made
// the last row spill past the node's bottom edge.
export const ROW_SLOT = ROW_H + 8;

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
        // The row is a display, never a control: clicks belong to the node below it.
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

/**
 * Adds a read-only "label ......... value" row to the node.
 * @returns {{ set: (v: unknown) => void }}
 */
export function addReadonlyRow(node, name, label) {
    const { row, valueEl } = makeRow(label);

    // Fallback for frontends without addDOMWidget: the value shows, the styling does
    // not. Better a plain box than a missing indicator.
    if (typeof node.addDOMWidget !== "function") {
        const w = node.addWidget("text", label, "-", () => {}, { serialize: false });
        w.disabled = true;
        return { set: (v) => { w.value = String(v); } };
    }

    // serialize: false keeps the indicator out of the saved workflow; it is derived
    // from the last run, not user input.
    const w = node.addDOMWidget(name, "bg_readonly_row", row, {
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
