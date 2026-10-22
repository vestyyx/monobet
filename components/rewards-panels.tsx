"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { claimAdReward, claimBonus, claimDaily, claimWeekly, takeLoan, repayLoan, dealLoanOffers, claimReferralRoyalties } from "@/lib/actions";
import { LOAN_PRESETS_CENTS, LOAN_OFFER_COUNT } from "@/lib/loans";
import { getT, type Lang } from "@/lib/i18n";
import { AD_WATCH_MS } from "@/lib/rewards";
import { fmtMonos } from "@/lib/money";
import { playSfx } from "@/lib/sfx";
import {
  CalendarCheck,
  CalendarDays,
  CheckCircle2,
  Clapperboard,
  ExternalLink,
  Flame,
  Gift,
  HandCoins,
  Lock,
  Play,
} from "lucide-react";

type Recurring = { nextAt: number | null; amount: string; streak?: number };
type ReferralRow = { username: string | null; name: string | null; earnedCents: number; royaltyCents: number; paidCents: number };
type BonusState = {
  key: string;
  amountCents: number;
  href: string | null;
  claimed: boolean;
  eligible: boolean;
};

// Wait label: minutes under an hour ("~24m"), hours above ("~20h").
function waitLabel(ms: number, t: ReturnType<typeof getT>) {
  return ms < 3_540_000 ? t.availableInMin(Math.ceil(ms / 60_000)) : t.availableIn(Math.ceil(ms / 3_600_000));
}

function useRemaining(nextAt: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nextAt) return;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [nextAt]);
  return nextAt ? Math.max(0, nextAt - now) : 0;
}

function RecurringCard({
  icon,
  title,
  desc,
  amount,
  nextAt,
  streak,
  run,
  t,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  amount: string;
  nextAt: number | null;
  streak?: number;
  run: () => Promise<{ ok: boolean; error?: string; retryInH?: number }>;
  t: ReturnType<typeof getT>;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const remaining = useRemaining(nextAt);
  const ready = remaining <= 0;

  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center">{icon}</div>
        <span className="num text-sm font-bold text-yes">{amount}</span>
      </div>
      <div>
        <div className="text-[15px] font-semibold flex items-center gap-2">
          {title}
          {(streak ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn-strong">
              <Flame className="size-3.5" />
              {t.dayStreak(streak ?? 0)}
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-mute mt-0.5">{desc}</div>
      </div>
      <button
        disabled={!ready || pending}
        onClick={() =>
          start(async () => {
            const r = await run();
            if (r.ok) {
              playSfx("claim", 0.5);
              toast.success(`+${amount}`);
              router.refresh();
            } else {
              toast.error(r.error === "cooldown" ? t.availableIn(r.retryInH ?? 1) : t.serverErr(r.error));
            }
          })
        }
        suppressHydrationWarning // clock-derived label — SSR/CSR instants differ
        className="mt-auto h-9 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
      >
        {pending ? "…" : ready ? t.claimNow : waitLabel(remaining - 30_000, t)}
      </button>
    </div>
  );
}

// Passive card — the presence streak pays automatically on the day's first
// hit, so there is no claim button, just the streak and tomorrow's amount.
function ActivityCard({ streak, today, next, t }: { streak: number; today: string; next: string; t: ReturnType<typeof getT> }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center">
          <Flame className="size-4.5" />
        </div>
        <span className="num text-sm font-bold text-yes">{today}</span>
      </div>
      <div>
        <div className="text-[15px] font-semibold flex items-center gap-2">
          {t.activityDaily}
          {streak > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn-strong">
              <Flame className="size-3.5" />
              {t.dayStreak(streak)}
            </span>
          )}
        </div>
        <div className="text-[12.5px] text-mute mt-0.5">{t.activityDesc}</div>
      </div>
      <div className="mt-auto text-[11.5px] font-semibold text-mute">
        {t.activityToday(today)} · {t.activityTomorrow(next)}
      </div>
    </div>
  );
}

