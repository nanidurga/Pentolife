"use client";

import { useId } from "react";
import { DEFAULT_FILTERS, type Filters, hasActiveFilters, type Sort, SORTS } from "@/lib/dashboard/filter";
import type { TagOption } from "@/lib/dashboard/tags";

const SORT_LABELS: Record<Sort, string> = { newest: "Newest", oldest: "Oldest", edited: "Recently edited", name: "Name A–Z" };

type FilterBarProps = { filters: Filters; roles: TagOption[]; companies: TagOption[]; onChange: (next: Filters) => void };

export default function FilterBar({ filters, roles, companies, onChange }: FilterBarProps) {
  const sortId = useId();
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return <div className="filter-bar" role="group" aria-label="Filter boards">
    <div className="filter">
      <label htmlFor={sortId}>Sort</label>
      <select id={sortId} value={filters.sort} onChange={(event) => set({ sort: event.target.value as Sort })}>
        {SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABELS[sort]}</option>)}
      </select>
    </div>
    <DateFilter label="From" value={filters.from} onChange={(from) => set({ from })} />
    <DateFilter label="To" value={filters.to} onChange={(to) => set({ to })} />
    <TagFilter label="Role" anyLabel="Any role" value={filters.role} options={roles} onChange={(role) => set({ role })} />
    <TagFilter label="Company" anyLabel="Any company" value={filters.company} options={companies} onChange={(company) => set({ company })} />
    {hasActiveFilters(filters) && <button type="button" className="clear-filters" onClick={() => onChange({ ...DEFAULT_FILTERS, sort: filters.sort })}>Clear</button>}
  </div>;
}

function RemoveFilter({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="filter-remove" aria-label={`Remove ${label.toLowerCase()} filter`} onClick={onClick}>×</button>;
}

function DateFilter({ label, value, onChange }: { label: string; value: string | null; onChange: (value: string | null) => void }) {
  const id = useId();
  return <div className={`filter${value ? " on" : ""}`}>
    <label htmlFor={id}>{label}</label>
    <div className="filter-control">
      <input id={id} type="date" value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} />
      {value && <RemoveFilter label={`${label} date`} onClick={() => onChange(null)} />}
    </div>
  </div>;
}

type TagFilterProps = { label: string; anyLabel: string; value: string | null; options: TagOption[]; onChange: (value: string | null) => void };

function TagFilter({ label, anyLabel, value, options, onChange }: TagFilterProps) {
  const id = useId();
  // A key from an old link may match no board any more; keep it visible so the empty result makes sense.
  const missing = value !== null && !options.some((option) => option.key === value);
  return <div className={`filter${value ? " on" : ""}`}>
    <label htmlFor={id}>{label}</label>
    <div className="filter-control">
      <select id={id} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">{anyLabel}</option>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label} ({option.count})</option>)}
        {missing && value && <option value={value}>{value}</option>}
      </select>
      {value && <RemoveFilter label={label} onClick={() => onChange(null)} />}
    </div>
  </div>;
}
