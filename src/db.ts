import pg from "pg";
import type { AppConfig, SubscriptionRow } from "./types.js";

const { Pool } = pg;

export function createPool(cfg: AppConfig): pg.Pool {
  return new Pool({
    host: cfg.pg.host,
    port: cfg.pg.port,
    database: cfg.pg.database,
    user: cfg.pg.user,
    password: cfg.pg.password,
    ssl: cfg.pg.sslmode === "disable" ? false : { rejectUnauthorized: cfg.pg.sslmode === "verify-full" },
  });
}

function logQuery(sql: string, params: unknown[]): void {
  console.log("\n--- SQL ---");
  console.log(sql.trim());
  console.log("params:", JSON.stringify(params));
  console.log("-----------");
}

export async function lookupAccountId(pool: pg.Pool, email: string): Promise<string | null> {
  const sql = `SELECT id FROM accounts WHERE "emailAssociated" = $1;`;
  logQuery(sql, [email]);
  const res = await pool.query(sql, [email]);
  return res.rows.length ? String(res.rows[0].id) : null;
}

// Schema: icloseddevdb.subscriptions (resolved via search_path). The Stripe
// subscription id is stored in the "subscriptionId" column (aliased below).
// There is no stripeCustomerId column in this schema.
const SUB_COLUMNS = `id, "accountId", status, "renewalDateTime", "deletedAt", "subscriptionId" AS "stripeSubscriptionId", "pauseCollection", "createdAt"`;

function mapRow(r: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(r.id),
    accountId: String(r.accountId),
    status: r.status === null ? null : String(r.status),
    renewalDateTime: r.renewalDateTime === null ? null : String(r.renewalDateTime),
    deletedAt: r.deletedAt === null ? null : String(r.deletedAt),
    stripeSubscriptionId: r.stripeSubscriptionId == null ? null : String(r.stripeSubscriptionId),
    stripeCustomerId: null, // not present in this schema
    pauseCollection: r.pauseCollection == null ? null : Boolean(r.pauseCollection),
    createdAt: r.createdAt === null ? null : String(r.createdAt),
  };
}

export async function fetchSubscriptions(pool: pg.Pool, accountId: string): Promise<SubscriptionRow[]> {
  const sql = `SELECT ${SUB_COLUMNS} FROM subscriptions WHERE "accountId" = $1 AND "deletedAt" IS NULL ORDER BY "createdAt" DESC;`;
  logQuery(sql, [accountId]);
  const res = await pool.query(sql, [accountId]);
  return res.rows.map(mapRow);
}

// Transactional update. `target` is either a single id or "ALL" with accountId.
export async function updateRenewal(
  pool: pg.Pool,
  target: { mode: "single"; id: string } | { mode: "all"; accountId: string },
  newRenewal: string,
): Promise<SubscriptionRow[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let sql: string;
    let params: unknown[];
    if (target.mode === "single") {
      sql = `UPDATE subscriptions SET "renewalDateTime" = $1 WHERE id = $2 RETURNING ${SUB_COLUMNS};`;
      params = [newRenewal, Number(target.id)];
    } else {
      sql = `UPDATE subscriptions SET "renewalDateTime" = $1 WHERE "accountId" = $2 AND "deletedAt" IS NULL RETURNING ${SUB_COLUMNS};`;
      params = [newRenewal, Number(target.accountId)];
    }
    logQuery(sql, params);
    const res = await client.query(sql, params);
    await client.query("COMMIT");
    return res.rows.map(mapRow);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DB update failed — ROLLBACK issued.");
    throw err;
  } finally {
    client.release();
  }
}

// Re-select updated rows to confirm persisted values.
export async function reselectByIds(pool: pg.Pool, ids: string[]): Promise<SubscriptionRow[]> {
  if (ids.length === 0) return [];
  const sql = `SELECT ${SUB_COLUMNS} FROM subscriptions WHERE id = ANY($1::int[]) ORDER BY "createdAt" DESC;`;
  const numericIds = ids.map(Number);
  logQuery(sql, [numericIds]);
  const res = await pool.query(sql, [numericIds]);
  return res.rows.map(mapRow);
}
