// Dev check: poll rows + votes + recent fun-ledger + audit.
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const p = await pool.query(
    'select id, left(q_cs, 30) as q, status, winning_side, reward_cents from poll_round order by created_at desc'
  );
  console.log("polls:", JSON.stringify(p.rows));
  const v = await pool.query(
    'select u.username, pv.side, pv.reward_cents from poll_vote pv left join "user" u on u.id = pv.user_id'
  );
  console.log("votes:", JSON.stringify(v.rows));
  const l = await pool.query(
    "select kind, amount_cents, memo from ledger where kind in ('poll','emoji') order by created_at desc limit 6"
  );
  console.log("ledger:", JSON.stringify(l.rows));
  const a = await pool.query(
    "select action, admin_name, reason from admin_audit where action like 'game.%' order by created_at desc limit 6"
  );
  console.log("audit:", JSON.stringify(a.rows));
  process.exit(0);
})();
