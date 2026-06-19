// Minimal client for the iClosed back-office API (dev-umbilling.iclosed.io),
// used to add/list a user's payment methods with their bearer token. Uses
// node:https with a scoped insecure agent because the corp TLS proxy presents an
// untrusted leaf cert that Node's fetch rejects (same workaround as pg/back-office).
import https from "node:https";

const insecureAgent = new https.Agent({ rejectUnauthorized: false });

export interface PaymentMethodCard {
  id: number;
  last4: string;
  brand?: string;
  exp_month?: number;
  exp_year?: number;
  default?: boolean;
}

function httpJson(
  method: string,
  url: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = opts.body !== undefined ? JSON.stringify(opts.body) : null;
    const req = https.request(
      url,
      {
        method,
        agent: insecureAgent,
        headers: {
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let b = "";
        res.on("data", (d) => (b += d));
        res.on("end", () => {
          let json: unknown = null;
          try { json = b ? JSON.parse(b) : null; } catch { json = b; }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export interface AddCardInput { number: string; exp_month: number; exp_year: number; cvc: string }

// POST /paymentMethods. Returns added=true on success OR when the card already
// exists (idempotent for our purposes); throws on a real failure.
export async function addPaymentMethod(baseUrl: string, token: string, card: AddCardInput): Promise<{ added: boolean; message: string }> {
  const res = await httpJson("POST", `${baseUrl}/paymentMethods`, { token, body: { ...card, type: "card" } });
  const msg = (res.json as { message?: string } | null)?.message ?? "";
  if (res.status >= 200 && res.status < 300) return { added: true, message: msg };
  if (/already added/i.test(msg)) return { added: false, message: msg }; // present already — fine
  throw new Error(`Add payment method failed (${res.status})${msg ? ": " + msg : ""}`);
}

// GET /paymentMethods → the account's cards.
export async function listPaymentMethods(baseUrl: string, token: string): Promise<PaymentMethodCard[]> {
  const res = await httpJson("GET", `${baseUrl}/paymentMethods`, { token });
  const cards = (res.json as { data?: { card?: PaymentMethodCard[] } } | null)?.data?.card;
  return Array.isArray(cards) ? cards : [];
}
