// Excalidraw opens with the selection tool, so a stylus stroke draws a selection box instead of ink.
// PentoLive is written on with a tablet pen, so editors on a touch device start with the pen tool.
// This must go in through `initialData`: Excalidraw resets the active tool while it initializes,
// which would undo a setActiveTool() call made as soon as the API is available.
export function initialAppState(role: "editor" | "viewer", coarsePointer: boolean) {
  if (role !== "editor" || !coarsePointer) return undefined;
  return { activeTool: { type: "freedraw" as const, customType: null, lastActiveTool: null, locked: false } };
}