function AdCard({ nextAt, amount, t }: { nextAt: number | null; amount: string; t: ReturnType<typeof getT> }) {
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<number | null>(null);
  const [adKey, setAdKey] = useState(0);
  const [vid, setVid] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const remaining = useRemaining(nextAt);
  const ready = remaining <= 0;

  const AD_VIDEO_COUNT = 18;
  // Rotation memory — a creative can't repeat until most of the deck has
  // played, so consecutive views always land on something different.
  const pickAd = (): number => {
    try {
      const seen: number[] = JSON.parse(localStorage.getItem("mb.adSeen") ?? "[]").filter(
        (x: unknown): x is number => Number.isInteger(x)
      );
      const pool = Array.from({ length: AD_VIDEO_COUNT }, (_, i) => i).filter((i) => !seen.includes(i));
      const n = pool[Math.floor(Math.random() * pool.length)] ?? Math.floor(Math.random() * AD_VIDEO_COUNT);
      seen.push(n);
      localStorage.setItem("mb.adSeen", JSON.stringify(seen.slice(-Math.floor(AD_VIDEO_COUNT * 0.7))));
      return n;
    } catch {
      return Math.floor(Math.random() * AD_VIDEO_COUNT);
    }
  };
  const startAd = () => {
    setVid(pickAd());
    setAdKey((k) => k + 1);
    setLeft(Math.ceil(AD_WATCH_MS / 1000));
    setOpen(true);
  };

  useEffect(() => {
    if (left === null || left <= 0) return;
    const id = setTimeout(() => setLeft((v) => (v === null ? null : v - 1)), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const adDone = left !== null && left <= 0;
  const total = Math.ceil(AD_WATCH_MS / 1000);
  const elapsed = left === null ? 0 : total - left;
  // Skippable after 10s — skipping redeems the reward and closes the modal.
  const canSkip = open && left !== null && !adDone && elapsed >= Math.min(10, total - 1);

  const claim = () =>
    start(async () => {
      const r = await claimAdReward();
      setOpen(false);
      setLeft(null);
      if (r.ok) {
        playSfx("claim", 0.5);
        toast.success(`+${amount}`);
        router.refresh();
      } else {
        toast.error(r.error === "cooldown" ? t.availableIn(r.retryInH ?? 1) : t.serverErr(r.error));
      }
    });

  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center">
          <Clapperboard className="size-4.5" />
        </div>
        <span className="num text-sm font-bold text-yes">{amount}</span>
      </div>
      <div>
        <div className="text-[15px] font-semibold">{t.adReward}</div>
        <div className="text-[12.5px] text-mute mt-0.5">{t.adDesc}</div>
      </div>
      <button
        suppressHydrationWarning // clock-derived label
        disabled={!ready || pending}
        onClick={startAd}
        className="mt-auto h-9 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 inline-flex items-center justify-center gap-1.5"
      >
        <Play className="size-3.5" />
        {ready ? t.watchAd : waitLabel(remaining - 30_000, t)}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => adDone && setOpen(false)}>
          <div className="w-full max-w-3xl rounded-2xl overflow-hidden border border-line bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="relative aspect-video">
              <iframe
                key={adKey}
                src={`/ads/player.html?v=${vid ?? 0}&r=${adKey}`}
                className="absolute inset-0 w-full h-full border-0"
                title="Ad"
              />
              {canSkip && (
                <button
                  disabled={pending}
                  onClick={claim}
                  className="absolute top-3 right-3 h-8 px-3.5 rounded-lg bg-black/70 border border-white/20 text-white text-[12.5px] font-semibold hover:bg-black/85 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {t.skipAd} ▸
                </button>
              )}
              <div className="absolute bottom-0 inset-x-0 h-1 bg-white/10">
                <div
                  className="h-full bg-brand transition-all duration-1000 ease-linear"
                  style={{ width: `${100 - (left ?? 0) * (100 / total)}%` }}
                />
              </div>
            </div>
            <div className="p-4 flex items-center justify-between gap-3">
              <span className="text-[12.5px] text-mute font-medium">
                {adDone ? t.claimNow : t.adEndsIn(left ?? 0)}
              </span>
              <button
                disabled={!adDone || pending}
                onClick={claim}
                className="h-8 px-4 rounded-lg bg-brand text-brand-on text-[13px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {t.claimNow}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InviteCard({ username, lang }: { username: string; lang: Lang }) {
  const t = getT(lang);
  const [copied, setCopied] = useState(false);
  const link = `https://monopredict.vercel.app/login?ref=${encodeURIComponent(username)}`;
  return (
    <div className="rounded-xl border border-line bg-surface p-4 flex items-center gap-3">
      <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
        <Gift className="size-4.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold flex items-center gap-2">
          {t.inviteTitle}
          <span className="num text-[12px] font-bold text-yes">+{fmtMonos(20_000, { lang, decimals: false })}</span>
        </div>
        <div className="text-[12px] text-mute">{t.inviteDesc}</div>
      </div>
      <button
        onClick={() => {
          navigator.clipboard.writeText(link);
          setCopied(true);
          toast.success(t.copied);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="h-8 px-3 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer shrink-0 inline-flex items-center gap-1.5"
      >
        {copied ? <CheckCircle2 className="size-3.5" /> : null}
        {copied ? t.copied : t.copyLink}
      </button>
    </div>
  );
}

// Referral royalties — per-invitee 5% cut of lifetime earnings with the
// already-paid share tracked so the claim button only sweeps the delta.
function RoyaltyCard({ referrals, dueCents, lang }: { referrals: ReferralRow[]; dueCents: number; lang: Lang }) {
  const t = getT(lang);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
          <HandCoins className="size-4.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold">{t.royaltyTitle}</div>
          <div className="text-[12px] text-mute">{t.royaltyDesc}</div>
        </div>
        {dueCents > 0 && (
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await claimReferralRoyalties();
                if (r.ok) {
                  playSfx("claim", 0.5);
                  toast.success(`+${fmtMonos(r.creditedCents ?? 0, { lang, decimals: false })}`);
                  router.refresh();
                } else toast.error(t.serverErr(r.error));
              })
            }
            className="h-8 px-3 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 shrink-0"
          >
            {t.royaltyClaim} · +{fmtMonos(dueCents, { lang, decimals: false })}
          </button>
        )}
      </div>
      {referrals.length === 0 ? (
        <div className="mt-3 text-[12px] text-faint">{t.royaltyNone}</div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {referrals.map((r) => {
            const due = Math.max(0, r.royaltyCents - r.paidCents);
            return (
              <div key={r.username ?? r.name} className="flex items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-[12.5px]">
                <span className="font-semibold truncate">@{r.username ?? r.name}</span>
                <span className="text-mute num">{t.royaltyEarned(fmtMonos(r.earnedCents, { lang, decimals: false }))}</span>
                <span className="ml-auto num font-semibold">
                  {t.royaltyCut(fmtMonos(r.royaltyCents, { lang, decimals: false }))}
                  {r.paidCents > 0 && <span className="text-mute font-normal"> · −{fmtMonos(r.paidCents, { lang, decimals: false })}</span>}
                </span>
                {due > 0 && <span className="num font-bold text-yes">+{fmtMonos(due, { lang, decimals: false })}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// House loan card — borrow Monos via a pick-a-card gamble: clicking an amount
// deals three hidden APRs (server-signed), the card you pick sets your rate.
// Borrowing is blocked while you owe the house; this is the only debt source.
function LoanCard({ debtCents, rateBps, balanceCents, t, lang }: { debtCents: number; rateBps: number; balanceCents: number; t: ReturnType<typeof getT>; lang: Lang }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [offer, setOffer] = useState<{ token: string; amount: number } | null>(null);
  const [reveal, setReveal] = useState<{ picked: number; offers: number[] } | null>(null);
  const inDebt = debtCents > 0;
  const loanErr = (e?: string) =>
    e === "Repay your debt first" ? t.loanBlockedDebt : t.serverErr(e);

  const deal = (cents: number) =>
    start(async () => {
      setReveal(null);
      const r = await dealLoanOffers({ amountCents: cents });
      if (r.ok && r.token) {
        playSfx("flip", 0.4);
        setOffer({ token: r.token, amount: cents });
      } else toast.error(loanErr(r.error));
    });

  const pick = (i: number) => {
    if (!offer) return;
    start(async () => {
      const r = await takeLoan({ token: offer.token, pick: i });
      if (r.ok) {
        playSfx("claim", 0.5);
        setReveal({ picked: i, offers: r.offers ?? [] });
        toast.success(t.loanTaken(fmtMonos(offer.amount, { lang }), ((r.rateBps ?? 0) / 100).toFixed(1)));
        router.refresh();
        setTimeout(() => setOffer(null), 4000);
      } else toast.error(loanErr(r.error));
    });
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-warn-soft text-warn-strong flex items-center justify-center">
            <HandCoins className="size-4.5" />
          </div>
          <div>
            <div className="text-[15px] font-semibold">{t.loanTitle}</div>
            <div className="text-[12.5px] text-mute mt-0.5">{inDebt ? t.loanRepayHint : t.loanDesc}</div>
          </div>
        </div>
        <div className="text-right">
          {inDebt ? (
            <>
              <div className="num text-sm font-bold text-no-strong">{t.loanOwed(fmtMonos(debtCents, { lang }))}</div>
              <div className="num text-[11.5px] text-faint">{(rateBps / 100).toFixed(1)}% APR</div>
            </>
          ) : (
            <div className="text-[12.5px] font-medium text-mute">{t.loanNoDebt}</div>
          )}
        </div>
      </div>

      {/* Pick-a-card rate gamble — the dealt offers are server-signed, the
          pick binds the loan to that card's rate. Declining before the pick
          costs nothing; once a card flips the loan is booked instantly. */}
      {offer && (
        <div className="mt-3">
          <p className="text-[12px] font-medium text-mute mb-1.5">
            {reveal ? t.loanTakenHeader : t.loanPickCard}
          </p>
          <div className="flex gap-2">
            {Array.from({ length: LOAN_OFFER_COUNT }, (_, i) => {
              const revealed = reveal !== null;
              const mine = reveal?.picked === i;
              const rate = revealed ? reveal.offers[i] : null;
              const lo = revealed ? Math.min(...reveal.offers) : 0;
              const hi = revealed ? Math.max(...reveal.offers) : 0;
              const tier = rate === null ? "" : rate === lo ? "best" : rate === hi ? "worst" : "mid";
              return (
                <button
                  key={i}
                  disabled={pending || revealed}
                  onClick={() => pick(i)}
                  className={`flex-1 rounded-lg border text-center transition-all cursor-pointer disabled:cursor-default ${
                    revealed ? "h-20 py-2" : "h-16"
                  } ${
                    revealed
                      ? tier === "best"
                        ? "border-yes bg-yes-soft"
                        : tier === "worst"
                          ? "border-no bg-no-soft"
                          : "border-warn bg-warn-soft"
                      : "border-line bg-surface-2 hover:border-brand/50 hover:bg-brand-soft/40 active:scale-[0.97]"
                  } ${mine ? "ring-2 ring-brand scale-[1.04] z-10" : revealed ? "opacity-75" : ""}`}
                >
                  {revealed && rate != null ? (
                    <span className="block">
                      <span
                        className={`num block text-[16px] font-bold ${
                          tier === "best" ? "text-yes-strong" : tier === "worst" ? "text-no-strong" : "text-warn-strong"
                        }`}
                      >
                        {(rate / 100).toFixed(1)}%
                        <span className="text-[10px] font-medium"> APR</span>
                      </span>
                      <span
                        className={`block text-[10px] font-semibold uppercase tracking-wide mt-0.5 ${
                          tier === "best" ? "text-yes-strong" : tier === "worst" ? "text-no-strong" : "text-warn-strong"
                        }`}
                      >
                        {tier === "best" ? t.loanTierBest : tier === "worst" ? t.loanTierWorst : t.loanTierMid}
                        {mine ? ` · ${t.loanTierYours}` : ""}
                      </span>
                    </span>
                  ) : (
                    <span className="mx-auto block h-9 w-7 rounded-[4px] bg-[repeating-linear-gradient(45deg,var(--color-line-2)_0px,var(--color-line-2)_3px,transparent_3px,transparent_7px)] ring-1 ring-line-2" />
                  )}
                </button>
              );
            })}
          </div>
          {!reveal && (
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-faint leading-snug">{t.loanCommitNote}</p>
              <button
                disabled={pending}
                onClick={() => setOffer(null)}
                className="shrink-0 h-7 px-3 rounded-md border border-line-2 text-[11.5px] font-semibold text-mute hover:text-ink hover:bg-surface-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                {t.loanDecline}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {inDebt ? (
          <button
            disabled={pending || balanceCents <= 0}
            onClick={() =>
              start(async () => {
                const r = await repayLoan({});
                if (r.ok) {
                  playSfx("claim", 0.5);
                  // Balance may only cover part of the debt — say so.
                  toast.success(
                    r.leftCents && r.leftCents > 0
                      ? t.loanRepaidPart(fmtMonos(r.paidCents ?? 0, { lang }), fmtMonos(r.leftCents, { lang }))
                      : t.loanRepaid
                  );
                  router.refresh();
                } else toast.error(loanErr(r.error));
              })
            }
            className="h-8 px-3.5 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {balanceCents >= debtCents ? t.loanRepayAll : t.loanRepayAvail(fmtMonos(balanceCents, { lang }))}
          </button>
        ) : (
          !offer &&
          LOAN_PRESETS_CENTS.map((cents) => (
            <button
              key={cents}
              disabled={pending}
              onClick={() => deal(cents)}
              className="h-8 px-3.5 rounded-lg bg-surface-2 text-[12.5px] font-semibold text-ink hover:bg-surface-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.loanBorrow(fmtMonos(cents, { lang, decimals: false }))}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

export function RewardsPanels({
  lang,
  daily,
  weekly,
  ad,
  activity,
  bonuses,
  username,
  referrals,
  royaltyDueCents,
  debt,
  balanceCents,
}: {
  lang: Lang;
  daily: Recurring;
  weekly: Recurring;
  ad: Recurring;
  activity: { streak: number; today: string; next: string };
  bonuses: BonusState[];
  username: string;
  referrals: ReferralRow[];
  royaltyDueCents: number;
  debt: { cents: number; rateBps: number };
  balanceCents: number;
}) {
  const t = getT(lang);
  const [pending, start] = useTransition();
  const router = useRouter();

  const bonusText: Record<string, { title: string; desc: string }> = {
    portfolio: { title: t.bonusPortfolio, desc: t.bonusPortfolioDesc },
    instagram: { title: t.bonusInstagram, desc: t.bonusInstagramDesc },
    github: { title: t.bonusGithub, desc: t.bonusGithubDesc },
    first_bet: { title: t.bonusFirstBet, desc: t.bonusFirstBetDesc },
    first_market: { title: t.bonusFirstMarket, desc: t.bonusFirstMarketDesc },
    first_comment: { title: t.bonusFirstComment, desc: t.bonusFirstCommentDesc },
    avatar: { title: t.bonusAvatar, desc: t.bonusAvatarDesc },
    watchlist: { title: t.bonusWatchlist, desc: t.bonusWatchlistDesc },
    heart: { title: t.bonusHeart, desc: t.bonusHeartDesc },
    duel: { title: t.bonusDuel, desc: t.bonusDuelDesc },
    squad: { title: t.bonusSquad, desc: t.bonusSquadDesc },
    ten_trades: { title: t.bonusTenTrades, desc: t.bonusTenTradesDesc },
    streak7: { title: t.bonusStreak7, desc: t.bonusStreak7Desc },
    first_sell: { title: t.bonusFirstSell, desc: t.bonusFirstSellDesc },
    note: { title: t.bonusNote, desc: t.bonusNoteDesc },
    vote: { title: t.bonusVote, desc: t.bonusVoteDesc },
    duel_win: { title: t.bonusDuelWin, desc: t.bonusDuelWinDesc },
    squad_owner: { title: t.bonusSquadOwner, desc: t.bonusSquadOwnerDesc },
    referrer: { title: t.bonusReferrer, desc: t.bonusReferrerDesc },
    fifty_trades: { title: t.bonusFiftyTrades, desc: t.bonusFiftyTradesDesc },
    active7: { title: t.bonusActive7, desc: t.bonusActive7Desc },
  };

  return (
    <div className="mt-7 space-y-8">
      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">{t.recurringRewards}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ActivityCard streak={activity.streak} today={activity.today} next={activity.next} t={t} />
          <RecurringCard
            icon={<CalendarCheck className="size-4.5" />}
            title={t.dailyReward}
            desc={t.dailyDesc}
            amount={daily.amount}
            nextAt={daily.nextAt}
            streak={daily.streak}
            run={claimDaily}
            t={t}
          />
          <RecurringCard
            icon={<CalendarDays className="size-4.5" />}
            title={t.weeklyReward}
            desc={t.weeklyDesc}
            amount={weekly.amount}
            nextAt={weekly.nextAt}
            run={claimWeekly}
            t={t}
          />
          <AdCard nextAt={ad.nextAt} amount={ad.amount} t={t} />
        </div>
        <div className="mt-3">
          <LoanCard debtCents={debt.cents} rateBps={debt.rateBps} balanceCents={balanceCents} t={t} lang={lang} />
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-faint mb-3">{t.oneTimeBonuses}</h2>
        <div className="mb-3 space-y-3">
          <InviteCard username={username} lang={lang} />
          <RoyaltyCard referrals={referrals} dueCents={royaltyDueCents} lang={lang} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bonuses.map((b) => {
            const txt = bonusText[b.key];
            const done = b.claimed;
            const pureLink = !!b.href?.startsWith("http");
            return (
              <div
                key={b.key}
                className={`rounded-xl border p-4 flex items-center gap-3 transition-colors ${
                  done ? "border-line bg-surface-2 opacity-70" : "border-line bg-surface"
                }`}
              >
                <div className="size-9 rounded-lg bg-brand-soft text-brand-strong flex items-center justify-center shrink-0">
                  <Gift className="size-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold flex items-center gap-2">
                    {txt.title}
                    <span className="num text-[12px] font-bold text-yes">
                      +{fmtMonos(b.amountCents, { lang, decimals: false })}
                    </span>
                  </div>
                  <div className="text-[12px] text-mute truncate">{txt.desc}</div>
                </div>
                {done ? (
                  <CheckCircle2 className="size-5 text-yes shrink-0" />
                ) : (
                  <div className="flex gap-1.5 shrink-0">
                    {b.href && !pureLink && (
                      <a
                        href={b.href}
                        className="size-8 rounded-lg bg-surface-2 text-mute hover:text-ink inline-flex items-center justify-center transition-colors"
                        title={t.visit}
                      >
                        <ExternalLink className="size-3.5" />
                      </a>
                    )}
                    <button
                      disabled={pending || !b.eligible}
                      onClick={() =>
                        start(async () => {
                          if (pureLink) window.open(b.href!, "_blank", "noopener,noreferrer");
                          const r = await claimBonus(b.key);
                          if (r.ok) {
                            playSfx("claim", 0.5);
                            toast.success(`+${fmtMonos(b.amountCents, { lang, decimals: false })}`);
                            router.refresh();
                          } else toast.error(t.serverErr(r.error));
                        })
                      }
                      className="h-8 px-3 rounded-lg bg-brand text-brand-on text-[12.5px] font-semibold hover:bg-brand-strong transition-all active:scale-[0.97] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 inline-flex items-center gap-1"
                      title={b.eligible ? (pureLink ? t.visitClaim : t.claimNow) : txt.desc}
                    >
                      {b.eligible ? (pureLink ? <><ExternalLink className="size-3.5" />{t.visitClaim}</> : t.claimNow) : <Lock className="size-3.5" />}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
