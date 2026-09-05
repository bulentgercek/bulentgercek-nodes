"""Prompt Builder — cok kategorili prompt olusturucu.

Kategoriler node'un girdisi degil, gizli bir JSON widget'inda (`categories`)
saklanan veridir. Duzenleme grafik uzerinde degil, `Open Prompt Builder`
butonuyla acilan modalda yapilir.

Ciktilar: `all` (birlesmis prompt) + kategori basina bir STRING cikisi. Kategori
ciktilari sinif seviyesinde MAX_CAT_OUT kadar on-tanimlidir; frontend gorunur
slot sayisini kategori sayisina esitler ve etiketler.

Satir bolme, per-kategori index yurutme ve reset paylasilan `lib/picker.py`'de;
kategori birlestirme `lib/promptbuild.py`'dedir.
"""

from aiohttp import web
from server import PromptServer

from .lib import picker, promptbuild

# Kategori basina cikis slotu ust siniri. RETURN_TYPES sabit oldugu icin
# on-tanimlanir; kullanilmayanlar "" doner ve frontend'de gizlenir.
# Artirilabilir, DUSURULMEZ (kayitli workflow'lardaki kablolar bozulur).
MAX_CAT_OUT = 32


@PromptServer.instance.routes.post("/bulentgercek/prompt_builder/reset")
async def _prompt_builder_reset(request):
    """Yeni bir Queue tiklamasi basladiginda bu node'lara ait tum kategori
    sayaclarini (unique_id: on-ekli anahtarlar) temizler."""
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

    RETURN_TYPES = ("STRING",) * (MAX_CAT_OUT + 1)
    RETURN_NAMES = ("all",) + tuple("cat_%d" % i for i in range(1, MAX_CAT_OUT + 1))
    FUNCTION = "build"
    CATEGORY = "bulentgercek/text"
    DESCRIPTION = "Multi-category prompt builder; categories are edited in a modal. Outputs the joined prompt (all) plus one STRING per category."

    @classmethod
    def IS_CHANGED(cls, delimiter, categories, unique_id=None):
        # Tum kategoriler 'fixed' ise sonuc deterministik -> cache calissin.
        # Herhangi biri increment/decrement/randomize ise her run yeniden hesapla
        # (disabled olsa bile — kendi cikisi ve sayaci ilerlemeli).
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
        outs = [final] + cat_values[:MAX_CAT_OUT]
        outs += [""] * (MAX_CAT_OUT + 1 - len(outs))
        return {
            "ui": {"prompt_builder": [{"final": final, "cats": ui_cats}]},
            "result": tuple(outs),
        }


NODE_CLASS_MAPPINGS = {"PromptBuilder": PromptBuilder}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptBuilder": "Prompt Builder"}
