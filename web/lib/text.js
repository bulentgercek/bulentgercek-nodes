/* Satir bolme yardimcilari. List Pick ve Prompt Builder ortak kullanir. */

export function splitLines(text) {
    if (typeof text !== "string") return [];
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

export function lineCount(text, skipEmpty) {
    if (typeof text !== "string" || text.length === 0) return 0;
    let lines = splitLines(text);
    if (skipEmpty) lines = lines.filter((l) => l.trim() !== "");
    return lines.length;
}
