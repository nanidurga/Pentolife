import type { Node } from "web-tree-sitter";

type Insert = { at: number; text: string; close: boolean };

const LOOPS = new Set(["for_statement", "for_range_loop", "while_statement", "do_statement"]);
const NOT_A_STATEMENT = /^(comment|preproc_|case_statement$)/;

/** Rewrites C++ so each statement inside a function records a step. Never adds or removes lines. */
export function instrument(root: Node, source: string): string {
  const inserts: Insert[] = [];
  for (const fn of root.descendantsOfType("function_definition")) {
    if (!fn || insideLambda(fn) || isConstexpr(fn)) continue;
    const body = fn.childForFieldName("body");
    if (!body || body.type !== "compound_statement") continue;
    inserts.push({ at: body.startIndex + 1, text: ` __pl::FrameGuard __pl_g(${JSON.stringify(functionName(fn))}, ${fn.startPosition.row + 1});`, close: false });
    visit(body, fn, inserts);
  }
  return apply(source, inserts);
}

function visit(node: Node, fn: Node, inserts: Insert[]) {
  if (node.type === "lambda_expression" || (node.type === "function_definition" && node.id !== fn.id)) return;
  if (node.type === "compound_statement" || node.type === "case_statement") {
    const value = node.type === "case_statement" ? node.childForFieldName("value") : null;
    for (const child of node.namedChildren) {
      if (!child || NOT_A_STATEMENT.test(child.type) || (value && child.id === value.id)) continue;
      inserts.push({ at: child.startIndex, text: `${stepCall(child, fn)} `, close: false });
    }
  }
  for (const body of singleStatementBodies(node)) {
    inserts.push({ at: body.startIndex, text: `{ ${stepCall(body, fn)} `, close: false });
    inserts.push({ at: body.endIndex, text: " }", close: true });
  }
  for (const child of node.namedChildren) if (child) visit(child, fn, inserts);
}

function singleStatementBodies(node: Node): Node[] {
  const bodies: (Node | null)[] = [];
  if (node.type === "if_statement") {
    bodies.push(node.childForFieldName("consequence"));
    const alternative = node.childForFieldName("alternative");
    if (alternative) bodies.push(alternative.type === "else_clause" ? alternative.namedChildren[0] ?? null : alternative);
  } else if (LOOPS.has(node.type)) {
    bodies.push(node.childForFieldName("body"));
  }
  return bodies.filter((b): b is Node => !!b && b.type !== "compound_statement" && !NOT_A_STATEMENT.test(b.type));
}

function stepCall(statement: Node, fn: Node) {
  const vars = visibleVars(statement, fn).map((name) => `__pl_v.var("${name}", ${name});`).join(" ");
  return `__pl::step(${statement.startPosition.row + 1}, [&](__pl::Vars& __pl_v) { ${vars} });`;
}

function visibleVars(statement: Node, fn: Node): string[] {
  const found = new Map<string, number>();
  const add = (pairs: Array<[string, number]>) => { for (const [name, at] of pairs) if (!found.has(name)) found.set(name, at); };
  let child = statement;
  let node = statement.parent;
  while (node && node.id !== fn.id) {
    if (node.type === "compound_statement" || node.type === "case_statement") {
      for (const sibling of node.namedChildren) {
        if (!sibling || sibling.startIndex >= child.startIndex) break;
        if (sibling.type === "declaration") add(declaredNames(sibling));
      }
    } else if (node.type === "for_statement") {
      const init = node.childForFieldName("initializer");
      if (init && init.id !== child.id && init.type === "declaration") add(declaredNames(init));
    } else if (node.type === "for_range_loop") {
      const body = node.childForFieldName("body");
      const declarator = node.childForFieldName("declarator");
      if (body && declarator && body.id === child.id) add(declaratorNames(declarator));
    }
    child = node;
    node = node.parent;
  }
  add(parameterNames(fn));
  return [...found].sort((a, b) => a[1] - b[1]).map(([name]) => name);
}

function declaredNames(declaration: Node): Array<[string, number]> {
  return declaration.childrenForFieldName("declarator").flatMap((d) => {
    if (!d) return [];
    const target = d.type === "init_declarator" ? d.childForFieldName("declarator") : d;
    return target ? declaratorNames(target) : [];
  });
}

function declaratorNames(d: Node): Array<[string, number]> {
  switch (d.type) {
    case "identifier":
      return [[d.text, d.startIndex]];
    case "structured_binding_declarator":
      return d.namedChildren.filter((c): c is Node => c?.type === "identifier").map((c) => [c.text, c.startIndex]);
    case "array_declarator": {
      // A lambda cannot capture a variable-length array, so only fixed-size arrays are listed.
      const size = d.childForFieldName("size");
      if (size && size.type !== "number_literal") return [];
      const inner = d.childForFieldName("declarator");
      return inner ? declaratorNames(inner) : [];
    }
    case "pointer_declarator":
    case "reference_declarator":
    case "parenthesized_declarator": {
      const inner = d.childForFieldName("declarator") ?? d.namedChildren.find((c) => !!c && (c.type === "identifier" || c.type.endsWith("_declarator"))) ?? null;
      return inner ? declaratorNames(inner) : [];
    }
    default:
      return [];
  }
}

function functionDeclarator(fn: Node): Node | null {
  let d = fn.childForFieldName("declarator");
  while (d && d.type !== "function_declarator") d = d.childForFieldName("declarator") ?? d.namedChildren.find((c) => !!c && c.type.endsWith("declarator")) ?? null;
  return d;
}

function parameterNames(fn: Node): Array<[string, number]> {
  const params = functionDeclarator(fn)?.childForFieldName("parameters");
  if (!params) return [];
  return params.namedChildren.flatMap((p) => {
    const declarator = p?.childForFieldName("declarator");
    return declarator ? declaratorNames(declarator) : [];
  });
}

function functionName(fn: Node) {
  return functionDeclarator(fn)?.childForFieldName("declarator")?.text ?? "function";
}

function insideLambda(node: Node) {
  for (let p = node.parent; p; p = p.parent) if (p.type === "lambda_expression") return true;
  return false;
}

function isConstexpr(fn: Node) {
  return fn.children.some((c) => !!c && (c.text === "constexpr" || c.text === "consteval"));
}

function apply(source: string, inserts: Insert[]) {
  const ordered = inserts
    .map((insert, index) => ({ ...insert, index }))
    .sort((a, b) => a.at - b.at || Number(b.close) - Number(a.close) || a.index - b.index);
  let out = "";
  let last = 0;
  for (const insert of ordered) {
    out += source.slice(last, insert.at) + insert.text;
    last = insert.at;
  }
  return out + source.slice(last);
}
