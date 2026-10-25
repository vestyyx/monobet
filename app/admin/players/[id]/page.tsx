import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { requireRole } from "@/lib/admin/rbac";
import { getLang } from "@/lib/lang-server";
import { getT } from "@/lib/i18n";
import { db, schema } from "@/lib/db";
import { PlayerAdjustPanel, type AdminPlayerRow } from "@/components/admin/money-panels";
import { ADMIN_LEDGER_KINDS } from "@/lib/admin-money";
import { Avatar, Badge, Card, Select } from "@/components/ui/primitives";
import { fmtMonos, timeAgo } from "@/lib/money";
import { parseRole } from "@/lib/admin/rbac";

export const dynamic = "force-dynamic";

function kindBadgeLabel(t: ReturnType<typeof getT>, kind: string): string {
  switch (kind) {
    case "grant":
      return t.admMoneyOpGrant;
    case "deduct":
      return t.kindDeduct;
    case "adjust":
      return t.kindAdjust;
    case "reverse":
      return t.kindReverse;
    case "refund":
      return t.kindRefund;
    case "transfer":
      return t.kindTransfer;
    case "claim":
      return t.kindClaim;
    default:
      return kind;
  }
}

// Player detail (Phase 2.2) — profile, adjust + freeze island, filterable
// transaction history, positions. Reached from the money desk or audit log.
export default async function AdminPlayerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ kind?: string }>;
}) {
  const admin = await requireRole("admin");
  if (!admin) redirect("/login");
  const { id } = await params;
  const { kind } = await searchParams;
  const lang = await getLang();
  const t = getT(lang);

  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, id)).limit(1);
  if (!u) notFound();

  // filterable ledger (GET form keeps it JS-free)
  const conds = [eq(schema.ledger.userId, id)];
  if (kind) conds.push(eq(schema.ledger.kind, kind));
  const ledger = await db
    .select()
    .from(schema.ledger)
    .where(and(...conds))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(100); // server keeps the cap honest; the u/ profile shows more

  const kinds = await db
    .select({ k: schema.ledger.kind })
    .from(schema.ledger)
    .where(eq(schema.ledger.userId, id))
    .groupBy(schema.ledger.kind);
  const kindList = [...new Set([...kinds.map((r) => r.k), ...ADMIN_LEDGER_KINDS])].sort();

  const positions = await db
    .select({
      id: schema.trade.id,
      side: schema.trade.side,
      outcome: schema.trade.outcome,
      shares: schema.trade.shares,
      amountCents: schema.trade.amountCents,
      createdAt: schema.trade.createdAt,
      question: schema.market.question,
      slug: schema.market.slug,
      status: schema.market.status,
    })
    .from(schema.trade)
    .innerJoin(schema.market, eq(schema.market.id, schema.trade.marketId))
    .where(eq(schema.trade.userId, id))
    .orderBy(desc(schema.trade.createdAt))
    .limit(20);

  const squad = u.squadId
    ? (await db.select({ name: schema.squad.name }).from(schema.squad).where(eq(schema.squad.id, u.squadId)).limit(1))[0]
    : null;

  const p: AdminPlayerRow = {
    id: u.id,
    username: u.username ?? id.slice(0, 8),
    name: u.name ?? "?",
    role: u.role ?? "user",
    balanceCents: u.balanceCents,
    frozenAt: u.frozenAt ? new Date(u.frozenAt).toISOString() : null,
    squadId: u.squadId ?? null,
    squadName: null,
  };
  const role = parseRole(u.role);

  return (
    <div className="py-2">
      <h1 className="text-[20px] font-bold tracking-tight">
        {t.admPlayerTitle}: {u.name} <span className="text-mute">@{p.username}</span>
      </h1>
      <p className="text-[12.5px] text-mute mt-0.5 mb-5">
        <Link href="/admin/money" className="text-brand hover:underline">
          ← {t.admMoneyTitle}
        </Link>
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="flex items-center gap-3 mb-3">
            <Avatar name={u.name ?? "?"} image={u.image ?? null} className="size-10" />
            <div className="min-w-0">
              <div className="text-[14px] font-semibold">{u.name}</div>
              <div className="text-[12px] text-mute">@{p.username} · {t.admPlayerJoined}: {new Date(u.createdAt).toLocaleDateString()}</div>
            </div>
            {u.frozenAt && <Badge tone="warn">{t.admMoneyFrozenBadge}</Badge>}
          </div>
          <dl className="text-[13px] grid gap-1.5">
            <div className="flex justify-between">
              <dt className="text-mute">{t.admPlayerRole}</dt>
              <dd className="font-medium">
                <Badge tone={role === "owner" ? "yes" : role === "admin" ? "warn" : role === "moderator" ? "ink" : "mute"}>
                  {role}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">{t.admPlayerBalance}</dt>
              <dd className="font-medium">{fmtMonos(u.balanceCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-mute">{t.admPlayerStreak}</dt>
              <dd>{u.claimStreak} 🔥</dd>
            </div>
            {squad && (
              <div className="flex justify-between">
                <dt className="text-mute">{t.admPlayerSquad}</dt>
                <dd>{squad.name}</dd>
              </div>
            )}
          </dl>
        </Card>

        <PlayerAdjustPanel lang={lang} player={p} />

        <Card className="p-5 lg:col-span-2 overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <h2 className="font-semibold text-[15px]">{t.admPlayerLedger}</h2>
            <form method="get">
              <Select name="kind" defaultValue={kind ?? ""}>
                <option value="">{t.admPlayerAllKinds}</option>
                {kindList.map((k) => (
                  <option key={k} value={k}>
                    {kindBadgeLabel(t, k)}
                  </option>
                ))}
              </Select>
              <button type="submit" className="sr-only">ok</button>
            </form>
          </div>
          {ledger.length === 0 ? (
            <p className="text-[13px] text-mute">{t.admMoneyNothing}</p>
          ) : (
            <div className="divide-y divide-line-2 max-h-[420px] overflow-y-auto">
              {ledger.map((l) => (
                <div key={l.id} className="py-2 flex items-center gap-2.5">
                  <Badge tone={l.amountCents >= 0 ? "yes" : "no"}>{kindBadgeLabel(t, l.kind)}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] truncate">
                      {fmtMonos(l.amountCents)} <span className="text-mute">→ {fmtMonos(l.balanceAfterCents)}</span>
                    </div>
                    <div className="text-[11px] text-mute truncate">{l.memo}</div>
                  </div>
                  <span className="text-[11px] text-mute shrink-0">{timeAgo(l.createdAt, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5 lg:col-span-2 overflow-hidden">
          <h2 className="font-semibold text-[15px] mb-3">{t.admPlayerPositions}</h2>
          {positions.length === 0 ? (
            <p className="text-[13px] text-mute">{t.admPlayerNoPositions}</p>
          ) : (
            <div className="divide-y divide-line-2">
              {positions.map((s) => (
                <div key={s.id} className="py-2 flex items-center gap-2.5">
                  <Badge tone={s.side === "buy" ? "yes" : "mute"}>{s.side}</Badge>
                  <div className="min-w-0 flex-1">
                    <a href={`/market/${s.slug}`} className="text-[12.5px] truncate hover:underline block">
                      {s.question}
                    </a>
                    <div className="text-[11px] text-mute">
                      {String(s.shares)} · {fmtMonos(s.amountCents)}
                    </div>
                  </div>
                  <span className="text-[11px] text-mute shrink-0">{timeAgo(s.createdAt, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
