import { useId, type InputHTMLAttributes, type ReactNode } from "react";

export type FieldMessage = { text: string; tone: "muted" | "success" | "danger" };

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; message?: FieldMessage | null; aside?: ReactNode };

export default function Field({ label, message, aside, ...input }: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  return <div className="field">
    <div className="field-label"><label htmlFor={id}>{label}</label>{aside}</div>
    <input id={id} aria-describedby={message ? messageId : undefined} aria-invalid={message?.tone === "danger" || undefined} {...input} />
    {message && <span id={messageId} className={`field-message ${message.tone}`} aria-live="polite">{message.text}</span>}
  </div>;
}
