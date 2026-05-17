import pg from "pg";
import { createHash } from "crypto";

const { Client } = pg;

const email = process.argv[2];

if (!email) {
  console.error("Usage: node scripts/make-admin.mjs <email>");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const result = await client.query(
  "UPDATE users SET is_admin = true WHERE email = $1 RETURNING id, username, email, is_admin",
  [email]
);

if (result.rowCount === 0) {
  console.error(`No user found with email: ${email}`);
  process.exit(1);
}

const user = result.rows[0];
console.log(`✅ Granted admin to: ${user.username} (${user.email}) [id=${user.id}]`);
await client.end();
