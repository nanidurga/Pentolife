import type { Language } from "@/lib/viz/engines";
import { formatValue } from "@/lib/viz/format";
import { gridPointers, pointersFor, type Pointer } from "@/lib/viz/pointers";
import { nodeLabel, type Structure } from "@/lib/viz/structures";
import { resolveObj, type Frame, type ObjValue, type Value } from "@/lib/viz/trace";

type Ctx = { language: Language; objects: Map<string, ObjValue>; locals: Record<string, Value>; changed: Set<string> };

const labelsAt = (pointers: Pointer[], index: number) => pointers.filter((p) => p.index === index).map((p) => p.name).join(", ");

export function StructureView({ structure, ctx }: { structure: Structure; ctx: Ctx }) {
  const changed = ctx.changed.has(structure.name) ? " changed" : "";
  const caption = (detail: string) => <figcaption><strong>{structure.name}</strong> <span className="muted mono">{detail}</span></figcaption>;
  switch (structure.kind) {
    case "array": {
      const { items, more } = structure.value;
      const numbers = items.map((item) => (item.t === "num" ? Number(item.v) : NaN));
      const bars = items.length > 0 && numbers.every(Number.isFinite);
      const peak = Math.max(1, ...numbers.map((n) => Math.abs(n)).filter(Number.isFinite));
      const pointers = pointersFor(items.length + (more ?? 0), ctx.locals, structure.name);
      const end = pointers.filter((p) => p.end);
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.kind}[${items.length + (more ?? 0)}]`)}
        <div className={bars ? "arr arr-bars" : "arr arr-cells"}>
          {items.map((item, i) => {
            const label = labelsAt(pointers, i);
            return <div key={i} className={`arr-item${label ? " pointed" : ""}`}>
              {bars && <span className={`bar${numbers[i] < 0 ? " neg" : ""}`} style={{ height: `${Math.max(4, (Math.abs(numbers[i]) / peak) * 96)}px` }} />}
              <span className="cell">{formatValue(item, ctx.language, ctx.objects, 14)}</span>
              <span className="idx mono">{i}</span>
              <span className="ptr mono">{label}</span>
            </div>;
          })}
          {more ? <div className="arr-item more mono">+{more}</div> : null}
          {end.length > 0 && <div className="arr-item end"><span className="cell muted">end</span><span className="idx mono">{items.length}</span><span className="ptr mono">{end.map((p) => p.name).join(", ")}</span></div>}
        </div>
      </figure>;
    }
    case "grid": {
      const rows = structure.value.items.map((row) => (row.t === "list" ? row.items : []));
      const cols = Math.max(0, ...rows.map((r) => r.length));
      const { rows: rowPtrs, cols: colPtrs } = gridPointers(rows.length, cols, ctx.locals, structure.name);
      return <figure className={`viz-struct${changed}`}>
        {caption(`${rows.length}×${cols}`)}
        <div className="grid-wrap"><table className="grid">
          <thead><tr><th />{Array.from({ length: cols }, (_, c) => <th key={c} className="mono">{c}<span className="ptr">{labelsAt(colPtrs, c)}</span></th>)}</tr></thead>
          <tbody>{rows.map((row, r) => <tr key={r}>
            <th className="mono">{r}<span className="ptr">{labelsAt(rowPtrs, r)}</span></th>
            {row.map((cell, c) => {
              const hit = rowPtrs.some((p) => p.index === r) && colPtrs.some((p) => p.index === c);
              return <td key={c} className={hit ? "pointed" : undefined}>{formatValue(cell, ctx.language, ctx.objects, 8)}</td>;
            })}
          </tr>)}</tbody>
        </table></div>
      </figure>;
    }
    case "map":
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.entries.length + (structure.value.more ?? 0)} entries`)}
        <table className="map"><tbody>{structure.value.entries.map(([k, v], i) => <tr key={i}><th>{formatValue(k, ctx.language, ctx.objects, 24)}</th><td>{formatValue(v, ctx.language, ctx.objects, 40)}</td></tr>)}</tbody></table>
      </figure>;
    case "set":
      return <figure className={`viz-struct${changed}`}>
        {caption(`${structure.value.items.length + (structure.value.more ?? 0)} items`)}
        <div className="chips">{structure.value.items.map((item, i) => <span key={i} className="chip">{formatValue(item, ctx.language, ctx.objects, 20)}</span>)}</div>
      </figure>;
    case "linked":
      return <figure className={`viz-struct${changed}`}>
        {caption("linked list")}
        <div className="linked">{structure.nodes.map((node, i) => <div key={node.id} className="ll-node">
          <span className="ptr mono">{(structure.labels.get(node.id) ?? []).join(", ")}</span>
          <span className="ll-box">{nodeLabel(node, ctx.language)}</span>
          {i < structure.nodes.length - 1 && <span className="ll-arrow" aria-hidden="true">→</span>}
        </div>)}</div>
      </figure>;
    case "tree":
      return <figure className={`viz-struct${changed}`}>{caption("tree")}<div className="tree"><TreeNode node={structure.root} ctx={ctx} labels={structure.labels} seen={new Set()} /></div></figure>;
  }
}

function TreeNode({ node, ctx, labels, seen }: { node: ObjValue; ctx: Ctx; labels: Map<string, string[]>; seen: Set<string> }) {
  if (seen.has(node.id) || seen.size > 100) return <span className="tree-leaf muted">…</span>;
  seen.add(node.id);
  const children = (["left", "right"] as const).map((side) => resolveObj(node.fields[side], ctx.objects));
  return <div className="tree-node">
    <span className="ptr mono">{(labels.get(node.id) ?? []).join(", ")}</span>
    <span className="tree-box">{nodeLabel(node, ctx.language)}</span>
    {children.some(Boolean) && <div className="tree-children">{children.map((child, i) => <div key={i} className="tree-slot">{child ? <TreeNode node={child} ctx={ctx} labels={labels} seen={seen} /> : <span className="tree-leaf muted">·</span>}</div>)}</div>}
  </div>;
}

export function VariablesView({ frame, ctx }: { frame: Frame; ctx: Ctx }) {
  const names = Object.keys(frame.locals);
  return <section className="viz-panel">
    <h3>Variables</h3>
    {names.length === 0 ? <p className="muted small">None yet.</p> : <dl className="vars">{names.map((name) => <div key={name} className={ctx.changed.has(name) ? "changed" : undefined}>
      <dt className="mono">{name}</dt><dd className="mono">{formatValue(frame.locals[name], ctx.language, ctx.objects, 48)}</dd>
    </div>)}</dl>}
  </section>;
}

export function CallStackView({ stack }: { stack: Frame[] }) {
  return <section className="viz-panel">
    <h3>Call stack</h3>
    <ol className="stack">{[...stack].reverse().map((frame, i) => <li key={i} className={i === 0 ? "top" : undefined}><span className="mono">{frame.fn}</span> <span className="muted small">line {frame.line}</span></li>)}</ol>
  </section>;
}

export function OutputView({ text }: { text: string }) {
  return <section className="viz-panel">
    <h3>Output</h3>
    <pre className="output mono">{text || <span className="muted">No output yet.</span>}</pre>
  </section>;
}
