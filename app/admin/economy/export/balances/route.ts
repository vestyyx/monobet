// Balances CSV export (Phase 6) — admin-only roster snapshot: who, role,
// stored balance and their book sum from the ledger, so the recon drift is
// visible straight in a spreadsheet.
import { db, schema } from "@/lib/db";
import { requireRole } from "@/lib/admin/rbac";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

function esc(v: string | number | null): string {
  const s = String(v ?? "");
  return /^["=+\-;]|,|"/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET() {
  const admin = await requireRole("admin");
  if (!admin) return new Response("Forbidden", { status: 403 });
  const rows = await db
    .select({
      username: schema.user.username,
      name: schema.user.name,
      role: schema.user.role,
      balanceCents: schema.user.balanceCents,
      ledgerSumCents: sql<number>`coalesce((select sum(l.amount_cents) from ledger l where l.user_id = "user".id), 0)::bigint`,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(schema.user.username);
  const lines = ["username,name,role,balance,ledger_sum,drift,joined"];
  for (const r of rows) {
    const bal = Number(r.balanceCents);
    const led = Number(r.ledgerSumCents);
    lines.push(
      [
        esc(r.username ?? ""),
        esc(r.name ?? ""),
        esc(r.role ?? "user"),
        esc(bal),
        esc(led),
        esc(led - bal),
        esc(new Date(r.createdAt).toISOString().slice(0, 10)),
      ].join(",")
    );
  }
  return new Response("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="balances.csv"',
    },
  });
}
