type TimelineProps = {
  count: number;
  step: number;
  playing: boolean;
  speed: number;
  readOnly: boolean;
  onStep: (step: number) => void;
  onPlay: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
};

const SPEEDS = [0.5, 1, 2];

export default function Timeline({ count, step, playing, speed, readOnly, onStep, onPlay, onSpeed }: TimelineProps) {
  const last = Math.max(0, count - 1);
  const disabled = readOnly || count === 0;
  return <footer className="timeline" aria-label="Step through the run">
    <div className="timeline-buttons">
      <button className="icon-button" aria-label="First step" disabled={disabled || step === 0} onClick={() => onStep(0)}>⏮</button>
      <button className="icon-button" aria-label="Previous step" disabled={disabled || step === 0} onClick={() => onStep(step - 1)}>◀</button>
      <button className="primary play" aria-label={playing ? "Pause" : "Play"} disabled={disabled} onClick={() => onPlay(!playing)}>{playing ? "❚❚" : "▶"}</button>
      <button className="icon-button" aria-label="Next step" disabled={disabled || step >= last} onClick={() => onStep(step + 1)}>▶</button>
      <button className="icon-button" aria-label="Last step" disabled={disabled || step >= last} onClick={() => onStep(last)}>⏭</button>
    </div>
    <input className="timeline-track" type="range" min={0} max={last} value={Math.min(step, last)} disabled={disabled} aria-label="Step"
      onChange={(event) => onStep(Number(event.target.value))} />
    <span className="mono step-count">{count === 0 ? "no steps" : `step ${step + 1} / ${count}`}</span>
    <label className="speed"><span className="visually-hidden">Speed</span>
      <select value={speed} disabled={readOnly} onChange={(event) => onSpeed(Number(event.target.value))}>
        {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
      </select>
    </label>
  </footer>;
}
