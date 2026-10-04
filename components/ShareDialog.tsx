"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

type ShareDialogProps = { editorUrl: string; viewerUrl: string; onClose: () => void };

export default function ShareDialog({ editorUrl, viewerUrl, onClose }: ShareDialogProps) {
  const [qr, setQr] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const linkInputRef = useRef<HTMLInputElement>(null);

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
    try {
      await navigator.clipboard.writeText(viewerUrl);
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
      if (linkInputRef.current) {
        linkInputRef.current.select();
      }
    }
  }

  const buttonLabel = copyStatus === "success" ? "Copied" : copyStatus === "error" ? "Couldn't copy — select the link and copy it" : "Copy viewer link";

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
        <input ref={linkInputRef} className="share-link" readOnly value={viewerUrl} onFocus={(event) => event.currentTarget.select()} />
        <button className="primary" onClick={copyViewer}>{buttonLabel}</button>
      </div>
      <button className="copy share-close" onClick={onClose}>Close</button>
    </section>
  </div>;
}
