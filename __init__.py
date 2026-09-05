from .string_line_count import (
    NODE_CLASS_MAPPINGS as _slc_classes,
    NODE_DISPLAY_NAME_MAPPINGS as _slc_names,
)
from .list_pick import (
    NODE_CLASS_MAPPINGS as _lp_classes,
    NODE_DISPLAY_NAME_MAPPINGS as _lp_names,
)

NODE_CLASS_MAPPINGS = {**_slc_classes, **_lp_classes}
NODE_DISPLAY_NAME_MAPPINGS = {**_slc_names, **_lp_names}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
