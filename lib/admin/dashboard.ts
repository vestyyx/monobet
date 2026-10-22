// Dashboard aggregates for /admin — cheap single-row or small-batch queries.
// All "today" cutoffs align with the app's UTC-day convention.
import { db, schema } from "@/lib/db";
import { sql, desc, eq, count } from "drizzle-orm";

export type AdminDashboard = {
  activeToday: number;
  players: number;
  supplyCents: number;
  tradesToday: number;
  jobsToday: number;
  duelsToday: number;
  pendingMarkets: number;
  disputedDuels: number;
  reportsOpen: number;
  recentLedger: {
    id: string;
    amountCents: number;
    kind: string;
    memo: string;
    username: string | null;
    createdAt: Date;
  }[];
  warnings: string[]; // plain English facts; UI localizes severity only
};

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const [core] = await db
    .select({
      activeToday: sql<number>`count(*) filter (where ${schema.user.lastSeenAt} >= date_trunc('day', now()))::int`,
      players: sql<number>`count(*)::int`,
      supplyCents: sql<number>`coalesce(sum(${schema.user.balanceCents}), 0)::bigint`,
    })
    .from(schema.user);

  const [today] = await db
    .select({
      tradesToday: sql<number>`count(*) filter (where ${schema.trade.createdAt} >= date_trunc('day', now()))::int`,
    })
    .from(schema.trade);

  const [jobs] = await db
    .select({
      jobsToday: sql<number>`count(*) filter (where ${schema.jobShift.createdAt} >= date_trunc('day', now()))::int`,
    })
    .from(schema.jobShift);

  const [duels] = await db
    .select({
      duelsToday: sql<number>`count(*) filter (where ${schema.challenge.createdAt} >= date_trunc('day', now()))::int`,
      disputed: sql<number>`count(*) filter (where ${schema.challenge.status} = 'disputed')::int`,
    })
    .from(schema.challenge);

  const [pending] = await db
    .select({ n: count() })
    .from(schema.market)
    .where(eq(schema.market.status, "pending"));

  const [reports] = await db
    .select({ n: count() })
    .from(schema.report)
    .where(eq(schema.report.status, "open"));

  const recentLedger = await db
    .select({
      id: schema.ledger.id,
      amountCents: schema.ledger.amountCents,
      kind: schema.ledger.kind,
      memo: schema.ledger.memo,
      username: schema.user.username,
      createdAt: schema.ledger.createdAt,
    })
    .from(schema.ledger)
    .leftJoin(schema.user, eq(schema.ledger.userId, schema.user.id))
    .orderBy(desc(schema.ledger.createdAt))
    .limit(14);

  const warnings: string[] = [];
  const supply = Number(core?.supplyCents ?? 0);
  if (reportsOpenNumber(reports) > 0) warnings.push(`reports:${reportsOpenNumber(reports)}`);
  if (disputedNumber(duels) > 0) warnings.push(`disputes:${disputedNumber(duels)}`);
  // Supply sanity: a huge unexplained jump would show up as abnormal supply.
  if (supply > 100_000_000) warnings.push("supply-high");

  return {
    activeToday: core?.activeToday ?? 0,
    players: core?.players ?? 0,
    supplyCents: supply,
    tradesToday: today?.tradesToday ?? 0,
    jobsToday: jobs?.jobsToday ?? 0,
    duelsToday: duels?.duelsToday ?? 0,
    pendingMarkets: Number(pending?.n ?? 0),
    disputedDuels: disputedNumber(duels),
    reportsOpen: reportsOpenNumber(reports),
    recentLedger: recentLedger.map((r) => ({
      id: r.id,
      amountCents: Number(r.amountCents),
      kind: r.kind,
      memo: r.memo,
      username: r.username,
      createdAt: r.createdAt,
    })),
    warnings,
  };
}

const reportsOpenNumber = (r?: { n: number | string }) => Number(r?.n ?? 0);
const disputedNumber = (r?: { disputed: number }) => r?.disputed ?? 0;
