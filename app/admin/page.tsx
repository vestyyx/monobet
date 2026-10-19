import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser, isAdmin } from "@/lib/session";
import { getPendingMarkets, listMarkets, getAllUsers, listCategories, listCategoryRows, getDisputedDuels, getNoteCounts, listDealers, getHouseStats } from "@/lib/queries";
import { PendingList, LiveMarketList, GrantPanel, CategoriesPanel, UsersPanel, UserManager, DuelAdminPanel, DealersPanel, HousePanel } from "@/components/admin-panels";
import { MarketForm } from "@/components/market-form";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { Card } from "@/components/ui/primitives";
import { ShieldCheck, Inbox, Radio, Users, PlusCircle, Tags, UserPlus, Swords, Spade, Landmark } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Administrace" };

export default async function AdminPage() {
  const [user, lang] = await Promise.all([getCurrentUser(), getLang()]);
  if (!user) redirect("/login");
  if (!isAdmin(user)) redirect("/");
  const t = getT(lang);

  const [pending, live, users, categories, categoryRows, disputed, dealers, house, noteCounts] = await Promise.all([
    getPendingMarkets(),
    listMarkets({ includeOptions: true }),
    getAllUsers(),
    listCategories(),
    listCategoryRows(),
    getDisputedDuels(),
    listDealers(),
    getHouseStats(),
  ]).then(async (r) => {
    // Note counts need the market ids first — one extra batched query.
    const counts = await getNoteCounts((r[1] as { id: string }[]).map((m) => m.id));
    return [...r, counts] as const;
  });

  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
        <ShieldCheck className="size-5" /> {t.adminTitle}
      </h1>

      {/* [&>*]:min-w-0 — grid items default to min-width:auto, so any nowrap
          text inside (dealer quips, long emails) would stretch the implicit
          mobile column past the viewport. */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <section className="lg:col-span-2">
          <SectionTitle icon={<Inbox className="size-4" />} title={t.pendingProposals(pending.length)} />
          <Card className="overflow-hidden">
            <PendingList
              lang={lang}
              items={pending.map(({ market: m, username }) => ({
                id: m.id,
                slug: m.slug,
                question: m.question,
                category: m.category,
                createdAt: m.createdAt,
                username,
              }))}
            />
          </Card>
        </section>

        <section className="lg:col-span-2">
          <SectionTitle icon={<Landmark className="size-4" />} title={t.houseTitle} />
          <Card className="overflow-hidden">
            <HousePanel
              lang={lang}
              stats={house}
              users={users.map((u) => ({ id: u.id, username: u.username, luckBps: u.luckBps }))}
            />
          </Card>
        </section>

        <section className="lg:col-span-2">
          <SectionTitle icon={<Users className="size-4" />} title={t.umTitle} />
          <Card className="overflow-hidden">
            <UserManager users={users} selfId={user.id} lang={lang} />
          </Card>
        </section>

        {disputed.length > 0 && (
          <section className="lg:col-span-2">
            <SectionTitle icon={<Swords className="size-4" />} title={t.duelDisputes(disputed.length)} />
            <Card className="overflow-hidden">
              <DuelAdminPanel
                lang={lang}
                items={disputed.map(({ duel: d, creatorName, opponentName }) => ({
                  id: d.id,
                  claim: d.claim,
                  stakeCents: d.stakeCents,
                  creatorId: d.creatorId,
                  opponentId: d.opponentId,
                  creatorName,
                  opponentName,
                }))}
              />
            </Card>
          </section>
        )}

        <section className="lg:col-span-2">
          <SectionTitle icon={<Radio className="size-4" />} title={t.liveMarkets(live.filter((m) => !m.parentId).length)} />
          <Card className="overflow-hidden">
            <LiveMarketList
              lang={lang}
              items={live.map((m) => ({
                id: m.id,
                slug: m.slug,
                question: m.question,
                label: m.label,
                parentId: m.parentId,
                category: m.category,
                volumeCents: m.volumeCents,
                traderCount: m.traderCount,
                closesAt: m.closesAt,
                kind: m.kind,
                noteCount: noteCounts.get(m.id) ?? 0,
                proposedOutcome: m.proposedOutcome,
                status: m.status,
              }))}
            />
          </Card>
        </section>

        {/* Tool panels — the tall market form anchors the left column while the
            three compact panels stack beside it. */}
        <section className="lg:row-span-3">
          <SectionTitle icon={<PlusCircle className="size-4" />} title={t.createMarketTitle} />
          <MarketForm isAdmin categories={categories} lang={lang} />
        </section>

        <section>
          <SectionTitle icon={<Tags className="size-4" />} title={t.categoriesTitle} />
          <Card>
            <CategoriesPanel categories={categoryRows} lang={lang} />
          </Card>
        </section>

        <section>
          <SectionTitle icon={<Users className="size-4" />} title={t.grantBalance} />
          <Card>
            <GrantPanel users={users.map((u) => ({ id: u.id, username: u.username, balanceCents: u.balanceCents }))} lang={lang} />
          </Card>
        </section>

        <section>
          <SectionTitle icon={<UserPlus className="size-4" />} title={t.umCreateUser} />
          <Card>
            <UsersPanel lang={lang} />
          </Card>
        </section>

        <section>
          <SectionTitle icon={<Spade className="size-4" />} title={t.dealersTitle} />
          <Card>
            <DealersPanel dealers={dealers} lang={lang} />
          </Card>
        </section>
      </div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="text-[14px] font-semibold mb-2.5 flex items-center gap-1.5 text-ink-2">
      {icon}
      {title}
    </h2>
  );
}
