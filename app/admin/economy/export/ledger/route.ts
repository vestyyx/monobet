// Ledger CSV export (Phase 6) — admin-only download of every Mony movement,
// oldest first so the running balance column reads like a bank statement.
import { db, schema } from "@/lib/db";
import { requireRole } from "@/lib/admin/rbac";
import { eq, asc } from "drizzle-orm";

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
      createdAt: schema.ledger.createdAt,
      username: schema.user.username,
      kind: schema.ledger.kind,
      amountCents: schema.ledger.amountCents,
      balanceAfterCents: schema.ledger.balanceAfterCents,
      memo: schema.ledger.memo,
    })
    .from(schema.ledger)
    .innerJoin(schema.user, eq(schema.ledger.userId, schema.user.id))
    .orderBy(asc(schema.ledger.createdAt));
  const lines = ["created_at,username,kind,amount,balance_after,memo"];
  for (const r of rows) {
    lines.push(
      [
        esc(new Date(r.createdAt).toISOString()),
        esc(r.username ?? ""),
        esc(r.kind),
        esc(r.amountCents),
        esc(r.balanceAfterCents),
        esc(r.memo),
      ].join(",")
    );
  }
  return new Response("\uFEFF" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="ledger.csv"',
    },
  });
}
