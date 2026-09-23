"""Line picking shared by List Pick and Prompt Builder. Pure Python, no ComfyUI imports.

split_lines   : text -> lines, optionally dropping blank ones.
resolve_index : (mode, state) -> (index, new state).
_STATE        : shared counter store. Keys are "unique_id" for List Pick and
                "unique_id:category_id" for Prompt Builder.
"""

import random

MODES = ["fixed", "increment", "decrement", "randomize"]

# The counter store lives for as long as the ComfyUI process does: restarting the
# server resets every walk. Values are {"lo": int, "count": int, "next": int}.
_STATE = {}


def split_lines(text, skip_empty=True):
    if not isinstance(text, str) or text == "":
        return []
    # Normalise CRLF and CR so a list pasted from anywhere splits the same way.
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if skip_empty:
        lines = [ln for ln in lines if ln.strip() != ""]
    return lines


def resolve_index(mode, state, lo, count, rng=random):
    """Return the index to use now and the state to store for the next run.

    state : {"lo","count","next"} or None.
    count : assumed >= 1; an empty list is handled before this is called.
    """
    # The walk restarts whenever its ground truth moved: a different starting point
    # or a different number of usable lines makes the stored "next" meaningless.
    if state is None or state.get("lo") != lo or state.get("count") != count:
        state = {"lo": lo, "count": count, "next": lo}

    if mode == "randomize":
        index = rng.randint(0, count - 1)
        state["next"] = lo
    elif mode == "fixed":
        index = lo
        state["next"] = lo
    else:  # increment / decrement
        index = state["next"]
        # A stored index can fall out of range if the list shrank between runs.
        if index < 0 or index > count - 1:
            index = lo
        # Modulo wraps the walk around the whole list, never a sub-range from lo.
        if mode == "increment":
            state["next"] = (index + 1) % count
        else:  # decrement
            state["next"] = (index - 1) % count

    return index, state


def reset_ids(ids):
    """Drop the counters for the given keys and for every "key:" prefixed sub-key.

    An empty or missing id list resets nothing.
    """
    # Prompt Builder keys its categories as "<node id>:<category id>", so resetting a
    # node has to take its categories with it.
    #
    # A request that names no node resets nothing: the reset route is open to anything
    # that can reach the ComfyUI server, and a body-less call used to wipe every
    # counter in the process, including nodes the caller knows nothing about.
    if not ids:
        return
    for raw in ids:
        i = str(raw)
        _STATE.pop(i, None)
        prefix = i + ":"
        # Materialise the key list first: the loop deletes from the dict it reads.
        for k in [key for key in _STATE if key.startswith(prefix)]:
            _STATE.pop(k, None)
