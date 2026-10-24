// Dev check: full vote rows + users list.
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const u = await pool.query('select username, email, role from "user" order by created_at');
  console.log("users:", JSON.stringify(u.rows));
  const v = await pool.query("select poll_id, left(user_id::text, 8) as uid, side from poll_vote");
  console.log("votesraw:", JSON.stringify(v.rows));
  process.exit(0);
})();
