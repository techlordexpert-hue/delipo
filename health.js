// Tells the site owner which server settings exist and whether the database answers. Never returns secret values.
// ---- Redis (Upstash / Vercel KV) settings, found even if Vercel added a custom prefix to the names
const find = (re) => { for (const k of Object.keys(process.env)) if (re.test(k) && process.env[k]) return process.env[k]; return ''; };
const dbUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || find(/KV_REST_API_URL$/) || find(/UPSTASH_REDIS_REST_URL$/);
const dbToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || find(/(^|_)KV_REST_API_TOKEN$/) || find(/UPSTASH_REDIS_REST_TOKEN$/);

export default async function handler(req, res) {
  const e = process.env, url = dbUrl(), token = dbToken();
  let reachable = false, dbError = '';
  if (url && token) {
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify([['PING']]) });
      const j = await r.json();
      if (Array.isArray(j) && j[0] && j[0].result === 'PONG') reachable = true;
      else dbError = String((j && (j.error || (j[0] && j[0].error))) || 'Unexpected reply').slice(0, 120);
    } catch (err) { dbError = String((err && err.message) || err).slice(0, 120); }
  }
  res.json({
    functions: true,
    version: 'v13',
    dbConfigured: !!(url && token),
    database: reachable,
    dbError,
    paystackSecret: !!e.PAYSTACK_SECRET_KEY,
    paystackLive: (e.PAYSTACK_SECRET_KEY || '').startsWith('sk_live_'),
    adminLogin: !!(e.ADMIN_PASSWORD || e.ADMIN_KEY),
    adminKey: !!e.ADMIN_KEY,
    sms: !!(e.SMS_API_KEY && e.SMS_API_URL)
  });
}
