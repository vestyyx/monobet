// Dev check: last guess entries, fun-ledger rows, audit rows.
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const e = await pool.query(
    'select u.username, ge.value, ge.reward_cents from guess_entry ge left join "user" u on u.id = ge.user_id'
  );
  console.log("entries:", JSON.stringify(e.rows));
  const l = await pool.query(
    "select kind, amount_cents, memo from ledger where kind in ('guess','trivia') order by created_at desc limit 3"
  );
  console.log("ledger:", JSON.stringify(l.rows));
  const a = await pool.query(
    "select action, target_type, reason from admin_audit order by created_at desc limit 3"
  );
  console.log("audit:", JSON.stringify(a.rows));
  const s = await pool.query(
    'select gr.id, (select count(*)::int from guess_entry ge where ge.round_id = gr.id) as n from guess_round gr'
  );
  console.log("entrantcount:", JSON.stringify(s.rows));
  process.exit(0);
})();
