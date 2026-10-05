"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import StatusBar from "@/components/StatusBar";
import Timeline from "@/components/viz/Timeline";
import TraceView from "@/components/viz/TraceView";
import type { PresenceCounts } from "@/lib/realtime/presence";
import type { ConnectionStatus } from "@/lib/realtime/roomChannel";
import { makeCapability, roomQuery } from "@/lib/room";
import { joinRoom } from "@/lib/rooms/api";
import { createJoinRetry, type JoinRetry } from "@/lib/rooms/joinRetry";
import { ensureAnonymousSession } from "@/lib/supabase";
import { SYNC_REPLY_MIN_GAP_MS } from "@/lib/sync/messages";
import { createFlusher } from "@/lib/sync/throttle";
import { defaultDrafts, readVizBackup, writeVizBackup, type Drafts } from "@/lib/viz/backup";
import { openVizConnection, type VizConnection } from "@/lib/viz/channel";
import type { StepPayload } from "@/lib/viz/messages";
import { VIZ_COPY } from "@/lib/viz/copy";
import { LIMITS, type Language } from "@/lib/viz/engines";
import { createRunner, type RunPhase, type Runner } from "@/lib/viz/runner";
import { TEMPLATES } from "@/lib/viz/templates";
import type { Trace } from "@/lib/viz/trace";
import { cppWorker, pythonWorker } from "@/lib/viz/workers";

const CodeEditor = dynamic(() => import("@/components/viz/CodeEditor"), { ssr: false, loading: () => <div className="code-loading">Loading editor…</div> });

type VisualizerProps = { roomId: string; role: "editor" | "viewer"; token: string; viewerToken: string; local: boolean };
type Run = { runId: string; trace: Trace };

const CODE_SEND_MS = 300;
const STEP_SEND_MS = 100;
const REMOTE_EDIT_GRACE_MS = 2000;
const NO_EDITOR_AFTER_MS = 3000;
const BACKUP_MS = 1000;
const PLAY_BASE_MS = 700;
const LANGUAGES: { id: Language; label: string }[] = [{ id: "python", label: "Python" }, { id: "cpp", label: "C++" }];

const storage = () => { try { return window.localStorage; } catch { return null; } };

function statusLine(phase: RunPhase | null, language: Language, failure: string | null, trace: Trace | undefined) {
  if (phase === "loading") return { text: VIZ_COPY.loading[language], error: false };
  if (phase === "compiling") return { text: VIZ_COPY.compiling, error: false };
  if (phase === "running") return { text: VIZ_COPY.running, error: false };
  if (failure) return { text: failure, error: true };
  if (!trace) return null;
  if (trace.error) return { text: trace.error.message, error: true };
  if (trace.notice) return { text: trace.notice, error: false };
  if (trace.stopped === "steps") return { text: VIZ_COPY.stoppedSteps, error: false };
  if (trace.stopped === "time") return { text: VIZ_COPY.stoppedTime, error: false };
  if (trace.stopped === "size") return { text: VIZ_COPY.stoppedSize(trace.steps.length), error: false };
  return null;
}

