"""List secim cekirdegi — saf Python, ComfyUI'siz. List Pick ve Prompt Builder ortak.

- split_lines  : metni satirlara boler, istege bagli bos satirlari atar.
- resolve_index: mod + mevcut state -> (index, yeni state). Global tutmaz, test edilebilir.
- _STATE / reset_ids: increment/decrement sayaclarinin paylasilan deposu. Anahtar
  List Pick'te "unique_id", Prompt Builder'da "unique_id:kategori_id" biciminde.
"""

import random

MODES = ["fixed", "increment", "decrement", "randomize"]

# paylasilan sayac deposu: anahtar -> {"lo": int, "count": int, "next": int}
_STATE = {}


def split_lines(text, skip_empty=True):
    if not isinstance(text, str) or text == "":
        return []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    if skip_empty:
        lines = [ln for ln in lines if ln.strip() != ""]
    return lines


def resolve_index(mode, state, lo, count, rng=random):
    """Bir sonraki index'i ve guncellenmis state'i dondurur.

    state : {"lo","count","next"} veya None. lo/count degistiyse ya da state yoksa
            sayac lo'ya sifirlanir.
    count : >= 1 varsayilir (bos liste bu fonksiyon cagrilmadan once elenir).
    Donen : (index, new_state) — cagiran new_state'i kendi deposuna yazar.
    """
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
        if index < 0 or index > count - 1:
            index = lo
        if mode == "increment":
            state["next"] = (index + 1) % count
        else:  # decrement
            state["next"] = (index - 1) % count

    return index, state


def reset_ids(ids):
    """Verilen anahtarlarin — ve "anahtar:" on-ekli tum alt anahtarlarin —
    sayacini siler. ids bos/None ise tum depo temizlenir (eski davranis)."""
    if not ids:
        _STATE.clear()
        return
    for raw in ids:
        i = str(raw)
        _STATE.pop(i, None)
        prefix = i + ":"
        for k in [key for key in _STATE if key.startswith(prefix)]:
            _STATE.pop(k, None)
