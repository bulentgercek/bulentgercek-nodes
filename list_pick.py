"""List Pick — picks one line from a multiline string list.

start_index is a starting point, NOT a lower bound: increment and decrement walk the
whole list (0..count-1) circularly, wrapping past the last line back to 0 and below 0
back to the last line. control_after_generation: fixed / increment / decrement /
randomize. The index is resolved on the server and sent back to the UI.

The picking core (line splitting, index walk, per-key state, reset) lives in
`lib/picker.py`; Prompt Builder uses the same module.
"""

from aiohttp import web
from server import PromptServer

from .lib import picker

MAX_INT = 0xFFFFFFFF
MODES = picker.MODES


# Registered on ComfyUI's own aiohttp server, so the pack needs no server of its own.
@PromptServer.instance.routes.post("/bulentgercek/list_pick/reset")
async def _list_pick_reset(request):
    """Clear the hidden increment/decrement counters for the given nodes.

    Called by the frontend when a new Queue action starts; the next pick() then
    restarts from start_index.
    """
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
        # `fixed` is deterministic, so a stable key lets ComfyUI reuse the cached
        # result. Every other mode must run again on every queue, which is what the
        # NaN return means: NaN never equals the previous value.
        if control_after_generation == "fixed":
            return "fixed:%d:%d" % (int(start_index), hash(string_list))
        return float("nan")

    def pick(self, string_list, start_index, control_after_generation,
             skip_empty=True, strip=True, unique_id=None):

        lines = picker.split_lines(string_list, skip_empty)
        count = len(lines)

        # An empty list must not stall the graph: it reports index -1 to the UI and
        # hands the downstream nodes an empty string.
        if count == 0:
            return {
                "ui": {"list_pick": [{"index": -1, "count": 0}]},
                "result": ("", 0, 0),
            }

        # start_index is clamped rather than rejected, so shrinking the list below the
        # configured index keeps the node working.
        lo = max(0, min(int(start_index), count - 1))
        key = str(unique_id)

        index, st = picker.resolve_index(
            control_after_generation, picker._STATE.get(key), lo, count
        )
        picker._STATE[key] = st

        value = lines[index]
        if strip:
            value = value.strip()

        # "ui" reaches the node's onExecuted handler in the browser; "result" travels
        # down the graph. The gutter needs the index, the graph does not.
        return {
            "ui": {"list_pick": [{"index": index, "count": count}]},
            "result": (value, index, count),
        }


NODE_CLASS_MAPPINGS = {"ListPick": ListPick}
NODE_DISPLAY_NAME_MAPPINGS = {"ListPick": "List Pick"}
