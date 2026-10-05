"use client";

import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { Annotation, Compartment, EditorState, StateEffect, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import { LIMITS, type Language } from "@/lib/viz/engines";

type Marks = { current: number | null; error: number | null };
type CodeEditorProps = {
  value: string;
  language: Language;
  readOnly: boolean;
  currentLine?: number | null;
  errorLine?: number | null;
  /** Viewers scroll to the line the editor is typing on. */
  followLine?: number | null;
  onChange?: (code: string, cursorLine: number) => void;
};

const remote = Annotation.define<boolean>();
const setMarks = StateEffect.define<Marks>();

function buildMarks(doc: Text, marks: Marks): DecorationSet {
  const ranges = [];
  if (marks.error && marks.error <= doc.lines) ranges.push(Decoration.line({ class: "cm-pl-error" }).range(doc.line(marks.error).from));
  if (marks.current && marks.current <= doc.lines) ranges.push(Decoration.line({ class: "cm-pl-current" }).range(doc.line(marks.current).from));
  return Decoration.set(ranges, true);
}

const marksField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    let next = marks.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setMarks)) next = buildMarks(tr.state.doc, effect.value);
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const languageOf = (language: Language) => (language === "python" ? python() : cpp());
const readOnlyOf = (readOnly: boolean) => [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
const maxLength = EditorState.changeFilter.of((tr) => tr.newDoc.length <= LIMITS.maxCodeChars);

export default function CodeEditor({ value, language, readOnly, currentLine, errorLine, followLine, onChange }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const readOnlySlot = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const initial = useRef({ value, language, readOnly });

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          basicSetup,
          maxLength,
          languageSlot.current.of(languageOf(initial.current.language)),
          readOnlySlot.current.of(readOnlyOf(initial.current.readOnly)),
          marksField,
          EditorView.updateListener.of((update) => {
            if (!update.docChanged && !update.selectionSet) return;
            if (update.transactions.some((tr) => tr.annotation(remote))) return;
            const state = update.state;
            onChangeRef.current?.(state.doc.toString(), state.doc.lineAt(state.selection.main.head).number);
          }),
        ],
      }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current !== value) editor.dispatch({ changes: { from: 0, to: current.length, insert: value }, annotations: remote.of(true) });
  }, [value]);

  useEffect(() => { view.current?.dispatch({ effects: languageSlot.current.reconfigure(languageOf(language)) }); }, [language]);
  useEffect(() => { view.current?.dispatch({ effects: readOnlySlot.current.reconfigure(readOnlyOf(readOnly)) }); }, [readOnly]);
  useEffect(() => { view.current?.dispatch({ effects: setMarks.of({ current: currentLine ?? null, error: errorLine ?? null }) }); }, [currentLine, errorLine, value]);

  useEffect(() => {
    const editor = view.current;
    const line = currentLine ?? followLine;
    if (!editor || !line || line > editor.state.doc.lines) return;
    editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.doc.line(line).from, { y: "nearest" }) });
  }, [currentLine, followLine]);

  return <div className="code-editor" ref={host} />;
}
