import { getT, type Lang } from "@/lib/i18n";

// Public yes/no stance split for a community-notes list — same bar the
// resolver sees in the review stack, now shown to everyone above the notes.
export function NoteStanceBar({ notes, lang }: { notes: { stance?: string | null }[]; lang?: Lang }) {
  const t = getT(lang ?? "cs");
  const yes = notes.filter((n) => n.stance === "yes").length;
  const no = notes.filter((n) => n.stance === "no").length;
  const neutral = notes.length - yes - no;
  if (yes + no === 0) return null;
  return (
    <div className="flex items-center gap-2.5 text-[11.5px] font-bold mb-2">
      <span className="text-yes-strong shrink-0">{yes} {t.yes}</span>
      <div className="h-2 flex-1 rounded-full bg-surface-3 overflow-hidden flex">
        {yes > 0 && <div className="bg-yes" style={{ width: `${(yes / notes.length) * 100}%` }} />}
        {neutral > 0 && <div className="bg-line-2" style={{ width: `${(neutral / notes.length) * 100}%` }} />}
        {no > 0 && <div className="bg-no" style={{ width: `${(no / notes.length) * 100}%` }} />}
      </div>
      <span className="text-no-strong shrink-0">{no} {t.no}</span>
      {neutral > 0 && <span className="text-faint font-medium shrink-0">{neutral} —</span>}
    </div>
  );
}
