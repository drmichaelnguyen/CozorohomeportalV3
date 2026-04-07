"use client";

import { useState } from "react";

type InlineHelpProps = {
  label: string;
  title?: string;
  body: string;
  className?: string;
  panelClassName?: string;
};

export function InlineHelp({ label, title, body, className = "", panelClassName = "" }: InlineHelpProps) {
  const [open, setOpen] = useState(false);

  return (
    <span className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50"
        aria-label={label}
        title={label}
      >
        ?
      </button>
      {open ? (
        <span className={`absolute right-0 top-8 z-20 w-72 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-xl ${panelClassName}`}>
          {title ? <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</span> : null}
          <span className="mt-1 block text-xs leading-5 text-slate-700 whitespace-pre-line">{body}</span>
        </span>
      ) : null}
    </span>
  );
}
