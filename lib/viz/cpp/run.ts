import type { Parser } from "web-tree-sitter";
import { CLANG_FLAGS, PCH_FILE, PRELUDE, PRELUDE_INCLUDE } from "@/lib/viz/cpp/prelude";
import { instrument } from "@/lib/viz/cpp/instrument";
import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS } from "@/lib/viz/engines";
import type { Step, Trace, TraceError } from "@/lib/viz/trace";

export type RunClang = (args: string[], files: Record<string, string | Uint8Array>, options?: { stderr?: (bytes: Uint8Array | null) => void }) => Promise<Record<string, unknown>>;
export type WasiShim = typeof import("@bjorn3/browser_wasi_shim");
/** `pch`: the prelude precompiled with CLANG_FLAGS; without it every compile re-parses the prelude. */
export type CppEngine = { runClang: RunClang; shim: WasiShim; parser: Parser; pch?: Uint8Array };
export type CppPhase = "compiling" | "running";

const ERROR_LINE = /main\.cc:(\d+):\d+: (?:fatal )?error: (.*)/;

export function compileError(stderr: string): TraceError {
  const errors = stderr.split("\n").filter((line) => /\berror:/.test(line));
  const first = errors[0]?.match(ERROR_LINE);
  if (first) {
    const more = errors.length - 1;
    const suffix = more > 0 ? ` (and ${more} more error${more === 1 ? "" : "s"})` : "";
    return { kind: "compile", line: Number(first[1]), message: `Line ${first[1]}: ${first[2]}${suffix}` };
  }
  const message = (errors[0] ?? stderr).trim().slice(0, 500);
  return { kind: "compile", message: message || "Compile failed." };
}

export async function buildPch(runClang: RunClang): Promise<Uint8Array> {
  const files = await runClang(["clang++", ...CLANG_FLAGS, "-x", "c++-header", "__pl.h", "-o", PCH_FILE], { "__pl.h": PRELUDE });
  return files[PCH_FILE] as Uint8Array;
}

export async function runCpp(engine: CppEngine, code: string, stdin: string, onPhase?: (phase: CppPhase) => void): Promise<Trace> {
  const tree = engine.parser.parse(code);
  const traceable = !!tree && !tree.rootNode.hasError;
  const instrumented = traceable ? instrument(tree!.rootNode, code) : code;
  // With the precompiled prelude the source needs no prefix, so its lines are already the user's.
  const source = engine.pch ? instrumented : traceable ? PRELUDE_INCLUDE + instrumented : code;
  const pchArgs = engine.pch ? ["-include-pch", PCH_FILE] : [];
  const files: Record<string, string | Uint8Array> = { "main.cc": source, "__pl.h": PRELUDE };
  if (engine.pch) files[PCH_FILE] = engine.pch;
  onPhase?.("compiling");
  let stderr = "";
  const decoder = new TextDecoder();
  let wasm: Uint8Array;
  try {
    const output = await engine.runClang(["clang++", ...CLANG_FLAGS, ...pchArgs, "main.cc", "-o", "prog.wasm"], files, {
      // clang writes stderr a byte at a time.
      stderr: (bytes) => { if (bytes) stderr += decoder.decode(bytes, { stream: true }); },
    });
    wasm = output["prog.wasm"] as Uint8Array;
  } catch {
    return { language: "cpp", steps: [], stdout: "", error: compileError(stderr) };
  }
  onPhase?.("running");
  const trace = await execute(engine.shim, wasm, stdin);
  return traceable ? trace : { ...trace, steps: [], notice: VIZ_COPY.untraceable };
}

async function execute(shim: WasiShim, wasm: Uint8Array, stdin: string): Promise<Trace> {
  const outDecoder = new TextDecoder();
  let stdout = "";
  const appendOut = (bytes: Uint8Array) => {
    if (stdout.length >= LIMITS.maxStdoutChars) return;
    stdout = (stdout + outDecoder.decode(bytes, { stream: true })).slice(0, LIMITS.maxStdoutChars);
  };
  const steps: Step[] = [];
  let stopped: Trace["stopped"];
  const traceDecoder = new TextDecoder();
  let pending = "";
  const onTrace = (bytes: Uint8Array) => {
    pending += traceDecoder.decode(bytes, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      try {
        const record = JSON.parse(line) as { end?: "steps" | "time"; line: number; stack: Step["stack"] };
        if (record.end) stopped = record.end;
        else steps.push({ line: record.line, stack: record.stack, out: stdout.length });
      } catch {
        // A partial record at a crash: ignore it.
      }
    }
  };
  const fds = [
    new shim.OpenFile(new shim.File(new TextEncoder().encode(stdin))),
    new shim.ConsoleStdout(appendOut),
    new shim.ConsoleStdout(appendOut),
    new shim.ConsoleStdout(onTrace),
  ];
  const wasi = new shim.WASI([], [], fds);
  let error: TraceError | undefined;
  try {
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasm as BufferSource), { wasi_snapshot_preview1: wasi.wasiImport });
    wasi.start(instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } });
  } catch (e) {
    const last = steps[steps.length - 1];
    error = { kind: "runtime", message: `The program crashed: ${e instanceof Error ? e.message : String(e)}`, ...(last ? { line: last.line } : {}) };
  }
  return { language: "cpp", steps, stdout, ...(error ? { error } : {}), ...(stopped ? { stopped } : {}) };
}
