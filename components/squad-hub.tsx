"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Avatar, Badge, Button, Card, Input, Select } from "@/components/ui/primitives";
import { fmtMonos } from "@/lib/money";
import { getT, type Lang } from "@/lib/i18n";
import { joinSquad, squadBorrow, squadContribute, squadRepay, squadSend, squadKick, joinSquadByCode } from "@/lib/actions";
import { ArrowDownToLine, ArrowUpFromLine, Crown, HandCoins, PiggyBank, Send, UserX, Users, X } from "lucide-react";

export type SquadMemberRow = {
  id: string;
  username: string | null;
  name: string;
  image: string | null;
  balanceCents: number;
  squadDebtCents: number;
  squadRole: string | null;
  netWorthCents: number;
  isMe: boolean;
};

export type SquadActivityRow = {
  id: string;
  username: string | null;
  name: string;
  image: string | null;
  side: string;
  outcome: string;
  amountCents: number;
  createdAt: string;
  slug: string;
  question: string;
};

function ago(ms: number, t: ReturnType<typeof getT>) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t.agoS(s);
  const m = Math.floor(s / 60);
  if (m < 60) return t.agoM(m);
  const h = Math.floor(m / 60);
  if (h < 24) return t.agoH(h);
  return t.agoD(Math.floor(h / 24));
}

// Money box used three ways: put in, take out, pay back — one amount field.
function PotControls({
  potCents,
  myDebtCents,
  balanceCents,
  lang,
}: {
  potCents: number;
  myDebtCents: number;
  balanceCents: number;
  lang: Lang;
}) {
  const t = getT(lang);
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const cents = Math.round(parseFloat(amount || "0") * 100);

  const run = (fn: (c: number) => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn(cents);
      if (r.ok) {
        toast.success(done);
        setAmount("");
        router.refresh();
      } else toast.error(r.error ?? "Failed");
    });

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="size-9 rounded-lg bg-brand-soft text-brand-strong grid place-items-center">
            <PiggyBank className="size-4.5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold">{t.squadPot}</div>
            <div className="text-[11.5px] text-mute">{t.squadPotDesc}</div>
          </div>
        </div>
        <div className="num text-lg font-bold text-yes whitespace-nowrap shrink-0">{fmtMonos(potCents, { lang })}</div>
      </div>
      {myDebtCents > 0 && (
        <div className="num text-[12.5px] font-semibold text-no-strong bg-no-soft border border-no/30 rounded-lg px-3 py-1.5">
          {t.squadYouOwe}: {fmtMonos(myDebtCents, { lang })}
        </div>
      )}
      <div className="flex gap-2 flex-wrap">
        <Input
          type="number"
          step="0.01"
          min="1"
          placeholder={t.squadAmountPh}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 num"
        />
        <Button size="sm" variant="outline" disabled={pending || cents < 100 || cents > balanceCents} onClick={() => run(squadContribute, t.squadGaveToast)}>
          <ArrowUpFromLine className="size-3.5" /> {t.squadContribute}
        </Button>
        <Button size="sm" variant="outline" disabled={pending || cents < 100 || cents > potCents} onClick={() => run(squadBorrow, t.squadBorrowedToast)}>
          <ArrowDownToLine className="size-3.5" /> {t.squadBorrow}
        </Button>
        <Button size="sm" variant="outline" disabled={pending || cents < 100 || myDebtCents <= 0} onClick={() => run(squadRepay, t.squadRepaidToast)}>
          <HandCoins className="size-3.5" /> {t.squadRepay}
        </Button>
      </div>
    </Card>
  );
}

function SendCard({ members, lang }: { members: SquadMemberRow[]; lang: Lang }) {
  const t = getT(lang);
  const others = members.filter((m) => !m.isMe);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const cents = Math.round(parseFloat(amount || "0") * 100);

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="size-9 rounded-lg bg-brand-soft text-brand-strong grid place-items-center">
          <Send className="size-4.5" />
        </span>
        <div className="text-[15px] font-semibold">{t.squadSendTo}</div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <Select value={to} onChange={(e) => setTo(e.target.value)} className="flex-1 min-w-36">
          <option value="">{t.squadSendPh}</option>
          {others.map((m) => (
            <option key={m.id} value={m.username ?? m.name}>
              @{m.username ?? m.name}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          step="0.01"
          min="1"
          placeholder={t.squadAmountPh}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-32 num"
        />
        <Button
          size="sm"
          disabled={pending || !to || cents < 100}
          onClick={() =>
            start(async () => {
              const r = await squadSend(to, cents);
              if (r.ok) {
                toast.success(t.squadSentToast);
                setAmount("");
                router.refresh();
              } else toast.error(r.error ?? "Failed");
            })
          }
        >
          {t.squadSend}
        </Button>
      </div>
    </Card>
  );
}

// Phase 3 — the Group Parent (or staff) removes a disruptive member.
// Confirmation inline, no modal; server action re-checks the caller's rank.
function MemberKick({ username, lang }: { username: string; lang: Lang }) {
  const t = getT(lang);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  if (!confirming)
    return (
      <Button variant="ghost" size="sm" className="shrink-0" disabled={pending} onClick={() => setConfirming(true)} title={t.squadKick}>
        <UserX className="size-3.5" />
      </Button>
    );

  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await squadKick(username);
          if (r.ok) {
            toast.success(t.squadKick);
            router.refresh();
          } else toast.error(r.error ?? "Failed");
          setConfirming(false);
        })
      }
    >
      <X className="size-3.5" /> {t.squadKick}
    </Button>
  );
}

