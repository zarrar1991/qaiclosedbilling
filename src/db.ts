import pg from "pg";
import type { AppConfig, SubscriptionRow, Campaign } from "./types.js";

const { Pool } = pg;

// Return "timestamp without time zone" (OID 1114) columns as their raw stored
// string instead of a local-time JS Date, so renewal/createdAt values are shown
// and compared exactly as stored (the app treats these as UTC wall-clock).
pg.types.setTypeParser(1114, (v) => v);

export function createPool(cfg: AppConfig): pg.Pool {
  return new Pool({
    host: cfg.pg.host,
    port: cfg.pg.port,
    database: cfg.pg.database,
    user: cfg.pg.user,
    password: cfg.pg.password,
    ssl: cfg.pg.sslmode === "disable" ? false : { rejectUnauthorized: cfg.pg.sslmode === "verify-full" },
    // Force the schema's search_path when PGSCHEMA is set; otherwise use the
    // DB role's default search_path. Applied at connection startup.
    ...(cfg.pg.schema ? { options: `-c search_path=${cfg.pg.schema},public` } : {}),
  });
}

function logQuery(sql: string, params: unknown[]): void {
  console.log("\n--- SQL ---");
  console.log(sql.trim());
  console.log("params:", JSON.stringify(params));
  console.log("-----------");
}

// All non-deleted campaigns (id + name) for the campaigns dropdown, latest first.
export async function fetchCampaigns(pool: pg.Pool): Promise<Campaign[]> {
  const sql = `SELECT id, name FROM campaigns WHERE "deletedAt" IS NULL ORDER BY "createdAt" DESC;`;
  logQuery(sql, []);
  const res = await pool.query(sql);
  return res.rows.map((r) => ({ id: Number(r.id), name: String(r.name) }));
}

export async function lookupAccountId(pool: pg.Pool, email: string): Promise<string | null> {
  const sql = `SELECT id FROM accounts WHERE "emailAssociated" = $1;`;
  logQuery(sql, [email]);
  const res = await pool.query(sql, [email]);
  return res.rows.length ? String(res.rows[0].id) : null;
}

export async function lookupUserId(pool: pg.Pool, email: string): Promise<string | null> {
  const sql = `SELECT id FROM users WHERE email = $1;`;
  logQuery(sql, [email]);
  const res = await pool.query(sql, [email]);
  return res.rows.length ? String(res.rows[0].id) : null;
}

// Insert a payment method row. Only the four columns below are set; id,
// createdAt and updatedAt are auto-populated by the DB and deletedAt defaults NULL.
export async function insertPaymentMethod(
  pool: pg.Pool,
  values: { accountId: string; userId: string; stripePaymentMethodId: string; type?: string },
): Promise<string> {
  const sql = `INSERT INTO payment_methods ("accountId","userId","stripePaymentMethodId","type")
    VALUES ($1,$2,$3,$4) RETURNING id;`;
  const params = [Number(values.accountId), Number(values.userId), values.stripePaymentMethodId, values.type ?? "card"];
  logQuery(sql, params);
  const res = await pool.query(sql, params);
  return String(res.rows[0].id);
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

// Like fetchSubscriptions but includes DELETED rows (deletedAt set) — used by the
// read-only search/view table. Never used as an update target.
export async function fetchAllSubscriptions(pool: pg.Pool, accountId: string): Promise<SubscriptionRow[]> {
  const sql = `SELECT ${SUB_COLUMNS} FROM subscriptions WHERE "accountId" = $1 ORDER BY "createdAt" DESC;`;
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
