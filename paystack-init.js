// Starts a Paystack payment. The secret key stays on the server (env var).
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY is not set in Vercel environment variables' });
    const { email, amount, metadata } = req.body || {};
    if (!email || !(amount > 0)) return res.status(400).json({ error: 'A valid email and amount are required' });
    const r = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, amount: Math.round(amount * 100), currency: 'GHS', callback_url: `https://${req.headers.host}/`, metadata })
    });
    const j = await r.json();
    if (!j.status) return res.status(502).json({ error: 'Paystack: ' + j.message });
    res.json({ url: j.data.authorization_url, reference: j.data.reference });
  } catch (e) {
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
}
