"use client";

// Family-quest player panels â€” claim a real-life task, attach a note (or a
// compressed proof photo for the bigger deeds), and follow the parent's
// review. Rewards are fixed, paid through the ledger only on approval.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, Badge, Card, Textarea } from "@/components/ui/primitives";
import { questClaimStart, type QuestView } from "@/lib/actions-fun";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { Loader2, ScrollText, Camera, CheckCircle2, Hourglass, XCircle } from "lucide-react";

const MAX_UPLOAD_EDGE = 1000; // px â€” client-side downscale before upload
const UPLOAD_QUALITY = 0.72; // JPEG quality â€” keeps proofs small but legible

// Read an image file and compress it to a small JPEG data URL. Family-scale
// photos land around 100â€“250 KB, well within the server-action body limit.
export async function compressToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_UPLOAD_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("cannot compress");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", UPLOAD_QUALITY);
}

export function QuestPanel({ lang, quests }: { lang: Lang; quests: QuestView[] }) {
  const t = getT(lang);
  const router = useRouter();
  const [claiming, start] = useTransition();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const claim = (id: string) => {
    setBusy(id);
    start(async () => {
      const res = await questClaimStart(id, notes[id] ?? "", photos[id]);
      setBusy(null);
      if (!res.ok) toast.error(res.error ?? "Error");
      else {
        toast.success(t.questClaimed);
        setNotes((m) => ({ ...m, [id]: "" }));
        setPhotos((m) => ({ ...m, [id]: "" }));
        router.refresh();
      }
    });
  };

  const pickPhoto = async (id: string, file?: File | null) => {
    if (!file) return;
    try {
      const dataUrl = await compressToDataUrl(file);
      setPhotos((m) => ({ ...m, [id]: dataUrl }));
      toast.success(t.questPhotoReady);
    } catch {
      toast.error(t.questPhotoFail);
    }
  };

  if (quests.length === 0) {
    return <p className="text-[13.5px] text-mute">{t.questNone}</p>;
  }

  return (
    <div className="grid gap-4">
      {quests.map((q) => {
        const canSubmit = !claiming && (q.proofKind !== "photo" || (photos[q.id] ?? "").startsWith("data:image/")) && !(q.proofKind === "text" && !(notes[q.id] ?? "").trim());
        return (
          <Card key={q.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-[15px] flex items-center gap-2">
                  <ScrollText className="size-4 text-brand" /> {q.title}
                </h2>
                {q.desc && <p className="text-[12.5px] text-mute mt-1">{q.desc}</p>}
              </div>
              <Badge tone={q.claimStatus === "approved" ? "yes" : "mute"}>{fmtMonos(q.rewardCents, { lang })}</Badge>
            </div>

            {/* my claim status */}
            {q.claimStatus && (
              <div className="mt-3 flex items-center gap-2 text-[12.5px] rounded-xl bg-surface-2 px-3 py-2.5">
                {q.claimStatus === "pending" && (
                  <>
                    <Hourglass className="size-4 text-brand" /> <span className="font-semibold">{t.questPending}</span>
                  </>
                )}
                {q.claimStatus === "approved" && (
                  <>
                    <CheckCircle2 className="size-4 text-yes" />
                    <span className="font-semibold">{t.questApproved}</span> <span className="text-brand font-semibold">+{fmtMonos(q.myRewardCents, { lang })}</span>
                  </>
                )}
                {q.claimStatus === "rejected" && (
                  <>
                    <XCircle className="size-4 text-no" />
                    <span className="font-semibold">{t.questRejected}</span>
                  </>
                )}
                {q.myNote && <span className="text-faint">Â· â€ž{q.myNote}â€ť</span>}
              </div>
            )}

            {/* claim / re-submit area */}
            {(!q.claimStatus || q.claimStatus === "rejected") && (
              <div className="mt-3 grid gap-3">
                {q.proofAsk && (
                  <p className="text-[12px] text-faint flex items-center gap-1.5">
                    <Camera className="size-3.5" /> {q.proofAsk}
                  </p>
                )}
                {q.proofKind !== "photo" && (
                  <Textarea
                    value={notes[q.id] ?? ""}
                    onChange={(e) => setNotes((m) => ({ ...m, [q.id]: e.target.value }))}
                    placeholder={t.questNotePh}
                    rows={2}
                  />
                )}
                {q.proofKind === "photo" && (
                  <div className="flex items-center gap-3">
                    <input
                      ref={(el) => {
                        fileRefs.current[q.id] = el;
                      }}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => pickPhoto(q.id, e.target.files?.[0])}
                    />
                    <Button variant="soft" size="sm" onClick={() => fileRefs.current[q.id]?.click()}>
                      <Camera className="size-4" /> {t.questPhotoCta}
                    </Button>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {(photos[q.id] ?? "").startsWith("data:image/") && <img src={photos[q.id]} alt="" className="h-14 w-14 rounded-lg object-cover border border-line-2" />}
                  </div>
                )}
                <div>
                  <Button onClick={() => claim(q.id)} disabled={!canSubmit}>
                    {busy === q.id && <Loader2 className="size-4 animate-spin" />} {q.claimStatus === "rejected" ? t.questResubmit : t.questClaimCta}
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
