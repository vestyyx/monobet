// One-off: verify Phase 2.2 E2E rows — ledger money ops for panna/admtest
// (idemKey/batchId bookkeeping) and the admin_audit trail.
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

type Row = Record<string, unknown>;

(async () => {
  const users = await pool.query(
    "select id, username, balance_cents from \"user\" where username in ('panna','admtest')"
  );
  console.log("users:", JSON.stringify(users.rows));

  const ledger = await pool.query(
    `select l.amount_cents, l.balance_after_cents, l.kind, l.memo, l.idem_key, l.batch_id
     from ledger l join "user" u on u.id = l.user_id
     where u.username in ('panna','admtest') and l.kind in ('grant','deduct','adjust','reverse','refund','transfer')
     order by l.created_at desc limit 12`
  );
  console.log("ledger:");
  for (const r of ledger.rows as Row[]) console.log(" ", JSON.stringify(r));

  const audit = await pool.query(
    `select admin_name, action, target_type, target_id, reason, before, after
     from admin_audit where action like 'money.%' or action like 'user.%'
     order by created_at desc limit 10`
  );
  console.log("audit:");
  for (const r of audit.rows as Row[]) console.log(" ", JSON.stringify(r));

  await pool.end();
})();
