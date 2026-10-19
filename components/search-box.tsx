"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { getT, type Lang } from "@/lib/i18n";

export function SearchBox({ lang }: { lang?: Lang }) {
  const router = useRouter();
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const t = getT(lang ?? "cs");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = (form: HTMLFormElement) => {
    const input = form.querySelector("input")!;
    const sp = new URLSearchParams(params.toString());
    if (input.value.trim()) sp.set("q", input.value.trim());
    else sp.delete("q");
    setOpen(false);
    router.push(`/?${sp.toString()}`);
  };

  const inputCls =
    "h-9 w-full rounded-full border border-transparent bg-surface-2 pl-9 pr-3 text-sm text-ink placeholder:text-faint transition-all focus:bg-surface focus:border-brand/40 focus:ring-2 focus:ring-brand/20 focus:outline-none";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="sm:hidden grid size-8 place-items-center rounded-full bg-surface-2 text-faint hover:text-ink"
        aria-label={t.search}
      >
        <Search className="size-4" />
      </button>

      <form
        className="relative hidden sm:block"
        onSubmit={(e) => {
          e.preventDefault();
          submit(e.currentTarget);
        }}
      >
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
        <input key={q} defaultValue={q} placeholder={t.search} className={inputCls} />
      </form>

      {open && (
        <div className="sm:hidden fixed inset-x-0 top-0 z-50 flex items-center gap-2 bg-surface border-b border-edge px-3 h-14">
          <form
            className="relative flex-1 min-w-0"
            onSubmit={(e) => {
              e.preventDefault();
              submit(e.currentTarget);
            }}
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-faint pointer-events-none" />
            <input ref={inputRef} defaultValue={q} placeholder={t.search} className={inputCls} />
          </form>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid size-9 place-items-center rounded-full text-faint hover:text-ink shrink-0"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>
      )}
    </>
  );
}
