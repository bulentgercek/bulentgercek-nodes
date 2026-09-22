# Changelog

## [1.2.0] - 2026-09-23
### Added
- Startup line in the ComfyUI log: the pack reports how many nodes it loaded, with the author signature.
- `.github/FUNDING.yml` and a one-line support link in the README.
- This changelog file. Entries for 1.0.0 and 1.1.0 are included for the record.

### Changed
- License moved from MIT to Apache License 2.0. Versions 1.0.0 and 1.1.0 were released under MIT and stay that way; Apache-2.0 applies from this version on. The repository now carries `LICENSE` and `NOTICE`.
- Comments and docstrings are in English throughout. No node behavior changed: picking logic, state handling and the server routes are unchanged.

## [1.1.0] - 2026-09-06
### Added
- Prompt Builder node: picks one line from each of several named categories stored inside the node and joins them into one prompt. Outputs the joined `all` string plus one STRING output per category; outputs are bound to the category id, so wires survive renaming and reordering.
- Per-category `mode`, `start_index` and `enabled`. A disabled category drops out of `all` but its own output keeps working.
- Last Prompt preview with category, mode and index badges; the copy button copies plain text.
- Editor modal with drag-to-reorder, per-card line gutter and Fit Text, JSON export/import, and browser-wide settings (default categories, delimiter, window layout, UI and list text size, compact rows, toggle fit text all).
- `POST /bulentgercek/prompt_builder/reset` server route.

### Changed
- List Pick's picking logic and frontend helpers moved into shared `lib/` and `web/lib/` modules; List Pick behavior is unchanged.
- Shorter registry description.

## [1.0.0] - 2026-09-05
### Added
- List Pick node: picks one line from a multiline list with `fixed` / `increment` / `decrement` / `randomize`, returning the line, its index and the line count. `start_index` is a starting point, not a lower bound; increment and decrement wrap around the whole list. `skip_empty` and `strip` options.
- List Pick state resets when `start_index` changes, when the usable line count changes, and when a new Queue action starts; `POST /bulentgercek/list_pick/reset` server route.
- List Pick line-number gutter and read-only "generation result" and "count" rows.
- String Line Count node: counts the lines in a string, optionally skipping blank lines.
- MIT license, `pyproject.toml` for the Comfy Registry, README with screenshots.
