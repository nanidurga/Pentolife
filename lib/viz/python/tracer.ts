// Runs the user's code under sys.settrace and returns the trace as JSON (see lib/viz/trace.ts).
export const TRACER_SOURCE = String.raw`
import sys, io, json, time, types, collections

class _PlStop(BaseException):
    pass

_PL_SKIP = (types.FunctionType, types.BuiltinFunctionType, types.MethodType, types.ModuleType, type)
_PL_CONTAINERS = (list, tuple, dict, set, frozenset, collections.deque)

def __pl_run(code_text, stdin_text, max_steps, max_depth, max_items, max_str, max_stdout, max_seconds):
    steps = []
    out = io.StringIO()
    feed = io.StringIO(stdin_text)
    stopped = [None]
    deadline = time.monotonic() + max_seconds

    def item(x, depth, seen):
        s = ser(x, depth, seen)
        return s if s is not None else {"t": "unsupported", "type": type(x).__name__}

    def ser(v, depth, seen):
        if v is None:
            return {"t": "none"}
        if isinstance(v, bool):
            return {"t": "bool", "v": v}
        if isinstance(v, int):
            return {"t": "num", "v": v if -(2 ** 53) < v < 2 ** 53 else str(v)}
        if isinstance(v, float):
            return {"t": "num", "v": v if v == v and v not in (float("inf"), float("-inf")) else str(v)}
        if isinstance(v, str):
            r = {"t": "str", "v": v[:max_str]}
            if len(v) > max_str:
                r["cut"] = True
            return r
        if isinstance(v, _PL_SKIP):
            return None
        if hasattr(v, "__dict__") and not isinstance(v, _PL_CONTAINERS):
            oid = str(id(v))
            if oid in seen:
                return {"t": "ref", "id": oid}
            if len(seen) >= max_items:
                return {"t": "cut"}
            seen.add(oid)
            fields = {}
            for k, x in list(vars(v).items())[:max_items]:
                if k.startswith("__"):
                    continue
                s = ser(x, depth, seen)
                if s is not None:
                    fields[k] = s
            return {"t": "obj", "id": oid, "cls": type(v).__name__, "fields": fields}
        if depth >= max_depth:
            return {"t": "cut"}
        if isinstance(v, (list, tuple, collections.deque)):
            kind = "tuple" if isinstance(v, tuple) else "deque" if isinstance(v, collections.deque) else "list"
            values = list(v)
            r = {"t": "list", "kind": kind, "items": [item(x, depth + 1, seen) for x in values[:max_items]]}
            if len(values) > max_items:
                r["more"] = len(values) - max_items
            return r
        if isinstance(v, (set, frozenset)):
            values = list(v)
            try:
                values.sort()
            except TypeError:
                pass
            r = {"t": "set", "items": [item(x, depth + 1, seen) for x in values[:max_items]]}
            if len(values) > max_items:
                r["more"] = len(values) - max_items
            return r
        if isinstance(v, dict):
            entries = list(v.items())
            r = {"t": "map", "entries": [[item(k, depth + 1, seen), item(x, depth + 1, seen)] for k, x in entries[:max_items]]}
            if len(entries) > max_items:
                r["more"] = len(entries) - max_items
            return r
        return {"t": "unsupported", "type": type(v).__name__}

    def tracer(frame, event, arg):
        if frame.f_code.co_filename != "<user>":
            return None
        if event != "line":
            return tracer
        if len(steps) >= max_steps:
            stopped[0] = "steps"
            raise _PlStop()
        if time.monotonic() > deadline:
            stopped[0] = "time"
            raise _PlStop()
        chain = []
        f = frame
        while f is not None and f.f_code.co_filename == "<user>":
            chain.append(f)
            f = f.f_back
        chain.reverse()
        seen = set()
        stack = []
        for f in chain:
            local_vars = {}
            for name, value in list(f.f_locals.items()):
                if name.startswith("__"):
                    continue
                s = ser(value, 0, seen)
                if s is not None:
                    local_vars[name] = s
            fn = "main" if f.f_code.co_name == "<module>" else f.f_code.co_name
            stack.append({"fn": fn, "line": f.f_lineno, "locals": local_vars})
        steps.append({"line": frame.f_lineno, "stack": stack, "out": min(out.tell(), max_stdout)})
        return tracer

    def read_input(prompt=""):
        out.write(str(prompt))
        line = feed.readline()
        if not line:
            raise EOFError("EOF when reading a line")
        return line[:-1] if line.endswith("\n") else line

    try:
        code = compile(code_text, "<user>", "exec")
    except SyntaxError as e:
        error = {"message": f"{type(e).__name__}: {e.msg}", "kind": "compile"}
        if e.lineno:
            error["line"] = e.lineno
        return json.dumps({"language": "python", "steps": [], "stdout": "", "error": error})

    scope = {"__name__": "__main__", "input": read_input}
    error = None
    saved = (sys.stdout, sys.stderr, sys.stdin)
    sys.stdout, sys.stderr, sys.stdin = out, out, feed
    sys.settrace(tracer)
    try:
        exec(code, scope)
    except _PlStop:
        pass
    except SystemExit as e:
        if e.code not in (None, 0):
            error = {"message": f"SystemExit: {e.code}", "kind": "runtime"}
    except BaseException as e:
        error = {"message": f"{type(e).__name__}: {e}", "kind": "runtime"}
        tb = e.__traceback__
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == "<user>":
                error["line"] = tb.tb_lineno
            tb = tb.tb_next
    finally:
        sys.settrace(None)
        sys.stdout, sys.stderr, sys.stdin = saved
    result = {"language": "python", "steps": steps, "stdout": out.getvalue()[:max_stdout]}
    if error is not None:
        result["error"] = error
    if stopped[0]:
        result["stopped"] = stopped[0]
    return json.dumps(result)
`;
