import path from "node:path";
import { Language, Parser } from "web-tree-sitter";

let parser: Promise<Parser> | null = null;

export function cppParser() {
  parser ??= (async () => {
    await Parser.init();
    const instance = new Parser();
    instance.setLanguage(await Language.load(path.join(process.cwd(), "node_modules/tree-sitter-cpp/tree-sitter-cpp.wasm")));
    return instance;
  })();
  return parser;
}
