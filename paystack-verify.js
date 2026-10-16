// Confirms a payment with Paystack before the site marks anything as paid.
export default async function handler(req, res) {
  try {
    const ref = req.query.reference;
    if (!ref) return res.status(400).json({ error: 'reference required' });
    if (!process.env.PAYSTACK_SECRET_KEY) return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY is not set in Vercel' });
    const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` }
    });
    const j = await r.json();
    if (!j.status) return res.status(502).json({ error: 'Paystack: ' + j.message });
    res.json({ paid: j.data?.status === 'success' && j.data?.currency === 'GHS', amount: (j.data?.amount || 0) / 100, reference: ref });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
