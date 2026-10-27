// Audit log writer — deliberately NOT a "use server" module: it never becomes
// a client-callable endpoint (the former placement inside a "use server" file
// would have exposed it to the network). Imported by server actions and called
// inside the SAME transaction as the change it describes. The audit log is
// append-only: no update/delete path will ever exist.
import { schema } from "@/lib/db";
import type { Tx } from "@/lib/tx-market";

export async function audit(
  tx: Tx,
  adminId: string,
  adminName: string,
  action: string,
  targetType: string,
  targetId: string,
  reason: string,
  before?: unknown,
  after?: unknown
) {
  await tx.insert(schema.adminAudit).values({
    adminId,
    adminName,
    action,
    targetType,
    targetId,
    reason,
    before: (before ?? null) as never,
    after: (after ?? null) as never,
  });
}

export type { Tx };