export function SquadHub({
  lang,
  squadName,
  treasuryCents,
  myBalanceCents,
  myDebtCents,
  members,
  activity,
  now,
  canKick,
  squadPaused,
}: {
  lang: Lang;
  squadName: string;
  treasuryCents: number;
  myBalanceCents: number;
  myDebtCents: number;
  members: SquadMemberRow[];
  activity: SquadActivityRow[];
  now: number;
  canKick: boolean;
  squadPaused: boolean;
}) {
  const t = getT(lang);
  const combined = members.reduce((s, m) => s + m.netWorthCents, 0);
  const outstanding = members.reduce((s, m) => s + m.squadDebtCents, 0);

  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {squadPaused && (
          <div className="text-[12.5px] font-semibold text-warn bg-warn/10 border border-warn/30 rounded-lg px-3 py-1.5">
            {t.squadPausedBanner}
          </div>
        )}
        <Card className="p-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-lg font-bold flex items-center gap-2">
                <Users className="size-5 text-brand-strong" /> {squadName}
              </div>
              <div className="text-[12px] text-mute mt-0.5">
                {members.length} · {t.squadCombinedWorth}: <span className="num font-semibold text-ink">{fmtMonos(combined, { lang })}</span>
                {outstanding > 0 && (
                  <>
                    {" · "}
                    {t.squadPot}: <span className="num font-semibold text-ink">{fmtMonos(treasuryCents, { lang })}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-line-2 border-t border-line-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-3 py-2.5">
                <Link href={`/u/${encodeURIComponent(m.username ?? m.name)}`} className="flex items-center gap-3 flex-1 min-w-0 group">
                  <Avatar name={m.username ?? m.name} image={m.image} className="size-8" />
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate group-hover:text-brand-strong">
                      {m.squadRole === "parent" && <Crown className="inline size-3.5 -mt-0.5 mr-1 text-warn" />}
                      @{m.username ?? m.name}
                      {m.isMe && <span className="text-mute font-normal"> · {t.lbYou}</span>}
                    </div>
                    <div className="num text-[11.5px] text-faint">
                      {fmtMonos(m.balanceCents, { lang })}
                      {m.squadDebtCents > 0 && (
                        <span className="text-no-strong"> · {t.squadOwesPot(fmtMonos(m.squadDebtCents, { lang }))}</span>
                      )}
                    </div>
                  </div>
                </Link>
                <span className="num text-[13px] font-bold">{fmtMonos(m.netWorthCents, { lang })}</span>
                {canKick && !m.isMe && <MemberKick username={m.username ?? m.name} lang={lang} />}
              </div>
            ))}
          </div>
        </Card>

        <PotControls potCents={treasuryCents} myDebtCents={myDebtCents} balanceCents={myBalanceCents} lang={lang} />
        {members.length > 1 && <SendCard members={members} lang={lang} />}
      </div>

      <Card className="p-4 self-start">
        <div className="text-[15px] font-semibold mb-3">{t.squadActivity}</div>
        {activity.length === 0 && <p className="text-[13px] text-mute">{t.squadNoActivity}</p>}
        <div className="space-y-2.5">
          {activity.map((a) => (
            <div key={a.id} className="flex items-center gap-2.5 text-[12.5px]">
              <Avatar name={a.username ?? a.name} image={a.image} className="size-6" />
              <div className="flex-1 min-w-0">
                <span className="font-medium">@{a.username ?? a.name}</span>{" "}
                <Badge tone={a.outcome === "yes" ? "yes" : "no"}>
                  {a.side === "buy" ? "+" : "−"}
                  {a.outcome.toUpperCase()}
                </Badge>{" "}
                <Link href={`/market/${a.slug}`} className="text-mute hover:text-ink truncate inline-block max-w-44 align-bottom">
                  {a.question}
                </Link>
              </div>
              <span className="num text-faint shrink-0">{ago(now - new Date(a.createdAt).getTime(), t)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// Create-or-join card for squad-less users.
export function SquadJoinCard({ lang }: { lang: Lang }) {
  const t = getT(lang);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <Card className="p-4 max-w-md">
      <div className="text-[15px] font-semibold mb-1">{t.squadNoSquad}</div>
      <p className="text-[13px] text-mute mb-3">{t.squadNoSquadDesc}</p>
      <div className="flex gap-2">
        <Input placeholder={t.squadNamePh} value={name} onChange={(e) => setName(e.target.value)} maxLength={24} />
        <Button
          size="sm"
          disabled={pending || name.trim().length < 2}
          onClick={() =>
            start(async () => {
              const r = await joinSquad(name);
              if (r.ok) {
                toast.success(t.squadJoinedToast);
                router.refresh();
              } else toast.error(r.error ?? "Failed");
            })
          }
        >
          {t.squadJoin}
        </Button>
      </div>
      <p className="text-[11.5px] text-faint mt-2">{t.squadHint}</p>
      {/* Phase 3 — invite code from the squad parent/admin */}
      <div className="flex gap-2 mt-3">
        <Input placeholder={t.squadCodePh} value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} className="font-mono uppercase" />
        <Button
          size="sm"
          variant="outline"
          disabled={pending || code.trim().length < 6}
          onClick={() =>
            start(async () => {
              const r = await joinSquadByCode(code);
              if (r.ok) {
                toast.success(t.squadJoinedToast);
                router.refresh();
              } else toast.error(r.error ?? "Failed");
            })
          }
        >
          {t.squadCodeJoin}
        </Button>
      </div>
    </Card>
  );
}
