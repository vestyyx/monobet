"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, CheckCircle2, AlertTriangle, Send, StickyNote, Trash2, Eye, EyeOff } from "lucide-react";
import { Button, Card, Input, Segmented, Avatar, Badge } from "@/components/ui/primitives";
import { proposeResolution, voteResolution, addCommunityNote, setNotePublished, deleteCommunityNote } from "@/lib/actions";
import { getT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type NoteView = {
  id: string;
  body: string;
  stance: string | null;
  published: boolean;
  userId: string;
  username: string | null;
  userImage: string | null;
};

// Community-resolution card — always present on live markets. Before a
// proposal it explains the flow; the resolver (creator/admin) can declare the
// outcome at any time, everyone else once the market closes. Two confirms
// settle it, disputes hand it to the admins.
//
// The same card hosts community notes: anyone signed in can argue for an
// outcome; the resolver sees every note here — before the propose controls —
// and can publish individual notes onto the page above the rules. Markets
// with 6+ notes are admin-resolve only (`noteGate` badge explains).
export function ResolutionPanel({
  marketId,
  proposedOutcome,
  reason,
  proposer,
  proposedById,
  viewerId,
  confirms,
  disputes,
  myVote,
  closed,
  isResolver,
  notes = [],
  noteGate = false,
  contextLabel,
  lang,
}: {
  marketId: string;
  proposedOutcome: string | null;
  reason: string;
  proposer: string | null;
  proposedById: string | null;
  viewerId: string | undefined;
  confirms: number;
  disputes: number;
  myVote: string | null;
  closed: boolean;
  isResolver: boolean;
  // All notes for resolvers (publish flags intact); empty for the public —
  // published ones render in their own card above the rules.
  notes?: NoteView[];
  noteGate?: boolean;
  // Option context on group markets, e.g. "1 - 2 roky".
  contextLabel?: string;
  lang?: Lang;
}) {
  const t = getT(lang ?? "cs");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [outcome, setOutcome] = useState<"yes" | "no">("yes");
  const [r, setR] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [noteStance, setNoteStance] = useState("none");

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        toast.success(ok);
        router.refresh();
      } else toast.error(t.serverErr(res.error));
    });

  const disputed = disputes > 0;
  const yesNotes = notes.filter((n) => n.stance === "yes").length;
  const noNotes = notes.filter((n) => n.stance === "no").length;
  const neutralNotes = notes.length - yesNotes - noNotes;
  const heading = (
    <h3 className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
      <Scale className="size-3.5 shrink-0" />
      <span className="truncate">
        {t.resolutionPoll}
        {contextLabel ? ` — ${contextLabel}` : ""}
      </span>
      {notes.length > 0 && (
        <Badge tone="mute" className="ml-auto shrink-0">
          <StickyNote className="size-3" /> {t.notesCount(notes.length)}
        </Badge>
      )}
    </h3>
  );

  // Note composer — every signed-in user argues their case; the resolver
  // reads these before settling. Stance marks which outcome the note backs.
  const composer = !!viewerId && (
    <div className="mt-3 border-t border-line-2 pt-3">
      <Input
        value={noteBody}
        onChange={(e) => setNoteBody(e.target.value)}
        placeholder={t.notePh}
        maxLength={500}
        className="text-[13px]"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <Segmented
          value={noteStance}
          onChange={setNoteStance}
          className="w-32 shrink-0 [&_button]:h-6 [&_button]:text-[11px]"
          options={[
            { value: "none", label: "—" },
            { value: "yes", label: t.yes, tone: "yes" },
            { value: "no", label: t.no, tone: "no" },
          ]}
        />
        <Button
          size="xs"
          variant="outline"
          className="ml-auto"
          disabled={pending || noteBody.trim().length < 10}
          onClick={() =>
            run(
              () =>
                addCommunityNote({
                  marketId,
                  body: noteBody,
                  stance: noteStance === "yes" || noteStance === "no" ? noteStance : undefined,
                }),
              t.noteAdded
            )
          }
        >
          <StickyNote className="size-3" /> {t.noteSubmit}
        </Button>
      </div>
    </div>
  );

  // Resolver's review stack — rendered above the proposal controls so the
  // resolver literally scrolls through community opinion first.
  const noteList = isResolver && (
    <div className="mt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
        {t.notesTitle} · {t.notesResolverHint}
      </p>
      {notes.length === 0 ? (
        <p className="text-[12px] text-faint mt-1.5">{t.notesEmpty}</p>
      ) : (
        <>
          <div className="mt-2 flex items-center gap-2.5 text-[11.5px] font-bold">
            <span className="text-yes-strong shrink-0">{yesNotes} {t.yes}</span>
            <div className="h-2 flex-1 rounded-full bg-surface-3 overflow-hidden flex">
              {yesNotes > 0 && <div className="bg-yes" style={{ width: `${(yesNotes / notes.length) * 100}%` }} />}
              {neutralNotes > 0 && <div className="bg-line-2" style={{ width: `${(neutralNotes / notes.length) * 100}%` }} />}
              {noNotes > 0 && <div className="bg-no" style={{ width: `${(noNotes / notes.length) * 100}%` }} />}
            </div>
            <span className="text-no-strong shrink-0">{noNotes} {t.no}</span>
            {neutralNotes > 0 && <span className="text-faint font-medium shrink-0">{neutralNotes} —</span>}
          </div>
          <div className="mt-2 space-y-2 max-h-64 overflow-y-auto">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg border border-line-2 bg-surface-2/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Avatar name={n.username ?? "?"} image={n.userImage} className="size-5" />
                <span className="text-[11.5px] font-semibold truncate">@{n.username ?? n.userId.slice(0, 8)}</span>
                {n.stance && (
                  <Badge tone={n.stance === "yes" ? "yes" : "no"}>{(n.stance === "yes" ? t.yes : t.no).toUpperCase()}</Badge>
                )}
                {n.published && <Badge tone="warn">{t.notePublishedBadge}</Badge>}
                <span className="ml-auto flex gap-1 shrink-0">
                  <button
                    type="button"
                    title={n.published ? t.noteUnpublish : t.notePublish}
                    disabled={pending}
                    onClick={() => run(() => setNotePublished({ noteId: n.id, published: !n.published }), t.savedToast)}
                    className="size-6 grid place-items-center rounded text-faint hover:text-ink hover:bg-surface-3 cursor-pointer disabled:opacity-40"
                  >
                    {n.published ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </button>
                  <button
                    type="button"
                    title={t.delete}
                    disabled={pending}
                    onClick={() => run(() => deleteCommunityNote({ noteId: n.id }), t.delete)}
                    className="size-6 grid place-items-center rounded text-faint hover:text-no-strong hover:bg-no-soft cursor-pointer disabled:opacity-40"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              </div>
              <p className="text-[12.5px] text-ink-2 mt-1 leading-snug whitespace-pre-wrap">{n.body}</p>
            </div>
          ))}
          </div>
        </>
      )}
      {noteGate && (
        <p className="mt-2 text-[11.5px] font-semibold text-warn-strong flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" /> {t.notesGate}
        </p>
      )}
    </div>
  );

  if (proposedOutcome) {
    const isProposer = !!viewerId && viewerId === proposedById;
    return (
      <Card className={cn("p-4 border", disputed ? "border-no/40" : "border-amber-500/40")}>
        {heading}
        {noteList}
        <p className="text-[12.5px] font-semibold mt-2">
          {t.proposalHeading((proposedOutcome === "yes" ? t.yes : t.no).toUpperCase())}
        </p>
        <p className="text-[12.5px] text-mute mt-1">
          {t.proposedBy(proposer ?? "?")}
          {reason ? ` — ${reason}` : ""}
        </p>
        <div className="mt-2.5">
          <div className="flex items-center gap-2.5 text-[11.5px] font-bold">
            <span className="text-yes-strong shrink-0">{confirms} {t.confirmVote}</span>
            <div className="h-2 flex-1 rounded-full bg-surface-3 overflow-hidden flex">
              {confirms > 0 && (
                <div className="bg-yes" style={{ width: `${(confirms / Math.max(confirms + disputes, 1)) * 100}%` }} />
              )}
              {disputes > 0 && (
                <div className="bg-no" style={{ width: `${(disputes / Math.max(confirms + disputes, 1)) * 100}%` }} />
              )}
            </div>
            <span className="text-no-strong shrink-0">{disputes} {t.disputeVote}</span>
          </div>
          <p className="text-[11.5px] text-faint mt-1">
            {t.voteTally(confirms, disputes)}
            {disputed && ` · ${t.disputedNote}`}
          </p>
        </div>
        {viewerId && !isProposer && (
          <div className="flex gap-1.5 mt-3">
            <Button
              size="xs"
              variant={myVote === "confirm" ? "yes" : "outline"}
              disabled={pending}
              onClick={() => run(() => voteResolution({ marketId, vote: "confirm" }), t.votedToast)}
            >
              <CheckCircle2 className="size-3" /> {t.confirmVote}
            </Button>
            <Button
              size="xs"
              variant={myVote === "dispute" ? "no" : "outline"}
              disabled={pending}
              onClick={() => run(() => voteResolution({ marketId, vote: "dispute" }), t.votedToast)}
            >
              <AlertTriangle className="size-3" /> {t.disputeVote}
            </Button>
          </div>
        )}
        {/* The proposer already declared outcome + reason — no second note box. */}
        {!isProposer && composer}
      </Card>
    );
  }

  const canPropose = !!viewerId && (closed || isResolver);
  return (
    <Card className="p-4">
      {heading}
      {noteList}
      <p className="text-[11.5px] text-mute mt-1.5">
        {isResolver && !closed ? t.resolutionResolverHint : t.resolutionIdle}
      </p>
      {canPropose && (
        <>
          <div className="mt-2.5">
            <Segmented
              value={outcome}
              onChange={(v) => setOutcome(v as "yes" | "no")}
              options={[
                { value: "yes", label: t.yes, tone: "yes" },
                { value: "no", label: t.no, tone: "no" },
              ]}
            />
          </div>
          <div className="flex gap-1.5 mt-2.5">
            <Input
              value={r}
              onChange={(e) => setR(e.target.value)}
              placeholder={t.reasonPh}
              maxLength={500}
              className="text-[13px]"
            />
            <Button
              size="sm"
              disabled={pending}
              onClick={() => run(() => proposeResolution({ marketId, outcome, reason: r }), t.proposedToast)}
            >
              <Send className="size-3" /> {t.propose}
            </Button>
          </div>
        </>
      )}
      {/* Whoever can declare the outcome uses the reason field above — one
          Ano/Ne and one text box, not two. */}
      {!canPropose && composer}
    </Card>
  );
}
