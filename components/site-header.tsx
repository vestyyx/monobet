import Link from "next/link";
import { Gift, Plus } from "lucide-react";
import { LogoMark } from "@/components/logo";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getNotifications, getRewardsState } from "@/lib/queries";
import { NotifBell } from "@/components/notif-bell";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { SearchBox } from "@/components/search-box";
import { UserMenu } from "@/components/user-menu";
import { WalletChip } from "@/components/wallet-chip";
import { MobileNav } from "@/components/mobile-nav";
import { ClaimButton } from "@/components/claim-button";
import { Button } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/theme-toggle";
import { LangToggle } from "@/components/lang-toggle";
import { DAILY_COOLDOWN_MS, WEEKLY_COOLDOWN_MS, AD_COOLDOWN_MS, DAILY_AMOUNT, WEEKLY_AMOUNT, AD_AMOUNT, BONUSES, STREAK_PER_DAY_CENTS, STREAK_CAP_DAYS, STREAK_WINDOW_MS } from "@/lib/rewards";
import { accruedDebtCents } from "@/lib/loans";
import { fmtMonosShort } from "@/lib/money";

export async function SiteHeader() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  const t = getT(lang);
  const [notifs, rewards] = user
    ? await Promise.all([getNotifications(user.id), getRewardsState(user.id)])
    : [[], null];
  const debtCents = user ? accruedDebtCents(user.debtCents, user.debtRateBps, user.debtSince) : 0;

  // Everything currently claimable on /rewards — the nav chip advertises it.
  let claimableCents = 0;
  if (user && rewards) {
    // eslint-disable-next-line react-hooks/purity -- server component renders once per request
    const now = Date.now();
    const ready = (last: Date | null, cd: number) => !last || now - new Date(last).getTime() >= cd;
    if (ready(user.lastClaimAt, DAILY_COOLDOWN_MS)) {
      const streak = !user.lastClaimAt || now - new Date(user.lastClaimAt).getTime() > STREAK_WINDOW_MS ? 1 : user.claimStreak + 1;
      claimableCents += DAILY_AMOUNT + Math.min(streak, STREAK_CAP_DAYS) * STREAK_PER_DAY_CENTS;
    }
    if (ready(rewards.lastWeekly, WEEKLY_COOLDOWN_MS)) claimableCents += WEEKLY_AMOUNT;
    if (ready(rewards.lastAd, AD_COOLDOWN_MS)) claimableCents += AD_AMOUNT;
    for (const b of BONUSES) {
      if (!rewards.claimed.has(`bonus:${b.key}`) && (!b.check || rewards.eligible[b.check])) claimableCents += b.amountCents;
    }
    claimableCents += rewards.royaltyDueCents;
  }

  return (
    <header className="sticky top-0 z-40 bg-surface/95 backdrop-blur border-b border-line">
      <div className="mx-auto max-w-6xl px-2.5 sm:px-4 h-14 flex items-center gap-1.5 sm:gap-4">
        <MobileNav lang={lang} signedIn={!!user} username={user?.username ?? user?.name} isAdminUser={!!user && isAdmin(user)} claimableCents={claimableCents} />
        <Link href="/" className="flex items-center gap-2 shrink-0 group/logo">
          <LogoMark className="transition-transform duration-300 group-hover/logo:rotate-[-6deg] group-hover/logo:scale-105" />
          <span className="font-bold text-[17px] tracking-tight hidden sm:block">MonoPredict</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 text-[13.5px] font-medium text-mute">
          <Link href="/" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.markets}
          </Link>
          <Link href="/leaderboard" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.leaderboard}
          </Link>
          <Link href="/jobs" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.jobs}
          </Link>
          <Link href="/games" className="px-2.5 py-1.5 rounded-md hover:text-ink hover:bg-surface-2">
            {t.gamesNav}
          </Link>
        </nav>

        <div className="ml-auto sm:flex-1 sm:max-w-sm">
          <SearchBox lang={lang} />
        </div>

        <Link
          href="/propose"
          className="grid size-8 sm:size-9 place-items-center rounded-lg bg-brand text-brand-on hover:bg-brand-strong transition-all duration-150 active:scale-[0.97] shrink-0"
          title={t.newMarket}
          aria-label={t.newMarket}
        >
          <Plus className="size-4" />
        </Link>

        {user ? (
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {claimableCents > 0 && (
              <Link
                href="/rewards"
                className="num hidden sm:inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg bg-yes-soft text-yes-strong text-[13px] font-bold border border-yes/30 hover:bg-yes/20"
                title={t.rewards}
              >
                <Gift className="size-3.5" />
                <span className="hidden sm:inline">{fmtMonosShort(claimableCents)}</span>
              </Link>
            )}
            <ClaimButton
              lang={lang}
              nextAt={user.lastClaimAt ? new Date(user.lastClaimAt).getTime() + DAILY_COOLDOWN_MS : null}
            />
            <WalletChip balanceCents={user.balanceCents} debtCents={debtCents} lang={lang} />
            <NotifBell items={notifs} userId={user.id} lang={lang} />
            <UserMenu name={user.name} username={user.username} role={isAdmin(user) ? "admin" : user.role} image={user.image} lang={lang} />
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/login">
              <Button variant="ghost" size="sm">
                {t.logIn}
              </Button>
            </Link>
            <Link href="/login?mode=signup">
              <Button size="sm">{t.signUp}</Button>
            </Link>
          </div>
        )}
        <div className="hidden sm:flex items-center gap-2 shrink-0">
          <LangToggle />
          <ThemeToggle lang={lang} />
        </div>
      </div>
      {user?.bannedAt && (
        <div className="border-t border-no/30 bg-no-soft px-4 py-1.5 text-center text-[12.5px] font-medium text-no-strong">
          {t.bannedBanner(user.banReason)}
        </div>
      )}
    </header>
  );
}
