"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

type ShareDialogProps = { editorUrl: string; viewerUrl: string; onClose: () => void };

export default function ShareDialog({ editorUrl, viewerUrl, onClose }: ShareDialogProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(editorUrl, { margin: 1, width: 240 }).then((url) => { if (active) setQr(url); }, () => {});
    return () => { active = false; };
  }, [editorUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyViewer() {
    await navigator.clipboard.writeText(viewerUrl);
    setCopied(true);
  }

  return <div className="share-backdrop" onClick={onClose}>
    <section className="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title" onClick={(event) => event.stopPropagation()}>
      <h2 id="share-title">Share this whiteboard</h2>
      <div className="share-block">
        <strong>Open on your tablet</strong>
        {qr ? <img className="share-qr" src={qr} alt="QR code for the editor link" width={240} height={240} /> : <div className="share-qr" />}
        <p className="muted">Scan with your tablet — don&apos;t share this one. It lets anyone edit.</p>
      </div>
      <div className="share-block">
        <strong>Interviewer link (view only)</strong>
        <input className="share-link" readOnly value={viewerUrl} onFocus={(event) => event.currentTarget.select()} />
        <button className="primary" onClick={copyViewer}>{copied ? "Copied" : "Copy viewer link"}</button>
      </div>
      <button className="copy share-close" onClick={onClose}>Close</button>
    </section>
  </div>;
}
