"use client";

import { type FormEvent, type KeyboardEvent, useId, useMemo, useState } from "react";
import Field, { type FieldMessage } from "@/components/auth/Field";
import TagInput from "@/components/dashboard/TagInput";
import type { DashboardBoard } from "@/lib/dashboard/filter";
import { tagOptions } from "@/lib/dashboard/tags";
import type { DetailsError } from "@/lib/rooms/boards";
import { type BoardDetails, type DetailField, normalizeDetails } from "@/lib/rooms/details";

type BoardDetailsDialogProps = {
  mode: "create" | "edit";
  initial?: { title: string; role: string | null; company: string | null };
  boards: DashboardBoard[];
  onSubmit: (details: BoardDetails) => Promise<{ ok: true } | DetailsError>;
  onClose: () => void;
};

export default function BoardDetailsDialog({ mode, initial, boards, onSubmit, onClose }: BoardDetailsDialogProps) {
  const headingId = useId();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [role, setRole] = useState(initial?.role ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [fieldError, setFieldError] = useState<{ field: DetailField; message: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const roles = useMemo(() => tagOptions(boards, "role"), [boards]);
  const companies = useMemo(() => tagOptions(boards, "company"), [boards]);
  const creating = mode === "create";

  function dismiss() {
    if (!pending) onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const checked = normalizeDetails({ title, role, company });
    if (!checked.ok) {
      setFieldError({ field: checked.field, message: checked.message });
      return;
    }
    setPending(true);
    setFieldError(null);
    setFormError("");
    const result = await onSubmit(checked.details);
    // On success the parent navigates away (create) or closes this dialog (edit).
    if (result.ok) return;
    setPending(false);
    if (result.field) setFieldError({ field: result.field, message: result.message });
    else setFormError(result.message);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") dismiss();
  }

  const messageFor = (field: DetailField): FieldMessage | null =>
    fieldError?.field === field ? { text: fieldError.message, tone: "danger" } : null;
  const submitLabel = creating ? (pending ? "Creating…" : "Create board") : (pending ? "Saving…" : "Save changes");

  return <div className="dialog-backdrop" onClick={dismiss}>
    <section className="dialog details-dialog" role="dialog" aria-modal="true" aria-labelledby={headingId}
      onClick={(event) => event.stopPropagation()} onKeyDown={onKeyDown}>
      <h2 id={headingId}>{creating ? "New board" : "Edit details"}</h2>
      <form className="details-form" onSubmit={submit} noValidate>
        <Field label="Board name" name="title" autoComplete="off" placeholder="Untitled whiteboard" autoFocus
          value={title} onChange={(event) => setTitle(event.target.value)} message={messageFor("title")} />
        <div className="details-tags">
          <TagInput label="Role" value={role} onChange={setRole} options={roles} placeholder="e.g. Backend SDE II" message={messageFor("role")} />
          <TagInput label="Company" value={company} onChange={setCompany} options={companies} placeholder="e.g. Razorpay" message={messageFor("company")} />
        </div>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={dismiss} disabled={pending}>Cancel</button>
          <button type="submit" className="primary" disabled={pending}>{submitLabel}</button>
        </div>
      </form>
    </section>
  </div>;
}
