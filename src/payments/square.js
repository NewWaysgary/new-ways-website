// Square (payments). Customers pay on Square's own secure checkout page; this site never sees card details.
// The secrets are Cloudflare secrets, never in GitHub or the browser:
//   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_WEBHOOK_SIGNATURE_KEY
// SQUARE_ENVIRONMENT chooses Sandbox (test money, the default) or Production (real money). Production is only used
// when it is set to exactly "production", so nothing can take real payments by accident.
const SQUARE_VERSION = '2026-09-16';
const BASES = { sandbox: 'https://connect.squareupsandbox.com', production: 'https://connect.squareup.com' };

// A local stand-in address is only ever honoured when it points at this computer (it can't reach anything on Cloudflare).
const isLocal = (u) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(String(u || ''));

export function squareMode(env) {
  return String(env.SQUARE_ENVIRONMENT || '').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
}

export function squareConfig(env) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) return null;
  const mode = squareMode(env);
  return {
    mode,
    base: isLocal(env.SQUARE_API_BASE) ? String(env.SQUARE_API_BASE).replace(/\/+$/, '') : BASES[mode],
    token: String(env.SQUARE_ACCESS_TOKEN).trim(),
    locationId: String(env.SQUARE_LOCATION_ID).trim(),
    signatureKey: env.SQUARE_WEBHOOK_SIGNATURE_KEY ? String(env.SQUARE_WEBHOOK_SIGNATURE_KEY).trim() : ''
  };
}

export class SquareError extends Error {
  constructor(message, status = 0, detail = '') { super(message); this.status = status; this.detail = detail; }
}

async function call(cfg, method, path, body) {
  let res;
  try {
    res = await fetch(cfg.base + path, {
      method,
      headers: { Authorization: 'Bearer ' + cfg.token, 'Square-Version': SQUARE_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (err) {
    throw new SquareError('Square could not be reached', 0, String(err && err.message));
  }
  let data = {};
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const detail = (data.errors || []).map((e) => `${e.code || ''} ${e.detail || ''}`.trim()).join('; ');
    throw new SquareError(`Square answered ${res.status}`, res.status, detail);
  }
  return data;
}

// A one-off checkout page for one order. The amount comes from OUR database, never from the customer's browser.
export async function createPaymentLink(cfg, { reference, itemName, amountPence, redirectUrl, buyerEmail, idempotencyKey }) {
  const data = await call(cfg, 'POST', '/v2/online-checkout/payment-links', {
    idempotency_key: idempotencyKey,
    order: {
      location_id: cfg.locationId,
      reference_id: reference,
      line_items: [{ name: itemName.slice(0, 500), quantity: '1', base_price_money: { amount: amountPence, currency: 'GBP' } }]
    },
    checkout_options: { redirect_url: redirectUrl, ask_for_shipping_address: false },
    pre_populated_data: buyerEmail ? { buyer_email: buyerEmail } : undefined,
    payment_note: `New Way’s ${reference}`
  });
  const link = data.payment_link || {};
  if (!link.id || !link.url || !link.order_id) throw new SquareError('Square did not return a payment link');
  return { id: link.id, url: link.url, orderId: link.order_id };
}

// So a payment can't be started after a hold has run out. A link that is already gone is fine.
export async function deletePaymentLink(cfg, id) {
  if (!id) return;
  try { await call(cfg, 'DELETE', '/v2/online-checkout/payment-links/' + encodeURIComponent(id)); }
  catch (err) { if (err.status !== 404) throw err; }
}

// Asks Square directly whether an order has been paid. Returns the completed payment, or null.
export async function paidPaymentForOrder(cfg, squareOrderId) {
  const { order } = await call(cfg, 'GET', '/v2/orders/' + encodeURIComponent(squareOrderId));
  for (const t of (order && order.tenders) || []) {
    if (!t.payment_id) continue;
    const { payment } = await call(cfg, 'GET', '/v2/payments/' + encodeURIComponent(t.payment_id));
    if (payment && payment.status === 'COMPLETED') return payment;
  }
  return null;
}

// Webhook check: base64(HMAC-SHA256(signature key, notification URL + raw body)), compared in constant time.
export async function verifyWebhook(signatureKey, notificationUrl, rawBody, signature) {
  if (!signatureKey || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(signatureKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(notificationUrl + rawBody)));
  const expected = btoa(String.fromCharCode(...mac));
  const a = new TextEncoder().encode(expected), b = new TextEncoder().encode(String(signature).trim());
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i] ?? 0);
  return diff === 0;
}
