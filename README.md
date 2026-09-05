# bulentgercek-nodes

![List Pick](bulentgercek-nodes-screenshot.png)

Custom nodes for ComfyUI. All nodes live under the `bulentgercek/text` category.

## Install

ComfyUI Manager, or clone into `ComfyUI/custom_nodes/`.

## Nodes

### List Pick

Picks one line out of a multiline string list and returns it as a string, together with the index that was picked and the total line count.

Inputs:

- `string_list` (STRING, multiline): one item per line.
- `start_index` (INT): the starting point for picking. This is a starting point only, not a lower bound — `increment` and `decrement` are free to wrap around to any line in the list, including lines before `start_index`.
- `control_after_generation` (fixed / increment / decrement / randomize): how the index changes from one run to the next.
- `skip_empty` (BOOLEAN): if true, blank lines are removed before indexing and counting.
- `strip` (BOOLEAN): if true, leading/trailing whitespace is stripped from the returned string.

Outputs:

- `string`: the picked line.
- `index`: the index that was picked.
- `count`: the number of usable lines (after `skip_empty` is applied).

Mode behavior:

- `fixed`: always returns `start_index`. No internal state involved.
- `increment` / `decrement`: the first run after a reset (see below) returns `start_index`. Every following run in the same queue action moves by one step and wraps around the full list — passing the last line goes back to line 0, going below line 0 goes back to the last line. Example: 3 lines, `start_index = 2`, `increment`, four runs in a row → indices `2, 0, 1, 2`.
- `randomize`: returns a uniformly random index over the whole list on every run.

State and reset:

`increment` and `decrement` need to remember the last picked index between runs. This memory is kept server-side, per node, in a plain Python dict keyed by the node's id — ComfyUI does not give custom `control_after_generation` combos any built-in state of their own, unlike the native `seed` widget.

That memory is cleared, and the walk restarts from `start_index`, whenever any of the following happens:

- `start_index` is changed.
- The number of usable lines changes (editing the list, or toggling `skip_empty`).
- A new Queue action is started in the UI.

The last point is what keeps this predictable across separate uses: queuing once with a batch count of N walks N steps forward from `start_index` within that one action, but the next time you press Queue, the walk starts over from `start_index` again — it does not keep drifting forward across unrelated queue presses.

Companion frontend (`web/list_pick.js`) adds:

- Two read-only rows on the node, "generation result" and "count", showing the last picked index and the current line count.
- A line-number gutter next to the text box. Before anything has run (or right after a reset), it highlights the line that the next run will pick. After a run, it highlights the line that was actually picked.
- A hook on the Queue action and on the server's queue-empty event, so the gutter and the "generation result" row snap back to previewing `start_index` as soon as the queue is empty, instead of staying on whatever was last generated.

Server route: `POST /bulentgercek/list_pick/reset` — accepts `{"ids": [<node_id>, ...]}` and clears the stored state for those node ids (or all state if no ids are given). Called by the frontend hook above; not meant to be called by hand.

### String Line Count

Counts the lines in a string.

Inputs:

- `text` (STRING, forced input, multiline): the text to count lines in.
- `skip_empty` (BOOLEAN): if true, blank lines are not counted.

Outputs:

- `count` (INT): the number of lines.

## License

MIT — see [LICENSE](LICENSE).
