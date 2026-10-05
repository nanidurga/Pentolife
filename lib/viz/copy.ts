import type { Language } from "@/lib/viz/engines";

// Visualizer copy (spec §6). Change it here.
export const VIZ_COPY = {
  loading: { python: "Loading Python… (first run only)", cpp: "Loading the C++ compiler… (first run only, about 30 MB)" } satisfies Record<Language, string>,
  compiling: "Compiling…",
  running: "Running…",
  stoppedSteps: "Stopped after 1,000 steps. Showing the first 1,000.",
  stoppedTime: "Stopped after 10 seconds.",
  stoppedSize: (steps: number) => `Trace too large. Showing the first ${steps.toLocaleString("en-US")} steps.`,
  waitingRun: "Waiting for the candidate to run code.",
  noEditor: "The candidate isn't on the visualizer yet.",
  emptyEditor: "Run your code to see it step by step.",
  noSteps: "This run has no steps to show.",
  loadFailed: { python: "Couldn't load Python. Check the connection and run again.", cpp: "Couldn't load the C++ compiler. Check the connection and run again." } satisfies Record<Language, string>,
  untraceable: "The visualizer couldn't follow this code (it may use macros or syntax it doesn't support). Showing the program's output only.",
  busy: "A run is already in progress.",
  replaceCode: (name: string) => `Replace your code with “${name}”?`,
} as const;
