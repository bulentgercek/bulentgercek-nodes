"""List Pick — multiline string list'ten satir secer.

start_index sadece baslangic noktasidir, alt sinir DEGILDIR.
increment/decrement tum listeyi (0..count-1) dairesel gezer;
count-1'i gecince 0'a, 0'in altina inince count-1'e sarar.
control_after_generation: fixed / increment / decrement / randomize.
Uretilen index backend'de hesaplanir ve UI'a geri gonderilir.

Cekirdek mantik (satir bolme, index yurutme, per-key state, reset)
paylasilan `lib/picker.py`'dedir; Prompt Builder ayni modulu kullanir.
"""

from aiohttp import web
from server import PromptServer

from .lib import picker

MAX_INT = 0xFFFFFFFF
MODES = picker.MODES


@PromptServer.instance.routes.post("/bulentgercek/list_pick/reset")
async def _list_pick_reset(request):
    """Yeni bir Queue tiklamasi basladiginda ilgili node'larin gizli
    increment/decrement sayacini temizler; sonraki pick() cagrisinda
    sayac start_index'e sifirlanir."""
    try:
        data = await request.json()
    except Exception:
        data = {}
    ids = data.get("ids") if isinstance(data, dict) else None
    picker.reset_ids(ids)
    return web.json_response({"ok": True})


class ListPick:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "string_list": ("STRING", {
                    "multiline": True,
                    "default": "",
                    "dynamicPrompts": False,
                    "tooltip": "One item per line.",
                }),
                "start_index": ("INT", {
                    "default": 0,
                    "min": 0,
                    "max": MAX_INT,
                    "step": 1,
                    "tooltip": "Starting point for picking. Not a lower bound - increment/decrement wrap around the whole list (0..count-1).",
                }),
                "control_after_generation": (MODES, {
                    "default": "randomize",
                    "tooltip": "How the index changes after each run (fixed / increment / decrement / randomize).",
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
    DESCRIPTION = "Picks one line from a multiline list (fixed / increment / decrement / randomize)."

    @classmethod
    def IS_CHANGED(cls, string_list, start_index, control_after_generation,
                   skip_empty=True, strip=True, unique_id=None):
        # fixed'de cache calissin; digerlerinde her run yeniden hesaplansin.
        if control_after_generation == "fixed":
            return "fixed:%d:%d" % (int(start_index), hash(string_list))
        return float("nan")

    def pick(self, string_list, start_index, control_after_generation,
             skip_empty=True, strip=True, unique_id=None):

        lines = picker.split_lines(string_list, skip_empty)
        count = len(lines)

        if count == 0:
            return {
                "ui": {"list_pick": [{"index": -1, "count": 0}]},
                "result": ("", 0, 0),
            }

        lo = max(0, min(int(start_index), count - 1))
        key = str(unique_id)

        index, st = picker.resolve_index(
            control_after_generation, picker._STATE.get(key), lo, count
        )
        picker._STATE[key] = st

        value = lines[index]
        if strip:
            value = value.strip()

        return {
            "ui": {"list_pick": [{"index": index, "count": count}]},
            "result": (value, index, count),
        }


NODE_CLASS_MAPPINGS = {"ListPick": ListPick}
NODE_DISPLAY_NAME_MAPPINGS = {"ListPick": "List Pick"}
