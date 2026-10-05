import { CallStackView, OutputView, StructureView, VariablesView } from "@/components/viz/views";
import { VIZ_COPY } from "@/lib/viz/copy";
import { structuresOf } from "@/lib/viz/structures";
import { changedVariables, collectObjects, type Trace } from "@/lib/viz/trace";

export default function TraceView({ trace, step }: { trace: Trace; step: number }) {
  const current = trace.steps[step];
  if (!current) {
    return <div className="trace-view">
      <p className="muted">{VIZ_COPY.noSteps}</p>
      <OutputView text={trace.stdout} />
    </div>;
  }
  const frame = current.stack[current.stack.length - 1] ?? { fn: "main", line: current.line, locals: {} };
  const objects = collectObjects(current);
  const ctx = { language: trace.language, objects, locals: frame.locals, changed: changedVariables(trace.steps[step - 1], current) };
  const structures = structuresOf(frame.locals, objects);
  return <div className="trace-view">
    <section className="trace-data">
      {structures.length > 0
        ? structures.map((structure) => <StructureView key={structure.name} structure={structure} ctx={ctx} />)
        : <p className="muted small">No arrays, maps or linked structures in <span className="mono">{frame.fn}</span> at this step.</p>}
    </section>
    <div className="trace-side">
      <VariablesView frame={frame} ctx={ctx} />
      <CallStackView stack={current.stack} />
      <OutputView text={trace.stdout.slice(0, current.out)} />
    </div>
  </div>;
}
