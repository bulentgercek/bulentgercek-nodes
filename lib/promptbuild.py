"""Prompt Builder core. Pure Python, no ComfyUI imports.

Takes the category JSON array, picks one line per category through
`picker.resolve_index`, and joins the enabled, non-empty ones with the delimiter.

Category order is array order; names never affect the result. Per-category counters
are keyed "unique_id:category_id" — by id, not by position.
"""

import json

from . import picker


def parse_categories(raw):
    """Turn the hidden JSON widget's string into a list of categories.

    Malformed or missing data yields an empty list rather than an error.
    """
    # A workflow can arrive with a half-written or hand-edited widget value. The node
    # stays loadable in that case; an empty list simply produces empty outputs.
    try:
        cats = json.loads(raw) if raw else []
    except Exception:
        return []
    return cats if isinstance(cats, list) else []


def build_prompt(categories, delimiter, unique_id, state):
    """Pick one line per category and join the enabled ones.

    categories : parsed list of dicts.
    state      : a dict like picker._STATE; updated in place.
    Returns    : (final_str, ui_cats, cat_values)
                 ui_cats    : {id, index, count} per category, in array order
                 cat_values : each category's picked line, in array order, stripped
    """
    # `enabled` only controls whether a category joins the combined output. Its own
    # output and its counter keep running, so a category can be routed on its own
    # while staying out of `all`.
    parts = []
    ui_cats = []
    cat_values = []

    for c in categories:
        if not isinstance(c, dict):
            ui_cats.append({"id": "", "index": -1, "count": 0})
            cat_values.append("")
            continue

        cid = str(c.get("id", ""))
        lines = picker.split_lines(c.get("lines", ""), skip_empty=True)
        count = len(lines)

        # An empty category emits "" and leaves its counter untouched, so adding lines
        # later starts the walk from start_index instead of a stale position.
        if count == 0:
            ui_cats.append({"id": cid, "index": -1, "count": 0})
            cat_values.append("")
            continue

        mode = c.get("mode", "fixed")
        if mode not in picker.MODES:
            mode = "fixed"

        try:
            start_index = int(c.get("start_index", 0))
        except (TypeError, ValueError):
            start_index = 0
        lo = max(0, min(start_index, count - 1))

        # Keying by category id keeps counters attached to the category itself, so
        # reordering or renaming in the modal never swaps two walks around.
        key = "%s:%s" % (unique_id, cid)
        index, st = picker.resolve_index(mode, state.get(key), lo, count)
        state[key] = st

        value = lines[index].strip()
        ui_cats.append({"id": cid, "index": index, "count": count})
        cat_values.append(value)

        if bool(c.get("enabled", True)) and value != "":
            parts.append(value)

    sep = delimiter if isinstance(delimiter, str) else ". "
    return sep.join(parts), ui_cats, cat_values
