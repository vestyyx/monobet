"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button, Input } from "@/components/ui/primitives";
import { createCategory } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";

// "+ New category…" — saves immediately on confirm, then hands the canonical
// name back so the caller can select it.
export function CategoryModal({
  open,
  onClose,
  onPicked,
  lang,
}: {
  open: boolean;
  onClose: () => void;
  onPicked: (name: string) => void;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const save = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    const r = await createCategory({ name: n });
    setBusy(false);
    if (!r.ok || !r.name) return toast.error(r.error ? t.serverErr(r.error) : t.catCreateFail);
    onPicked(r.name);
    setName("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-ink/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-line bg-surface shadow-2xl p-5 anim-rise"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[15px] font-bold">{t.newCatTitle}</h3>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t.addCategoryPh}
          maxLength={24}
          className="mt-3"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="mt-4 flex gap-2 justify-end">
          <Button size="sm" variant="outline" type="button" onClick={onClose}>
            {t.cancelEdit}
          </Button>
          <Button size="sm" type="button" disabled={busy || !name.trim()} onClick={save}>
            {t.addCategory}
          </Button>
        </div>
      </div>
    </div>
  );
}
