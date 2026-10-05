# Sub-project — Live Algorithm Visualizer (Python and C++)

**Date:** 2026-10-06
**Status:** Draft for review
**Branch:** `feat/algo-visualizer` (from `feat/board-details`, PR #7; it uses the Marker Board styles and top bar)
**Source:** `Pentolife Features_extended.docx`, item 3 (reference: https://github.com/somyacodes07/algoviz, used for ideas only).

## 1. Intent

During an interview the interviewer asks a question. The candidate writes the solution on their **laptop** in PentoLive, runs it, and steps through it visually while the interviewer watches live from the same link they already use for the board. The tablet keeps drawing on the board at the same time.

### Success criteria

1. Every board has a Visualizer page at `/room/<id>/visualize`, reachable from a **Board | Visualizer** switch in the top bar of both pages. The same editor and viewer links (and QR code) work for both pages.
2. An editor can write Python or C++ in a code editor, pick a starter template, give program input (stdin), and run the code.
3. A run produces a step-by-step trace: current line, local variables, call stack and program output at every step. Arrays, 2-D arrays, maps, sets and (Python) linked lists and trees are drawn, not just printed.
4. The editor can step back and forward, play and pause at 0.5×, 1× and 2×, and drag a timeline.
5. A viewer on the visualizer page sees the editor's code **while it is being typed** (within about half a second), and after a run sees the same step the editor is on, following every scrub and play step.
6. A viewer who opens the page late, or reloads, catches up to the current code, trace and step within a few seconds.
7. Infinite loops and very long runs stop cleanly ("Stopped after 1,000 steps" or "Stopped after 10 seconds"); the page never freezes.
8. Compile errors and runtime errors are shown with their line marked.
9. Python and C++ both ship in this release. Code never leaves the editor's browser except as the live code and trace sent to room members.
10. Board behaviour (drawing, sync, saving, S Pen) is unchanged. `npm test`, `npx tsc --noEmit` and `npm run build` are green.

### Non-goals

- Running code on the viewer's side. Viewers only render what they receive.
- C++ structs, classes, pointers and linked structures (Python objects are supported). Big-O estimates, heatmaps, the VS Code extension.
- Saving code or traces on the server. Code is backed up only in the editor's browser.
- Languages other than Python and C++.
- Collaborative editing. Editors drive; viewers are read-only.

## 2. Routes and navigation

| Route | Purpose |
|---|---|
| `/room/[roomId]` | Board (unchanged behaviour) |
| `/room/[roomId]/visualize` | Visualizer. Same query parameters as the board: `role`, `token`, `viewer`, `local` |

- `StatusBar` gets a segmented **Board | Visualizer** switch. Each side is a `Link` to the other route with the current query string, so access never changes when switching.
- The visualizer page joins the room through the existing `joinRoom` + `createJoinRetry` (anonymous session included), exactly like the board. A failed join shows the existing "This board link is invalid or expired" card.
- The status bar on the visualizer shows connection status and viewer count like the board. Save status is not shown (nothing is saved to the server).

## 3. Execution

All execution happens in a **Web Worker** in the editor's browser, so the page stays responsive. The host (`lib/viz/runner.ts`) terminates the worker on timeout and creates a fresh one for the next run.

| Limit | Value |
|---|---|
| Steps recorded | 1,000 (`MAX_STEPS`) |
| Wall-clock time per run (after engines are loaded) | 10 s (`RUN_TIMEOUT_MS`) |
| Code size | 50,000 characters |
| Stdin size | 10,000 characters |
| Serialized trace | 1,000,000 bytes (`MAX_TRACE_BYTES`); steps beyond it are dropped and the run is marked stopped |
| Value depth / collection items / string length | 4 levels / 100 items / 200 characters, then truncated |

### Python

- Pyodide, pinned to an exact version and loaded inside the worker from `cdn.jsdelivr.net`. It is downloaded on the first Python run and cached by the browser.
- A tracer written in Python (`lib/viz/python/tracer.py`, shipped as a string) runs the user's code with `sys.settrace`, recording `line`, `call` and `return` events for the user's file only. At each line event it records the line, the whole call stack and each frame's locals (serialized, see §4).
- `input()` reads from the stdin text; `print` output is captured.
- Exceptions end the run with the message and the line where it was raised.

### C++

- **Compiler:** clang compiled to WebAssembly (`@yowasp/clang`, pinned), running in the worker. It targets WASI; the program runs in the worker through a WASI shim with stdin and stdout wired to the run.
- **Instrumentation:** before compiling, the code is parsed with `web-tree-sitter` and the C++ grammar, and rewritten (`lib/viz/cpp/instrument.ts`):
  - The runtime header `__pl` (`lib/viz/cpp/prelude.ts`) is prepended. It provides serialization overloads, a frame stack and the step counter.
  - At the start of every function body: `__pl_frame __pl_f("<name>", <line>);`. Its RAII push and pop builds the call stack, including recursion.
  - Before every statement inside a function body: `__pl_step(<line>, [&](__pl_w& w){ w.var("x", x); ... });`, listing the variables declared before that statement in the enclosing scopes, plus the parameters.
  - Statements are wrapped so that single-statement `if`/`for`/`while` bodies stay correct (`{ step; stmt; }`).
  - Line numbers refer to the **user's** source, never the instrumented source. Compile errors are mapped back to user lines.
- **Supported values:** integer and floating types, `bool`, `char`, `std::string`, C arrays with a known size, `std::vector` (nested for 2-D), `std::array`, `std::map`, `std::unordered_map`, `std::set`, `std::unordered_set`, `std::pair`, `std::stack`, `std::queue`, `std::deque`. Any other type is recorded as `{ t: "unsupported", type: "<name>" }` through a lowest-priority catch-all overload, so unsupported code still compiles and runs.
- `__pl_step` stops the program after `MAX_STEPS` by writing an end marker and calling `exit(0)`.
- Trace records go to a dedicated channel (a reserved file descriptor in the WASI shim), never mixed with the program's stdout.

### Spike gate (first plan task)

Before the C++ work is built, a throwaway spike proves on a laptop, in Chrome:

1. `@yowasp/clang` compiles a 30-line `vector<int>` bubble sort with `<iostream>`, `<vector>`, `<map>` and `<algorithm>` to WASI, and the shim runs it with stdin and stdout.
2. A second compile, after the first load, takes **under 5 seconds**.
3. `web-tree-sitter` with the C++ grammar parses the same file in the browser.

If any of these fails, stop and bring the findings back to the user. The fallback is the public Wandbox compiler behind the same `CppBackend` interface, and the user decides.

## 4. Trace format (shared by both languages)

`lib/viz/trace.ts`:

```ts
type Value =
  | { t: "num"; v: number | string }          // string for integers beyond 2^53
  | { t: "str"; v: string; cut?: true }
  | { t: "bool"; v: boolean }
  | { t: "none" }
  | { t: "list"; kind: "list" | "tuple" | "vector" | "array" | "deque" | "stack" | "queue"; items: Value[]; more?: number }
  | { t: "set"; items: Value[]; more?: number }
  | { t: "map"; entries: [Value, Value][]; more?: number }
  | { t: "obj"; id: string; cls: string; fields: Record<string, Value> }   // Python objects
  | { t: "ref"; id: string }                  // an object already serialized in this step
  | { t: "unsupported"; type: string }
  | { t: "cut" };                             // depth limit reached

type Frame = { fn: string; line: number; locals: Record<string, Value> };
type Step = { line: number; stack: Frame[]; out: number };   // stack outermost first; out = stdout length so far
type Trace = {
  language: "python" | "cpp";
  steps: Step[];
  stdout: string;
  error?: { message: string; line?: number; kind: "compile" | "runtime" };
  stopped?: "steps" | "time" | "size";
};
```

- C++ outer frames keep the locals from their last recorded step. Python records every frame each step.
- `trace.ts` also provides `traceBytes`, `capTrace` (enforces `MAX_TRACE_BYTES`) and `changedVariables(prev, next)`, which drives the "just changed" highlight.

## 5. Live following

New topic **`room:<id>:viz`**. The existing policies already authorize it: members receive, editors send. **No migration is needed.** Viewers send only on `room:<id>:interact`, as today.

| Event | Topic | Sender | Payload |
|---|---|---|---|
| `viz-code` | `:viz` | editor | `{ from, language, code, stdin, cursorLine, rev }` |
| `viz-trace` | `:viz` | editor | `{ from, runId, index, total, data }`: the JSON trace split into ≤ `MAX_CHUNK_BYTES` pieces |
| `viz-step` | `:viz` | editor | `{ from, runId, step, playing }` |
| `viz-sync-request` | `:interact` | anyone | `{ from }` |

- **Code:** sent at most every 300 ms while typing (trailing edge), and on language or stdin change. `rev` increases monotonically, and receivers ignore older revs.
- **Trace:** sent once per run, in chunks. A receiver assembles chunks by `runId` and shows the trace only when all `total` chunks have arrived. A partial run is replaced by a newer `runId`.
- **Step:** sent on every step change (scrub, step buttons, play ticks). Play runs on the editor; viewers just follow `viz-step`.
- **Catch-up:** a viewer sends `viz-sync-request` on subscribe. Editors on the visualizer page reply with `viz-code`, then the current trace and step, at most once per `SYNC_REPLY_MIN_GAP_MS`. With no editor present the viewer sees "Waiting for the candidate".
- **Several editors** (for example laptop and tablet both on the visualizer): last writer wins, and every editor also follows incoming messages. An editor typing ignores incoming `viz-code` for 2 s after its own last keystroke, so two editors don't fight over the text.
- **Limits on receive:** payloads that are malformed or over the size limits are ignored.
- **Failures:** a failed send is not retried on a timer. The catch-up path covers it (AGENTS.md invariant).

## 6. Screen

Marker Board style, laid out as in the approved mock (direction B).

- **Top:** the status bar with **Board | Visualizer**, status and viewer count.
- **Left pane:** a language switch (Python / C++), **Templates**, **Run** (primary), the code editor (CodeMirror 6 with Python and C++ modes, read-only for viewers, current line highlighted during a trace), and a collapsible **Input** box.
- **Right pane, for the current step:**
  - **Data:** each list/vector/array is drawn as bars when all items are numbers, or cells otherwise. Pointer labels appear under the index each matching integer variable points to.
  - 2-D lists are drawn as a grid with row and column pointers.
  - Maps are drawn as a key/value table.
  - Sets are drawn as chips.
  - Python objects with `next` are drawn as a linked list; with `left`/`right`, as a binary tree.
  - **Variables:** name and value for every local in the current frame. Changed ones are highlighted in yellow.
  - **Call stack:** frames, innermost on top, each with function name and line.
  - **Output:** stdout up to the current step.
- **Bottom:** the timeline with ⏮ ◀ ▶/❚❚ ▶ ⏭, a draggable track, "step N / M" and a speed selector (0.5× / 1× / 2×). Viewers see the timeline read-only.
- **Pointers** (`lib/viz/pointers.ts`): an integer local in the same frame is a pointer onto a sequence if its name is one of `i j k l r lo hi low high mid left right start end begin p q slow fast idx index pos curr cur` (or starts with one of them followed by digits or `_`), and its value is within `0..length`. A value equal to `length` is shown as a past-the-end marker.
- **Narrow screens** (< 900 px): the panes stack, code above the visualization.
- **Templates** (`lib/viz/templates.ts`): 8 per language with the same set in both: bubble sort, binary search, two-sum with hash map, two pointers (container with most water), recursion (factorial / fibonacci), BFS on a grid, merge sort, and a linked list (Python) or stack-based parentheses check (C++). Choosing a template asks for confirmation inside the page when the editor is not empty.

### Copy

| Situation | Text |
|---|---|
| First Python run | "Loading Python… (first run only)" |
| First C++ run | "Loading the C++ compiler… (first run only, about 30 MB)" |
| Running | "Running…" |
| Stopped on steps | "Stopped after 1,000 steps. Showing the first 1,000." |
| Stopped on time | "Stopped after 10 seconds." |
| Stopped on size | "Trace too large. Showing the first N steps." |
| Viewer, nothing yet | "Waiting for the candidate to run code." |
| Viewer, no editor online | "The candidate isn't on the visualizer yet." |

## 7. Local backup

`localStorage` key `pentolive:viz:<roomId>` holds `{ language, code, stdin }` per language, written at most once a second. The page restores it on open. If it is empty, the page starts with the bubble sort template. Viewers never write it.

## 8. Error handling

- Engine download fails: "Couldn't load Python/the C++ compiler. Check the connection and run again." Python and C++ fail independently.
- Compile error: the clang message, mapped to the user's line, shown under the editor with that line marked. No trace.
- Runtime error or exception: the trace up to that point, plus the message and line.
- Worker timeout: the worker is terminated, the steps recorded so far are kept, and the run is marked `time`.
- Join failure, offline and reconnect: same behaviour and copy as the board's status bar.

## 9. Files

| File | Responsibility |
|---|---|
| `app/room/[roomId]/visualize/page.tsx` | Route; parses query like the board page |
| `components/viz/Visualizer.tsx` | Integration: join, channel, run, follow, backup |
| `components/viz/CodeEditor.tsx` | CodeMirror wrapper (client-only via `next/dynamic`) |
| `components/viz/TraceView.tsx` + `components/viz/views/*` | Data, variables, call stack, output views |
| `components/viz/Timeline.tsx` | Scrubber and playback controls |
| `components/StatusBar.tsx` | Adds the Board / Visualizer switch |
| `lib/viz/trace.ts` | Types, size capping, changed-variable diff |
| `lib/viz/pointers.ts` | Pointer detection |
| `lib/viz/messages.ts` | Topic, events, payload validation |
| `lib/viz/channel.ts` | `openVizConnection`: send and receive, chunking via `lib/sync/chunk.ts` |
| `lib/viz/runner.ts` | Worker host with timeout |
| `lib/viz/python/*` | Worker and tracer |
| `lib/viz/cpp/*` | Worker, instrumentation, prelude, error-line mapping |
| `lib/viz/templates.ts` | Starter programs |
| `lib/viz/backup.ts` | Local backup read and write |

## 10. Testing

- **vitest (node):**
  - `trace.test.ts`: caps, byte limit, changed variables.
  - `pointers.test.ts`: names, bounds, past-the-end.
  - `messages.test.ts`: validation and rejection of malformed or oversized payloads.
  - `channel` chunk assembly: out-of-order chunks, a newer `runId` replacing a partial one.
  - `instrument.test.ts`: fixture programs covering single-statement bodies, nested scopes, shadowing, recursion, `for` init variables, and line mapping. It uses `web-tree-sitter` in node.
  - `backup.test.ts`.
- **Engine tests (node, slower, separate script `npm run test:engines`):**
  - The Python tracer runs on Pyodide in node.
  - The C++ pipeline compiles and runs with `@yowasp/clang` in node.
  - For bubble sort, recursion, a timeout loop and a runtime error, assert the recorded steps, lines, locals and stdout.
- **Browser:** on a laptop-sized window, a Python run and a C++ run of each template. A second browser on the viewer link sees live typing, catches up after a reload, follows scrub and play, and shows "Waiting…" before the first run. The board's pen drawing is re-checked.
- **Gates:** `npm test`, `npx tsc --noEmit`, `npm run build`.