export default function Visualizer({ roomId, role, token, viewerToken, local }: VisualizerProps) {
  const editor = role === "editor";
  const clientId = useMemo(() => makeCapability(), []);
  const query = useMemo(() => roomQuery({ role, token, viewerToken, local }), [role, token, viewerToken, local]);
  const [language, setLanguage] = useState<Language>("python");
  const [drafts, setDrafts] = useState<Drafts>(defaultDrafts);
  const [cursorLine, setCursorLine] = useState(1);
  const [run, setRun] = useState<Run | null>(null);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [phase, setPhase] = useState<RunPhase | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | "local">(local ? "local" : "connecting");
  const [presence, setPresence] = useState<PresenceCounts>({ editors: 0, viewers: 0 });
  const [linkError, setLinkError] = useState(false);
  const [heardEditor, setHeardEditor] = useState(false);
  const [noEditor, setNoEditor] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null);
  const [restored, setRestored] = useState(!editor);

  const connection = useRef<VizConnection | null>(null);
  const runners = useRef<Partial<Record<Language, Runner>>>({});
  const latest = useRef({ language, drafts, cursorLine, run, step, playing });
  latest.current = { language, drafts, cursorLine, run, step, playing };
  const rev = useRef(0);
  const lastKeystroke = useRef(0);
  const remoteRevs = useRef(new Map<string, number>());
  const driving = useRef(false);
  // Realtime can deliver a step before the last chunk of its trace; hold it until that trace arrives.
  const earlyStep = useRef<StepPayload | null>(null);
  const codeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heardRef = useRef(heardEditor);
  heardRef.current = heardEditor;

  const sendCodeNow = () => {
    const { language: lang, drafts: d, cursorLine: line } = latest.current;
    rev.current += 1;
    connection.current?.sendCode({ language: lang, code: d[lang].code, stdin: d[lang].stdin, cursorLine: line, rev: rev.current });
  };
  const scheduleCode = () => {
    if (!editor || codeTimer.current) return;
    codeTimer.current = setTimeout(() => { codeTimer.current = null; sendCodeNow(); }, CODE_SEND_MS);
  };
  const scheduleStep = () => {
    if (!editor || stepTimer.current) return;
    stepTimer.current = setTimeout(() => {
      stepTimer.current = null;
      const { run: r, step: s, playing: p } = latest.current;
      if (r) connection.current?.sendStep({ runId: r.runId, step: s, playing: p });
    }, STEP_SEND_MS);
  };

  // Restore this room's code on the editor's device.
  useEffect(() => {
    if (!editor) return;
    const backup = readVizBackup(storage(), roomId);
    if (backup) { setLanguage(backup.language); setDrafts(backup.drafts); }
    setRestored(true);
  }, [editor, roomId]);

  useEffect(() => {
    if (!editor || !restored) return;
    const timer = setTimeout(() => writeVizBackup(storage(), roomId, { language, drafts }), BACKUP_MS);
    return () => clearTimeout(timer);
  }, [drafts, editor, language, restored, roomId]);

  // Join the room, then follow the viz topic.
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    let joinRetry: JoinRetry | null = null;
    let open: VizConnection | null = null;
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    // At most one catch-up reply per gap, but a request inside the gap is answered when it ends, never dropped:
    // a viewer that reloads quickly would otherwise wait forever.
    const syncReply = createFlusher({
      intervalMs: SYNC_REPLY_MIN_GAP_MS,
      flush: () => {
        sendCodeNow();
        const { run: r, step: s, playing: p } = latest.current;
        if (r) void open?.sendTrace(r.runId, r.trace).then(() => open?.sendStep({ runId: r.runId, step: s, playing: p }));
      },
    });

    async function start() {
      const supabase = await ensureAnonymousSession().catch(() => null);
      if (cancelled) return;
      if (!supabase) { setStatus("offline"); return; }
      joinRetry = createJoinRetry({
        join: () => joinRoom(supabase, { roomId, token, role }),
        onInvalid: () => setLinkError(true),
        onOffline: () => setStatus("offline"),
        onJoined: () => {
          open = openVizConnection(supabase, { roomId, clientId, role }, {
            onCode: (payload) => {
              if (editor && Date.now() - lastKeystroke.current < REMOTE_EDIT_GRACE_MS) return;
              if ((remoteRevs.current.get(payload.from) ?? -1) >= payload.rev) return;
              remoteRevs.current.set(payload.from, payload.rev);
              setHeardEditor(true);
              setNoEditor(false);
              setLanguage(payload.language);
              setDrafts((d) => ({ ...d, [payload.language]: { code: payload.code, stdin: payload.stdin } }));
              setCursorLine(payload.cursorLine);
            },
            onTrace: (runId, trace) => {
              setHeardEditor(true);
              setNoEditor(false);
              driving.current = false;
              const early = earlyStep.current?.runId === runId ? earlyStep.current : null;
              earlyStep.current = null;
              const start = early ? Math.min(early.step, Math.max(0, trace.steps.length - 1)) : 0;
              // A later viz-step can arrive before React re-renders; let onStep see this run now.
              latest.current = { ...latest.current, run: { runId, trace }, step: start };
              setRun({ runId, trace });
              setStep(start);
              setPlaying(early?.playing ?? false);
            },
            onStep: (payload) => {
              if (latest.current.run?.runId !== payload.runId) { earlyStep.current = payload; return; }
              driving.current = false;
              setStep(Math.min(payload.step, Math.max(0, latest.current.run.trace.steps.length - 1)));
              setPlaying(payload.playing);
            },
            onSyncRequest: () => { if (editor) syncReply.schedule(); },
            onStatus: setStatus,
            onPresence: setPresence,
            onSubscribed: () => {
              if (editor) { sendCodeNow(); return; }
              open?.requestSync();
              waitTimer = setTimeout(() => setNoEditor((none) => none || !heardRef.current), NO_EDITOR_AFTER_MS);
            },
          });
          connection.current = open;
        },
      });
      joinRetry.start();
    }

    const onOnline = () => joinRetry?.retryNow();
    window.addEventListener("online", onOnline);
    void start();
    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      if (waitTimer) clearTimeout(waitTimer);
      syncReply.cancel();
      joinRetry?.dispose();
      open?.close();
      connection.current = null;
    };
    // The handlers read live state through refs; reconnect only when access changes.
  }, [clientId, editor, local, role, roomId, token]);

  // Playback runs only on the editor who pressed play; everyone else follows viz-step.
  useEffect(() => {
    if (!playing || !driving.current || !run) return;
    const timer = setInterval(() => {
      const { step: s, run: r } = latest.current;
      if (!r || s >= r.trace.steps.length - 1) {
        setPlaying(false);
        driving.current = false;
        scheduleStep();
        return;
      }
      setStep(s + 1);
      scheduleStep();
    }, PLAY_BASE_MS / speed);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, run, speed]);

  useEffect(() => () => { Object.values(runners.current).forEach((r) => r?.dispose()); }, []);

  const changeStep = (next: number) => {
    if (!editor || !run) return;
    setStep(Math.max(0, Math.min(next, run.trace.steps.length - 1)));
    scheduleStep();
  };
  const changePlaying = (next: boolean) => {
    if (!editor || !run) return;
    driving.current = next;
    if (next && step >= run.trace.steps.length - 1) setStep(0);
    setPlaying(next);
    scheduleStep();
  };

  const onEditorChange = (code: string, line: number) => {
    if (!editor) return;
    lastKeystroke.current = Date.now();
    setDrafts((d) => (d[language].code === code ? d : { ...d, [language]: { ...d[language], code } }));
    setCursorLine(line);
    scheduleCode();
  };

  const changeLanguage = (next: Language) => {
    if (!editor || next === language || phase) return;
    setLanguage(next);
    setRun(null);
    setFailure(null);
    setPlaying(false);
    lastKeystroke.current = Date.now();
    scheduleCode();
  };

  const applyTemplate = (id: string) => {
    const template = TEMPLATES[language].find((t) => t.id === id);
    if (!template) return;
    setPendingTemplate(null);
    setDrafts((d) => ({ ...d, [language]: { code: template.code, stdin: template.stdin ?? "" } }));
    setRun(null);
    lastKeystroke.current = Date.now();
    scheduleCode();
  };
  const chooseTemplate = (id: string) => {
    const code = drafts[language].code.trim();
    const isTemplate = TEMPLATES[language].some((t) => t.code.trim() === code);
    if (code && !isTemplate) setPendingTemplate(id);
    else applyTemplate(id);
  };

  const runCode = async () => {
    if (!editor || phase) return;
    const lang = language;
    const { code, stdin } = drafts[lang];
    setFailure(null);
    setPlaying(false);
    driving.current = false;
    const runner = (runners.current[lang] ??= createRunner(lang, lang === "python" ? pythonWorker : cppWorker));
    setPhase("loading");
    const result = await runner.run({ code, stdin }, setPhase);
    setPhase(null);
    if (!result.ok) { setFailure(result.message); return; }
    const runId = makeCapability();
    setRun({ runId, trace: result.trace });
    setStep(0);
    const open = connection.current;
    if (open) void open.sendTrace(runId, result.trace).then(() => open.sendStep({ runId, step: 0, playing: false }));
  };

  if (linkError) {
    return <main className="link-error paper">
      <section className="auth-card">
        <h1>This board link is invalid or expired</h1>
        <p className="muted">Ask for a fresh link, or create a new board.</p>
        <Link className="primary" href="/">Go home</Link>
      </section>
    </main>;
  }

  const trace = run?.trace;
  const current = trace?.steps[step];
  const line = statusLine(phase, language, failure, trace);
  const draft = drafts[language];
  const traceMatchesLanguage = trace?.language === language;

  return <main className="viz-page">
    <StatusBar role={role} status={status} presence={presence} saveState={null} views={{ roomId, query, current: "viz" }} />
    <div className="viz">
      <section className="viz-code" aria-label="Code">
        <div className="viz-toolbar">
          <div className="lang-switch" role="group" aria-label="Language">
            {LANGUAGES.map((l) => <button key={l.id} className={language === l.id ? "on" : undefined} aria-pressed={language === l.id}
              disabled={!editor} onClick={() => changeLanguage(l.id)}>{l.label}</button>)}
          </div>
          {editor && <select aria-label="Templates" value="" onChange={(event) => chooseTemplate(event.target.value)}>
            <option value="">Templates</option>
            {TEMPLATES[language].map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>}
          <span className="spacer" />
          {editor && <button className="primary" onClick={() => void runCode()} disabled={!!phase}>{phase ? VIZ_COPY.running : "▶ Run"}</button>}
        </div>
        {pendingTemplate ? <div className="viz-banner" role="alert">
          <span>{VIZ_COPY.replaceCode(TEMPLATES[language].find((t) => t.id === pendingTemplate)?.name ?? "")}</span>
          <button className="primary" onClick={() => applyTemplate(pendingTemplate)}>Replace</button>
          <button className="button" onClick={() => setPendingTemplate(null)}>Cancel</button>
        </div> : <div />}
        <CodeEditor value={draft.code} language={language} readOnly={!editor} onChange={onEditorChange}
          currentLine={traceMatchesLanguage ? current?.line ?? null : null}
          errorLine={traceMatchesLanguage ? trace?.error?.line ?? null : null}
          followLine={editor ? null : cursorLine} />
        <details className="viz-stdin">
          <summary>Input (stdin)</summary>
          <textarea aria-label="Program input" value={draft.stdin} readOnly={!editor} maxLength={LIMITS.maxStdinChars}
            onChange={(event) => {
              const stdin = event.target.value;
              lastKeystroke.current = Date.now();
              setDrafts((d) => ({ ...d, [language]: { ...d[language], stdin } }));
              scheduleCode();
            }} />
        </details>
        <p className={`viz-status${line?.error ? " error" : ""}`} role="status">{line?.text ?? ""}</p>
      </section>
      <section className="viz-trace" aria-label="Visualization">
        {trace ? <TraceView trace={trace} step={step} />
          : <div className="viz-empty">{editor ? VIZ_COPY.emptyEditor : noEditor ? VIZ_COPY.noEditor : VIZ_COPY.waitingRun}</div>}
      </section>
    </div>
    <Timeline count={trace?.steps.length ?? 0} step={step} playing={playing} speed={speed} readOnly={!editor}
      onStep={changeStep} onPlay={changePlaying} onSpeed={setSpeed} />
  </main>;
}
