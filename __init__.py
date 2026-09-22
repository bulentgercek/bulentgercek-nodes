"""Pack entry point: ComfyUI reads the two mappings and WEB_DIRECTORY from here.

Each node keeps its own module and its own mappings; this file only merges them.
Adding a node means a new module plus one more import below.
"""

from .string_line_count import (
    NODE_CLASS_MAPPINGS as _slc_classes,
    NODE_DISPLAY_NAME_MAPPINGS as _slc_names,
)
from .list_pick import (
    NODE_CLASS_MAPPINGS as _lp_classes,
    NODE_DISPLAY_NAME_MAPPINGS as _lp_names,
)
from .prompt_builder import (
    NODE_CLASS_MAPPINGS as _pb_classes,
    NODE_DISPLAY_NAME_MAPPINGS as _pb_names,
)

NODE_CLASS_MAPPINGS = {**_slc_classes, **_lp_classes, **_pb_classes}
NODE_DISPLAY_NAME_MAPPINGS = {**_slc_names, **_lp_names, **_pb_names}

# A node pack has no CLI, so the startup line is where it signs itself: anyone
# running ComfyUI sees it in the console and in comfyui.log, without opening a file.
print(
    f"[bulentgercek-nodes] {len(NODE_CLASS_MAPPINGS)} nodes loaded"
    " - Created by Bulent Gercek"
)

# Without this the browser never loads web/, and every frontend file stays dead.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
