"""List Pick — multiline string list'ten satir secer.

start_index sadece baslangic noktasidir, alt sinir DEGILDIR.
increment/decrement tum listeyi (0..count-1) dairesel gezer;
count-1'i gecince 0'a, 0'in altina inince count-1'e sarar.
control_after_generation: fixed / increment / decrement / randomize.
Uretilen index backend'de hesaplanir ve UI'a geri gonderilir.
"""

import random

from aiohttp import web
from server import PromptServer

MAX_INT = 0xFFFFFFFF
MODES = ["fixed", "increment", "decrement", "randomize"]

# node id -> {"lo": int, "count": int, "next": int}
_STATE = {}


@PromptServer.instance.routes.post("/bulentgercek/list_pick/reset")
async def _list_pick_reset(request):
    """Yeni bir Queue tiklamasi basladiginda ilgili node'larin gizli
    increment/decrement sayacini temizler; state.next() bir sonraki
    pick() cagrisinda start_index'e sifirlanir."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    ids = data.get("ids") if isinstance(data, dict) else None
    if isinstance(ids, list) and ids:
        for uid in ids:
            _STATE.pop(str(uid), None)
    else:
        _STATE.clear()
    return web.json_response({"ok": True})


def split_lines(text, skip_empty=True):
    if not isinstance(text, str) or text == "":
        return []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if skip_empty:
        lines = [ln for ln in lines if ln.strip() != ""]
    return lines


class ListPick:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "string_list": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "dynamicPrompts": False,
                    "tooltip": "Her satir bir item.",
                }),
                "start_index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": MAX_INT,
                    "step": 1,
                    "tooltip": "Baslangic noktasi. Alt sinir degildir; increment/decrement tum listeyi (0..count-1) dairesel gezer.",
                }),
                "control_after_generation": (MODES, {
                    "default": "randomize",
                    "tooltip": "Her run'dan sonra bir sonraki index nasil belirlenecek (fixed/increment/decrement/randomize).",
                }),
                "skip_empty": ("BOOLEAN", {"default": True}),
                "strip": ("BOOLEAN", {"default": True}),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("string", "index", "count")
    FUNCTION = "pick"
    CATEGORY = "bulentgercek/text"
    DESCRIPTION = "Multiline string list'ten satir secer (fixed/increment/decrement/randomize)."

    @classmethod
    def IS_CHANGED(cls, string_list, start_index, control_after_generation,
                   skip_empty=True, strip=True, unique_id=None):
        # fixed'de cache calissin; digerlerinde her run yeniden hesaplansin.
        if control_after_generation == "fixed":
            return "fixed:%d:%d" % (int(start_index), hash(string_list))
        return float("nan")

    def pick(self, string_list, start_index, control_after_generation,
             skip_empty=True, strip=True, unique_id=None):

        lines = split_lines(string_list, skip_empty)
        count = len(lines)

        if count == 0:
            return {
                "ui": {"list_pick": [{"index": -1, "count": 0}]},
                "result": ("", 0, 0),
            }

        lo = max(0, min(int(start_index), count - 1))
        key = str(unique_id)

        st = _STATE.get(key)
        if st is None or st["lo"] != lo or st["count"] != count:
            st = {"lo": lo, "count": count, "next": lo}

        mode = control_after_generation

        if mode == "randomize":
            index = random.randint(0, count - 1)
            st["next"] = lo
        elif mode == "fixed":
            index = lo
            st["next"] = lo
        else:
            index = st["next"]
            if index < 0 or index > count - 1:
                index = lo
            if mode == "increment":
                st["next"] = (index + 1) % count
            else:  # decrement
                st["next"] = (index - 1) % count

        _STATE[key] = st

        value = lines[index]
        if strip:
            value = value.strip()

        return {
            "ui": {"list_pick": [{"index": index, "count": count}]},
            "result": (value, index, count),
        }


NODE_CLASS_MAPPINGS = {"ListPick": ListPick}
NODE_DISPLAY_NAME_MAPPINGS = {"ListPick": "List Pick"}
