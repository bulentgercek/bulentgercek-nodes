"""Prompt Builder cekirdegi — saf Python, ComfyUI'siz.

Kategori JSON dizisini alir, her kategoriden `picker.resolve_index` ile bir satir
secer, `enabled` olan ve bos olmayanlari `delimiter` ile birlestirir.

Kategori sirasi = dizideki sira. Isimlerin birlestirmeye etkisi yoktur.
Per-kategori sayac anahtari "unique_id:kategori_id" — sira degil, id bazli.
"""

import json

from . import picker


def parse_categories(raw):
    """Gizli JSON widget'inin string'ini kategori listesine cevirir.
    Bozuk/eksik veri -> bos liste (node patlamaz)."""
    try:
        cats = json.loads(raw) if raw else []
    except Exception:
        return []
    return cats if isinstance(cats, list) else []


def build_prompt(categories, delimiter, unique_id, state):
    """categories : parse edilmis liste (dict'ler).
    state       : picker._STATE gibi bir dict; yerinde guncellenir.
    Donen       : (final_str, ui_cats, cat_values)
                  ui_cats    : her kategori icin {id, index, count} (dizi sirasi)
                  cat_values : her kategorinin secili satiri (dizi sirasi, strip'li)

    `enabled` YALNIZ `all` (birlesmis) ciktisina katilmayi kontrol eder. Her
    kategorinin kendi ciktisi (cat_values) ve sayaci `enabled`'dan bagimsizdir —
    kategoriyi All'dan cikarip ayri porttan kullanmak mumkun olsun diye.
    Bos liste -> "" (o kategori icin), sayac ilerlemez.
    """
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
