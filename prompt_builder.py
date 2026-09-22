"""Prompt Builder — multi-category prompt assembler.

Categories are not node inputs: they are data stored in a hidden JSON widget
(`categories`) and edited in the modal behind the `Open Prompt Builder` button,
so the node stays small no matter how many lists it holds.

Outputs: `all` (the joined prompt) plus one STRING per category. The category
outputs are declared up to MAX_CAT_OUT at class level; the frontend shows as many
slots as there are categories and labels them.

Line splitting, per-category index walking and reset live in `lib/picker.py`;
the joining itself is in `lib/promptbuild.py`.
"""

from aiohttp import web
from server import PromptServer

from .lib import picker, promptbuild

# Upper bound on category output slots. RETURN_TYPES is fixed at class level, so the
# slots are declared ahead of time; unused ones return "" and stay hidden in the UI.
# This may be raised, NEVER lowered: saved workflows would lose their wires.
MAX_CAT_OUT = 32


@PromptServer.instance.routes.post("/bulentgercek/prompt_builder/reset")
async def _prompt_builder_reset(request):
    """Clear every category counter belonging to the given nodes.

    Same contract as the List Pick route: the keys are "unique_id:" prefixed, and
    reset_ids takes the prefixed sub-keys with them.
    """
    try:
        data = await request.json()
    except Exception:
        data = {}
    ids = data.get("ids") if isinstance(data, dict) else None
    picker.reset_ids(ids)
    return web.json_response({"ok": True})


class PromptBuilder:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "delimiter": ("STRING", {
                    "default": ". ",
                    "tooltip": "Inserted between categories when joining (default: period + space).",
                }),
                "categories": ("STRING", {
                    "default": "[]",
                    "tooltip": "Category JSON array. Edited via 'Open Prompt Builder'; hidden on the node.",
                }),
            },
            "hidden": {"unique_id": "UNIQUE_ID"},
        }

    # One STRING for `all`, then one per possible category.
    RETURN_TYPES = ("STRING",) * (MAX_CAT_OUT + 1)
    RETURN_NAMES = ("all",) + tuple("cat_%d" % i for i in range(1, MAX_CAT_OUT + 1))
    FUNCTION = "build"
    CATEGORY = "bulentgercek/text"
    DESCRIPTION = "Multi-category prompt builder; categories are edited in a modal. Outputs the joined prompt (all) plus one STRING per category."

    @classmethod
    def IS_CHANGED(cls, delimiter, categories, unique_id=None):
        # Caching is only safe while every category is `fixed`. A single walking or
        # random category has to re-run, even a disabled one: its own output still
        # emits and its counter still has to move.
        cats = promptbuild.parse_categories(categories)
        non_fixed = any(
            isinstance(c, dict) and c.get("mode", "fixed") != "fixed"
            for c in cats
        )
        if non_fixed:
            return float("nan")
        return "fixed:%d" % hash((delimiter, categories))

    def build(self, delimiter, categories, unique_id=None):
        cats = promptbuild.parse_categories(categories)
        final, ui_cats, cat_values = promptbuild.build_prompt(
            cats, delimiter, unique_id, picker._STATE
        )
        # The tuple has to match RETURN_TYPES exactly, so extra categories are dropped
        # and missing ones are padded with empty strings.
        outs = [final] + cat_values[:MAX_CAT_OUT]
        outs += [""] * (MAX_CAT_OUT + 1 - len(outs))
        return {
            "ui": {"prompt_builder": [{"final": final, "cats": ui_cats}]},
            "result": tuple(outs),
        }


NODE_CLASS_MAPPINGS = {"PromptBuilder": PromptBuilder}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptBuilder": "Prompt Builder"}
