"use client";

import { type KeyboardEvent, useId, useState } from "react";
import type { FieldMessage } from "@/components/auth/Field";
import { suggest, type Suggestion, type TagOption } from "@/lib/dashboard/tags";

type TagInputProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: TagOption[];
  placeholder?: string;
  message?: FieldMessage | null;
};

// A combobox, not <datalist>, so suggestions look and behave the same on iPad and Android.
export default function TagInput({ label, value, onChange, options, placeholder, message }: TagInputProps) {
  const id = useId();
  const listId = `${id}-list`;
  const messageId = `${id}-message`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const items = open ? suggest(options, value) : [];
  const showList = items.length > 0;
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function pick(item: Suggestion) {
    onChange(item.kind === "existing" ? item.option.label : item.label);
    close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (items.length === 0) return;
      const down = event.key === "ArrowDown";
      setActive((index) => (down ? (index + 1) % items.length : index <= 0 ? items.length - 1 : index - 1));
    } else if (event.key === "Enter" && showList && items[active]) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === "Escape" && showList) {
      // Close only the list; the dialog closes on the next Escape.
      event.stopPropagation();
      close();
    }
  }

  return <div className="field tag-input">
    <div className="field-label"><label htmlFor={id}>{label}</label></div>
    <input id={id} role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
      aria-describedby={message ? messageId : undefined} aria-invalid={message?.tone === "danger" || undefined}
      autoComplete="off" spellCheck={false} placeholder={placeholder} value={value}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onFocus={() => setOpen(true)} onBlur={close} onKeyDown={onKeyDown} />
    {showList && <ul id={listId} role="listbox" className="suggest">
      {items.map((item, index) => <li key={item.kind === "existing" ? item.option.key : "new"} id={optionId(index)} role="option"
        aria-selected={index === active} className={index === active ? "active" : undefined}
        // preventDefault keeps focus in the input, so a tap picks the row instead of blurring and closing the list.
        onMouseDown={(event) => event.preventDefault()} onClick={() => pick(item)}>
        {item.kind === "existing"
          ? <><span>{item.option.label}</span><em>{item.option.count} {item.option.count === 1 ? "board" : "boards"}</em></>
          : <><span>Use “{item.label}”</span><em>new</em></>}
      </li>)}
    </ul>}
    {message && <span id={messageId} className={`field-message ${message.tone}`} aria-live="polite">{message.text}</span>}
  </div>;
}
