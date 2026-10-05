import { describe, expect, it } from "vitest";
import { compileError } from "@/lib/viz/cpp/run";

describe("compileError", () => {
  it("reports the first error on the user's line with a count of the rest", () => {
    const stderr = "main.cc:4:5: error: use of undeclared identifier 'x'\n    4 |     x++;\n      |     ^\nmain.cc:9:1: error: expected '}'\n2 errors generated.\n";
    expect(compileError(stderr)).toEqual({ kind: "compile", line: 4, message: "Line 4: use of undeclared identifier 'x' (and 1 more error)" });
  });

  it("falls back to the raw message", () => {
    expect(compileError("clang++: error: unknown argument\n")).toEqual({ kind: "compile", message: "clang++: error: unknown argument" });
    expect(compileError("")).toEqual({ kind: "compile", message: "Compile failed." });
  });
});
