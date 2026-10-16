// Admin bulk SMS proxy. The provider is configured with Vercel environment variables (see README).
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    const { key, to, message } = req.body || {};
    const env = process.env;
    if (!key || !env.ADMIN_KEY || norm(key) !== norm(env.ADMIN_KEY)) return res.status(401).json({ error: 'Wrong server key' });
    if (!Array.isArray(to) || !to.length || !message) return res.status(400).json({ error: 'Recipients and a message are required' });
    if (!env.SMS_API_URL || !env.SMS_API_KEY) return res.status(500).json({ error: 'SMS_API_URL and SMS_API_KEY are not set in Vercel' });
    const intl = (n) => { n = String(n).replace(/[^\d+]/g, ''); if (n.startsWith('+')) return n.slice(1); if (n.startsWith('0')) return '233' + n.slice(1); return n; };
    const nums = [...new Set(to.map(intl).filter((n) => n.length >= 9))];
    if (!nums.length) return res.status(400).json({ error: 'No valid phone numbers found' });
    const f = {
      [env.SMS_KEY_FIELD || 'apikey']: env.SMS_API_KEY,
      [env.SMS_SENDER_FIELD || 'sender']: env.SMS_SENDER || 'Delipo',
      [env.SMS_TO_FIELD || 'to']: nums.join(','),
      [env.SMS_MSG_FIELD || 'message']: message
    };
    const method = (env.SMS_METHOD || 'POST_JSON').toUpperCase();
    const headers = {};
    if (env.SMS_AUTH_HEADER) headers.Authorization = env.SMS_AUTH_HEADER.replace('{key}', env.SMS_API_KEY);
    let r;
    if (method === 'GET') r = await fetch(env.SMS_API_URL + (env.SMS_API_URL.includes('?') ? '&' : '?') + new URLSearchParams(f), { headers });
    else if (method === 'POST_FORM') r = await fetch(env.SMS_API_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f) });
    else r = await fetch(env.SMS_API_URL, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const text = (await r.text()).slice(0, 300);
    if (!r.ok) return res.status(502).json({ error: `Provider replied ${r.status}: ${text}` });
    res.json({ sent: nums.length, response: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
