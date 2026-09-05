/* Salt okunur, kaydirilabilir zengin metin gosterge widget'i (DOM widget).
 *
 * List Pick'teki tek-satir `readonly_row` yerine uzun onizlemeler icin
 * (Prompt Builder'in `Last Prompt`'u gibi). Rozet/span render edebilmek icin
 * <textarea> degil <div> kullanir. `getMaxHeight` VERILMEZ — node yeniden
 * boyutlandirilinca widget bosalan dikey alani doldurur. Sag ustte hover'da
 * beliren bir kopyala butonu var (her zaman DUZ metni kopyalar). Node
 * suruklemesiyle catismasin diye pointer/wheel event'leri durdurulur.
 */

const COPY_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export function addReadonlyText(node, name, label, opts = {}) {
    const minH = opts.minHeight ?? 92;

    const wrap = document.createElement("div");
    Object.assign(wrap.style, {
        position: "relative",
        boxSizing: "border-box",
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "3px",
        padding: "2px 0",
    });

    const lab = document.createElement("div");
    lab.textContent = label;
    Object.assign(lab.style, {
        font: "11px Arial, sans-serif",
        color: "#9a9a9a",
        padding: "0 4px",
        userSelect: "none",
        flex: "0 0 auto",
    });

    const view = document.createElement("div");
    Object.assign(view.style, {
        boxSizing: "border-box",
        width: "100%",
        flex: "1 1 auto",
        minHeight: "0",
        border: "1px solid #3a3a3a",
        borderRadius: "6px",
        background: "#1b1b1b",
        color: "#c8c8c8",
        font: "12px ui-monospace, Consolas, monospace",
        lineHeight: "1.4",
        padding: "6px 8px",
        overflowY: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "break-word",
        userSelect: "text",
        cursor: "text",
    });
    view.addEventListener("pointerdown", (e) => e.stopPropagation());
    view.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    let plain = "";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.title = "Copy";
    copyBtn.innerHTML = COPY_SVG;
    Object.assign(copyBtn.style, {
        position: "absolute",
        top: "22px",
        right: "10px",
        width: "24px",
        height: "24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0",
        border: "1px solid #4a4a4a",
        borderRadius: "5px",
        background: "#2b2b2b",
        color: "#cfcfcf",
        cursor: "pointer",
        opacity: "0",
        transition: "opacity 0.12s",
    });
    copyBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
    copyBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
            await navigator.clipboard.writeText(plain);
        } catch (err) {
            const t = document.createElement("textarea");
            t.value = plain;
            Object.assign(t.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
            document.body.appendChild(t);
            t.select();
            try { document.execCommand("copy"); } catch (e2) { /* yut */ }
            t.remove();
        }
        copyBtn.innerHTML = CHECK_SVG;
        copyBtn.style.color = "#7ec87e";
        clearTimeout(copyBtn.__t);
        copyBtn.__t = setTimeout(() => {
            copyBtn.innerHTML = COPY_SVG;
            copyBtn.style.color = "#cfcfcf";
        }, 1000);
    });
    wrap.addEventListener("pointerenter", () => { copyBtn.style.opacity = "1"; });
    wrap.addEventListener("pointerleave", () => { copyBtn.style.opacity = "0"; });

    wrap.appendChild(lab);
    wrap.appendChild(view);
    wrap.appendChild(copyBtn);

    const setText = (v) => {
        plain = String(v ?? "");
        view.textContent = plain;
    };
    const setSegments = (nodes, p) => {
        plain = String(p ?? "");
        const arr = Array.isArray(nodes) ? nodes : [nodes];
        if (typeof view.replaceChildren === "function") {
            view.replaceChildren(...arr);
        } else {
            view.textContent = "";
            for (const el of arr) view.appendChild(el);
        }
    };

    if (typeof node.addDOMWidget !== "function") {
        const w = node.addWidget("text", label, "", () => {}, { serialize: false });
        w.disabled = true;
        return {
            setText: (v) => { plain = String(v ?? ""); w.value = plain; },
            setSegments: (_n, p) => { plain = String(p ?? ""); w.value = plain; },
            getPlain: () => plain,
            element: wrap,
        };
    }

    const w = node.addDOMWidget(name, "bg_readonly_text", wrap, {
        serialize: false,
        hideOnZoom: false,
        getValue: () => plain,
        setValue: (v) => setText(v),
        getMinHeight: () => minH,
    });
    if (w) w.serialize = false;

    return { setText, setSegments, getPlain: () => plain, element: wrap, view };
}
