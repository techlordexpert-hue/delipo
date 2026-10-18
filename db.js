// Delipo shared backend: accounts, stores, products, orders, chats, reviews and settings.
// Data lives in Redis (Upstash, added from the Vercel Storage tab). Every rule is enforced here on the server.
import crypto from 'node:crypto';

// ---- Redis (Upstash / Vercel KV) settings, found even if Vercel added a custom prefix to the names
const find = (re) => { for (const k of Object.keys(process.env)) if (re.test(k) && process.env[k]) return process.env[k]; return ''; };
const dbUrl = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || find(/KV_REST_API_URL$/) || find(/UPSTASH_REDIS_REST_URL$/);
const dbToken = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || find(/(^|_)KV_REST_API_TOKEN$/) || find(/UPSTASH_REDIS_REST_TOKEN$/);
const COLS = ['users', 'stores', 'products', 'orders', 'msgs', 'reviews', 'notifs'];
const VERSION = 'v13';
const ORD = ['Paid', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Suspended', 'Refunded'];
const HOLD = ['Suspended', 'Refunded'];

const R = async (cmds) => {
  const r = await fetch(dbUrl().replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + dbToken(), 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds)
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('Database error');
  return j.map((x) => { if (x.error) throw new Error('Database: ' + x.error); return x.result; });
};
const R1 = async (c) => (await R([c]))[0];
const flat = (a) => { const o = {}; for (let i = 0; i < (a || []).length; i += 2) o[a[i]] = JSON.parse(a[i + 1]); return o; };

const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const clean = (s, n = 60) => String(s == null ? '' : s).replace(/[<>&`\\]/g, '').replace(/["']/g, '’').trim().slice(0, n);
const idOk = (x) => /^[a-z0-9]{2,16}$/i.test(String(x || ''));
const emOk = (e) => /^[^\s@<>"'`&\\]+@[^\s@<>"'`&\\]+\.[^\s@<>"'`&\\]+$/.test(e) && e.length <= 80;
const ph = (s) => String(s || '').replace(/[^\d+\- ]/g, '').slice(0, 20);
const imgOk = (s) => typeof s === 'string' && s.length <= 90000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
const bnImgOk = (s) => typeof s === 'string' && s.length <= 160000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s);
const num = (x, lo, hi) => { x = Number(x); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
const rid = () => crypto.randomBytes(5).toString('hex').slice(0, 8);
const hashPw = (p, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, h: crypto.scryptSync(String(p), salt, 32).toString('hex') });
const okPw = (p, r) => {
  if (!r) return false;
  const a = Buffer.from(crypto.scryptSync(String(p), r.salt, 32).toString('hex')), b = Buffer.from(r.h);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const newSess = async (v, ttl = 2592000) => { const t = crypto.randomBytes(24).toString('hex'); await R1(['SET', 's:' + t, JSON.stringify(v), 'EX', ttl]); return t; };
const ipOf = (req) => String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim();
const audit = async (ev, req) => { try { await R([['LPUSH', 'audit', JSON.stringify({ t: Date.now(), ev, ip: req ? ipOf(req) : '' })], ['LTRIM', 'audit', 0, 499]]); } catch (e) { /* never block on logging */ } };
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const lockStock = async () => { for (let i = 0; i < 8; i++) { if (await R1(['SET', 'lock:stock', '1', 'NX', 'EX', 10])) return true; await new Promise((r) => setTimeout(r, 200)); } throw new Error('The shop is busy. Please try again in a moment.'); };
const DAY = 864e5;
const monday = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.getTime(); };
// Weekly top sellers: ranked by deliveries CONFIRMED by a delivery company (real completed sales), verified + active stores only.
const weekCalc = (db, cfg, which) => {
  const start = monday(Date.now()) - (which === 'this' ? 0 : 7 * DAY), end = start + 7 * DAY, tot = {};
  for (const o of Object.values(db.orders)) {
    if (o.rent || !o.delivery || o.delivery.st !== 'Delivered') continue;
    const t = o.delivery.td || 0; if (t < start || t >= end) continue;
    for (const i of o.items || []) { const p = db.products[i.id]; if (!p) continue; const a = (tot[p.store] = tot[p.store] || { sales: 0, o: new Set() }); a.sales += (i.p != null ? i.p : p.price) * i.q; a.o.add(o.id); }
  }
  const n = (cfg.set && cfg.set.topN) || 5, fmt = (t) => new Date(t).toISOString().slice(0, 10);
  const list = Object.entries(tot).filter(([sid]) => db.stores[sid] && db.stores[sid].active && db.stores[sid].verified).map(([sid, a]) => ({ store: sid, name: db.stores[sid].name, sales: Math.round(a.sales * 100) / 100, orders: a.o.size })).sort((x, y) => y.sales - x.sales).slice(0, n);
  return { id: fmt(start), label: fmt(start) + ' to ' + fmt(end - 1), list };
};
const who = async (t) => { if (!t || typeof t !== 'string' || t.length > 80) return null; const v = await R1(['GET', 's:' + t]); return v ? JSON.parse(v) : null; };
const limit = async (req, k, max) => {
  const ip = String(req.headers['x-forwarded-for'] || 'x').split(',')[0].trim(), key = `rl:${k}:${ip}`;
  const n = await R1(['INCR', key]); if (n === 1) await R1(['EXPIRE', key, 900]);
  return n <= max;
};
const getCfg = async () => { const v = await R1(['GET', 'cfg']); return v ? JSON.parse(v) : {}; };
const adminUser = () => norm(process.env.ADMIN_USER || 'yo!');
const adminOk = (u, p, cfg) => {
  const e = process.env, key = e.ADMIN_KEY ? norm(e.ADMIN_KEY) : null;
  if (key && (eq(norm(u), key) || eq(norm(p), key) || eq(norm(String(u) + String(p)), key))) return 'key'; // master key from Vercel
  if (cfg.admin) return norm(u) === cfg.admin.u && okPw(p, cfg.admin.pw) ? 'password' : false;
  return !!e.ADMIN_PASSWORD && norm(u) === adminUser() && eq(p, e.ADMIN_PASSWORD) ? 'password' : false;
};
const strong = (p) => p.length >= 10 && /[a-z]/i.test(p) && /\d/.test(p) && /[^a-z0-9]/i.test(p);
const paystack = async (ref) => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new Error('Payments are not configured on the server');
  const r = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(ref), { headers: { Authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY } });
  const j = await r.json();
  return j.status ? j.data : null;
};

// Flags chat messages that look like moving a deal outside Delipo (the admin reviews these).
const scan = (t) => {
  const s = String(t).toLowerCase(), f = [];
  if (/(\+?\d[\s-]?){9,}/.test(s)) f.push('phone number');
  if (/\b(momo|mobile money|mtn|vodafone cash|airteltigo|airtel tigo)\b/.test(s)) f.push('mobile money');
  if (/\b(whatsapp|telegram|call me|text me|dm me|inbox me)\b/.test(s)) f.push('moving off platform');
  if (/\b(pay (me )?(direct|directly|outside|cash)|outside (delipo|the app|the site)|send money|bank (account|transfer)|account number|western union)\b/.test(s)) f.push('payment outside Delipo');
  if (/https?:\/\/|www\./.test(s)) f.push('link');
  if (/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/.test(s)) f.push('email address');
  return f;
};

export default async function handler(req, res) {
  const send = (c, o) => res.status(c).json(o);
  try {
    if (!dbUrl() || !dbToken()) return send(503, { error: 'db_not_configured' });
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    // only our own website may talk to this server, and only with JSON
    const org = req.headers.origin;
    if (org) { try { if (new URL(org).host !== req.headers.host) return send(403, { error: 'Blocked' }); } catch (e) { return send(403, { error: 'Blocked' }); } }
    if (!/application\/json/i.test(req.headers['content-type'] || '')) return send(415, { error: 'Unsupported request' });
    const b = req.body || {}, a = b.a;
    if (a === 'ping') { await R1(['PING']); return send(200, { ok: true, v: VERSION }); }
    if (a === 'ver') return send(200, { v: (await R1(['GET', 'ver'])) || '0' });

    if (a === 'register') {
      if (!(await limit(req, 'reg', 15))) return send(429, { error: 'Too many attempts. Try again later.' });
      const name = clean(b.name, 50), email = String(b.email || '').trim().toLowerCase(), pass = String(b.pass || '');
      if (!name || !emOk(email) || pass.length < 6 || pass.length > 100) return send(400, { error: 'Enter your name, a valid email and a password of at least 6 characters' });
      if (norm(email) === adminUser()) return send(409, { error: 'That email is not available' });
      const id = 'u' + rid();
      if (!(await R1(['HSETNX', 'uidx', email, id]))) return send(409, { error: 'That email already has an account' });
      await R1(['HSET', 'users', id, JSON.stringify({ id, name, email, phone: ph(b.phone), active: true, created: Date.now(), pw: hashPw(pass) })]);
      await R1(['INCR', 'ver']);
      return send(200, { token: await newSess({ uid: id }), uid: id });
    }
    if (a === 'login') {
      if (!(await limit(req, 'login', 20))) return send(429, { error: 'Too many attempts. Try again later.' });
      const email = String(b.email || '').trim().toLowerCase(), id = await R1(['HGET', 'uidx', email]);
      const raw = id && (await R1(['HGET', 'users', id])), u = raw && JSON.parse(raw);
      const lk = 'rl:acct:' + email;
      if ((+(await R1(['GET', lk])) || 0) >= 8) return send(429, { error: 'This account is locked for 15 minutes after too many wrong passwords.' });
      if (!u || !okPw(b.pass, u.pw)) { const n = await R1(['INCR', lk]); if (n === 1) await R1(['EXPIRE', lk, 900]); return send(401, { error: 'Wrong email or password' }); }
      await R1(['DEL', lk]);
      if (!u.active) return send(403, { error: 'This account has been terminated' });
      return send(200, { token: await newSess({ uid: id }), uid: id });
    }
    if (a === 'adminlogin') {
      if (!(await limit(req, 'adm', 10))) return send(429, { error: 'Too many attempts. Try again later.' });
      const via = adminOk(b.u, b.p, await getCfg());
      if (!via) { await audit('Admin login FAILED', req); return send(401, { error: 'Wrong details', v: VERSION }); }
      await audit('Admin login (' + via + ')', req);
      return send(200, { token: await newSess({ admin: true }, 28800) });
    }
    if (a === 'logout') { if (typeof b.tk === 'string') await R1(['DEL', 's:' + b.tk]); return send(200, { ok: true }); }

    const w = await who(b.tk);
    if (!w) return send(401, { error: 'Please log in again' });

    if (a === 'adminpw') {
      if (!w.admin) return send(403, { error: 'Administrators only' });
      const cfg = await getCfg(), cu = cfg.admin ? cfg.admin.u : adminUser();
      if (!adminOk(cu, b.cur, cfg)) { await audit('Admin password change REFUSED (wrong current password)', req); return send(401, { error: 'Current password is wrong' }); }
      const u = norm(b.u), p = String(b.p || '');
      if (u.length < 2 || !strong(p)) return send(400, { error: 'Use a username and a password of at least 10 characters with letters, numbers and a symbol' });
      cfg.admin = { u, pw: hashPw(p) };
      await R1(['SET', 'cfg', JSON.stringify(cfg)]);
      await audit('Admin login changed', req);
      return send(200, { ok: true });
    }

    const data = await R([['GET', 'ver']].concat(COLS.map((c) => ['HGETALL', c]), [['GET', 'cfg']]));
    const db = {}; COLS.forEach((c, i) => { db[c] = flat(data[i + 1]); });
    const cfg = data[COLS.length + 1] ? JSON.parse(data[COLS.length + 1]) : {};
    const strip = (u) => { const { pw, ...r } = u; return r; };
    const cmds = [];
    const put = (c, o) => { db[c][o.id] = o; cmds.push(['HSET', c, o.id, JSON.stringify(o)]); };
    const del = (c, id) => { delete db[c][id]; cmds.push(['HDEL', c, id]); };
    const notify = (uid, title, text) => put('notifs', { id: 'n' + rid(), to: uid, title: clean(title, 80), text: clean(text, 300), t: Date.now(), read: false });
    const commit = async () => { if (cmds.length) await R(cmds.concat([['INCR', 'ver']])); };
    const myStores = () => Object.values(db.stores).filter((s) => s.owner === w.uid).map((s) => s.id);

    if (a === 'state') {
      const common = { stores: Object.values(db.stores), products: Object.values(db.products), reviews: Object.values(db.reviews), notes: cfg.notes || [], set: cfg.set || null, banners: cfg.banners || [], top: cfg.top || null, v: data[0] || '0' };
      if (w.admin) {
        const au = (await R1(['LRANGE', 'audit', 0, 59])) || [];
        return send(200, { ...common, users: Object.values(db.users).map(strip), orders: Object.values(db.orders), msgs: Object.values(db.msgs), notifs: [], audit: au.map((x) => { try { return JSON.parse(x); } catch (e) { return {}; } }), adm: { u: cfg.admin ? cfg.admin.u : adminUser() } });
      }
      const me = db.users[w.uid];
      if (!me || !me.active) return send(401, { error: 'Please log in again' });
      const mine = Object.values(db.notifs).filter((n) => n.to === w.uid).sort((x, y) => y.t - x.t).slice(0, 30);
      if (me.role === 'courier') { // delivery companies see only their own assigned deliveries, never a customer's code
        const ord = Object.values(db.orders).filter((o) => o.delivery && o.delivery.co === w.uid).map((o) => {
          const { pin, pay, ...r } = o;
          const sts = [...new Set((o.items || []).map((i) => db.products[i.id] && db.products[i.id].store).filter(Boolean))].map((sid) => ({ name: db.stores[sid] ? db.stores[sid].name : '?', phone: db.stores[sid] && db.users[db.stores[sid].owner] ? db.users[db.stores[sid].owner].phone : '' }));
          return { ...r, cd: { buyer: db.users[o.user] ? db.users[o.user].name : '', stores: sts, items: (o.items || []).map((i) => ({ name: db.products[i.id] ? db.products[i.id].name : 'Item', q: i.q })) } };
        });
        return send(200, { stores: [], products: [], reviews: [], notes: [], banners: [], set: null, top: null, v: data[0] || '0', me: me.id, users: [strip(me)], orders: ord, msgs: [], notifs: mine });
      }
      const ids = new Set(myStores()), ord = [];
      for (const o of Object.values(db.orders)) {
        if (o.user === w.uid) ord.push(o);
        else if (!o.rent && (o.items || []).some((i) => db.products[i.id] && ids.has(db.products[i.id].store))) {
          const { pin, ...r } = o; // a customer's delivery code is never shown to sellers
          ord.push({ ...r, items: o.items.filter((i) => db.products[i.id] && ids.has(db.products[i.id].store)), pay: Object.fromEntries(Object.entries(o.pay || {}).filter(([sid]) => ids.has(sid))), seller: true });
        }
      }
      return send(200, { ...common, me: me.id, users: [strip(me)], orders: ord, msgs: Object.values(db.msgs).filter((m) => m.buyer === w.uid || ids.has(m.store)), notifs: mine });
    }

    if (a === 'ops') {
      const ops = Array.isArray(b.ops) ? b.ops.slice(0, 200) : [], rej = [];
      for (const op of ops) {
        const { c, id, d = {} } = op || {};
        try {
          if (!COLS.includes(c) && c !== 'cfg') throw new Error('Unknown data');
          if (c !== 'cfg' && !idOk(id)) throw new Error('Bad id');
          if (c === 'users') {
            const ex = db.users[id];
            if (op.del) {
              if (!w.admin) throw new Error('Only the administrator can delete accounts');
              if (ex) {
                Object.values(db.stores).filter((s) => s.owner === id).forEach((s) => { Object.values(db.products).filter((p) => p.store === s.id).forEach((p) => del('products', p.id)); del('stores', s.id); });
                del('users', id); cmds.push(['HDEL', 'uidx', ex.email]);
              }
              continue;
            }
            if (!w.admin && (id !== w.uid || !ex)) throw new Error('Not allowed');
            const n = ex ? { ...ex } : { id, active: true, created: Date.now() };
            if (d.name != null) { const v = clean(d.name, 50); if (!v) throw new Error('Name required'); n.name = v; }
            if (d.phone != null) n.phone = ph(d.phone);
            if (w.admin && !ex && d.role === 'courier') n.role = 'courier';
            if (d.email != null) {
              const e = String(d.email).trim().toLowerCase();
              if (!emOk(e)) throw new Error('Invalid email');
              if (!ex || e !== ex.email) {
                if (!(await R1(['HSETNX', 'uidx', e, id]))) throw new Error('Email already in use');
                if (ex) cmds.push(['HDEL', 'uidx', ex.email]);
              }
              n.email = e;
            }
            if (w.admin && d.active != null) n.active = !!d.active;
            if (w.admin && d.pass) { if (String(d.pass).length < 4) throw new Error('Password too short'); n.pw = hashPw(d.pass); }
            if (!n.name || !n.email || !n.pw) throw new Error('Name, email and password are required');
            put('users', n);
          } else if (c === 'stores') {
            const ex = db.stores[id];
            if (op.del) {
              if (!w.admin) throw new Error('Only the administrator can delete stores');
              if (ex) { Object.values(db.products).filter((p) => p.store === id).forEach((p) => del('products', p.id)); del('stores', id); }
              continue;
            }
            if (!ex) {
              if (!w.admin) throw new Error('Rent a store to open one');
              if (!db.users[d.owner]) throw new Error('Owner not found');
              const n = { id, name: clean(d.name), cat: clean(d.cat, 40) || 'Other', owner: d.owner, verified: !!d.verified, plan: d.plan === 'year' ? 'year' : 'month', logo: imgOk(d.logo) ? d.logo : '', active: d.active !== false, created: Date.now() };
              if (!n.name) throw new Error('Store name required');
              put('stores', n); continue;
            }
            if (!w.admin && ex.owner !== w.uid) throw new Error('Not your store');
            const n = { ...ex };
            if (d.name != null) { const v = clean(d.name); if (!v) throw new Error('Name required'); n.name = v; }
            if (d.logo != null) n.logo = imgOk(d.logo) ? d.logo : d.logo === '' ? '' : n.logo;
            if (w.admin) {
              if (d.cat != null) n.cat = clean(d.cat, 40) || n.cat;
              if (d.plan != null) n.plan = d.plan === 'year' ? 'year' : 'month';
              if (d.verified != null) n.verified = !!d.verified;
              if (d.active != null) n.active = !!d.active;
              if (d.owner && db.users[d.owner]) n.owner = d.owner;
            }
            put('stores', n);
          } else if (c === 'products') {
            const ex = db.products[id];
            if (op.del) {
              if (ex) { const st = db.stores[ex.store]; if (!w.admin && (!st || st.owner !== w.uid)) throw new Error('Not your product'); del('products', id); }
              continue;
            }
            const sid = ex ? ex.store : d.store, st = db.stores[sid];
            if (!st) throw new Error('Store not found');
            if (!w.admin && st.owner !== w.uid) throw new Error('Not your store');
            const n = ex ? { ...ex } : { id, store: sid, img: '', cat: st.cat };
            if (d.name != null) { const v = clean(d.name, 80); if (!v) throw new Error('Name required'); n.name = v; }
            if (d.price != null) { const v = num(d.price, 0, 1e7); if (v == null) throw new Error('Bad price'); n.price = Math.round(v * 100) / 100; }
            if (d.stock != null) { const v = num(d.stock, 0, 99999); if (v == null) throw new Error('Bad stock'); n.stock = Math.floor(v); }
            if (d.cat != null) n.cat = clean(d.cat, 40) || n.cat;
            if (d.img != null) n.img = imgOk(d.img) ? d.img : '';
            if (!n.name || n.price == null || n.stock == null) throw new Error('Name, price and stock are required');
            put('products', n);
          } else if (c === 'reviews') {
            if (op.del) { if (!w.admin) throw new Error('Only the administrator can delete reviews'); del('reviews', id); continue; }
            if (db.reviews[id]) continue;
            if (!w.uid) throw new Error('Log in to review');
            if (!db.products[d.pid]) throw new Error('Product not found');
            const s = num(d.stars, 1, 5); if (s == null) throw new Error('Bad rating');
            put('reviews', { id, pid: d.pid, stars: Math.round(s), text: clean(d.text, 300), user: clean(String(db.users[w.uid].name).split(' ')[0], 20), uid: w.uid, t: Date.now() });
          } else if (c === 'msgs') {
            if (op.del) throw new Error('Messages cannot be deleted');
            if (db.msgs[id]) continue;
            const st = db.stores[d.store]; if (!st) throw new Error('Store not found');
            const text = clean(d.text, 1000); if (!text) throw new Error('Empty message');
            let m;
            if (w.admin) {
              const buyer = !d.buyer || d.buyer === 'admin' ? 'admin' : db.users[d.buyer] ? d.buyer : null;
              if (!buyer) throw new Error('Unknown customer');
              m = { role: 'admin', from: 'Delipo Admin', buyer };
            } else if (st.owner === w.uid) {
              if (d.buyer !== 'admin' && !db.users[d.buyer]) throw new Error('Unknown customer');
              m = { role: 'store', from: st.name, buyer: d.buyer };
            } else m = { role: 'buyer', from: db.users[w.uid].name, buyer: w.uid };
            m.bn = m.buyer === 'admin' ? 'Delipo Admin' : db.users[m.buyer].name;
            put('msgs', { id, store: d.store, ...m, text, flag: scan(text), t: Date.now() });
          } else if (c === 'orders') {
            if (op.del) throw new Error('Orders cannot be deleted');
            const ex = db.orders[id];
            if (!ex || ex.rent) throw new Error('Order not found');
            if (!ORD.includes(d.status)) throw new Error('Bad status');
            if (d.status === 'Delivered') throw new Error('Delivery is confirmed by the delivery company (Admin > Delivery)');
            if (d.status === ex.status) continue;
            if (!w.admin && (HOLD.includes(d.status) || HOLD.includes(ex.status))) throw new Error('Only the administrator can change held orders');
            if (!w.admin) {
              const mine = new Set(myStores());
              if (!(ex.items || []).some((i) => db.products[i.id] && mine.has(db.products[i.id].store))) throw new Error('Not your order');
            }
            put('orders', { ...ex, status: d.status });
          } else if (c === 'notifs') {
            const ex = db.notifs[id];
            if (op.del || !w.uid || !ex || ex.to !== w.uid) throw new Error('Not allowed');
            put('notifs', { ...ex, read: true });
          } else if (c === 'cfg') {
            if (!w.admin) throw new Error('Only the administrator can change settings');
            const cur = await getCfg();
            if (Array.isArray(d.notes)) cur.notes = d.notes.slice(0, 20).map((n) => ({ t: clean(n && n.t, 200) })).filter((n) => n.t);
            if (Array.isArray(d.banners)) cur.banners = d.banners.slice(0, 8).map((x) => ({ id: idOk(x && x.id) ? x.id : rid(), title: clean(x && x.title, 60), sub: clean(x && x.sub, 100), img: x && bnImgOk(x.img) ? x.img : '', store: x && db.stores[x.store] ? x.store : '', on: !(x && x.on === false) })).filter((x) => x.img);
            if (d.set) {
              const cm = num(d.set.comm, 0, 0.5), mo = num(d.set.plan && d.set.plan.month, 1, 100000), yr = num(d.set.plan && d.set.plan.year, 1, 1000000);
              if (cm == null || mo == null || yr == null) throw new Error('Bad settings');
              cur.set = { comm: cm, plan: { month: mo, year: yr } };
            }
            cmds.push(['SET', 'cfg', JSON.stringify(cur)]);
          }
        } catch (e) { rej.push({ c, id, why: e.message }); }
      }
      if (cmds.length) await R(cmds.concat([['INCR', 'ver']]));
      if (w.admin && cmds.length) await audit('Admin changed: ' + [...new Set(ops.map((o) => o && o.c))].join(', '), req);
      return send(200, { ok: true, rejected: rej });
    }

    if (['assign', 'pickup', 'confirm', 'payout', 'weekly', 'wkapprove'].includes(a)) {
      const o = db.orders[b.order];
      if (a === 'assign') {
        if (!w.admin) return send(403, { error: 'Administrators only' });
        const c = db.users[b.courier];
        if (!o || o.rent || !c || c.role !== 'courier' || !c.active) return send(400, { error: 'Choose an active delivery company' });
        if (['Cancelled', 'Suspended', 'Refunded', 'Delivered'].includes(o.status)) return send(400, { error: 'This order cannot be delivered' });
        put('orders', { ...o, status: o.status === 'Paid' ? 'Processing' : o.status, delivery: { co: c.id, name: c.name, st: 'Assigned', t: Date.now() } });
        notify(c.id, 'New delivery', 'Order ' + o.id + ' was assigned to you.');
        await audit('Delivery assigned: ' + o.id + ' to ' + c.name, req); await commit();
        return send(200, { ok: true });
      }
      if (a === 'pickup' || a === 'confirm') {
        const u = db.users[w.uid], isAdm = !!w.admin;
        if (!o || !o.delivery) return send(404, { error: 'Delivery not found' });
        if (!isAdm && (!u || u.role !== 'courier' || o.delivery.co !== w.uid)) return send(403, { error: 'Not your delivery' });
        if (['Cancelled', 'Suspended', 'Refunded'].includes(o.status)) return send(400, { error: 'This order is on hold. Contact Delipo.' });
        if (a === 'pickup') {
          if (o.delivery.st !== 'Assigned') return send(400, { error: 'Already picked up' });
          put('orders', { ...o, status: 'Shipped', delivery: { ...o.delivery, st: 'Picked up', tp: Date.now() } });
        } else {
          if (o.delivery.st === 'Delivered') return send(400, { error: 'Already confirmed' });
          if (!isAdm) {
            if (o.delivery.st !== 'Picked up') return send(400, { error: 'Mark the order as picked up first' });
            if ((+(await R1(['GET', 'pin:' + o.id])) || 0) >= 5) return send(400, { error: 'Too many wrong codes. Contact Delipo support.' });
            if (!eq(String(b.pin || ''), o.pin)) { await R1(['INCR', 'pin:' + o.id]); await audit('WRONG delivery code for ' + o.id, req); return send(400, { error: 'Wrong delivery code' }); }
          }
          const pay = {}; for (const k in o.pay || {}) pay[k] = { ...o.pay[k], st: o.pay[k].st === 'held' ? 'due' : o.pay[k].st };
          put('orders', { ...o, status: 'Delivered', pay, delivery: { ...o.delivery, st: 'Delivered', td: Date.now(), by: isAdm ? 'admin' : w.uid } });
          for (const k in pay) { const st = db.stores[k]; if (st) notify(st.owner, 'Delivery confirmed', 'Order ' + o.id + ' was delivered. Your payout is now due.'); }
          notify(o.user, 'Order delivered', 'Order ' + o.id + ' was delivered. Thank you for shopping on Delipo!');
          await audit('Delivery confirmed ' + o.id + (isAdm ? ' (by admin, no code)' : ''), req);
        }
        await commit();
        return send(200, { ok: true });
      }
      if (!w.admin) return send(403, { error: 'Administrators only' });
      if (a === 'payout') {
        const sid = String(b.store || ''), ref = clean(b.ref, 60);
        if (!o || !o.pay || !o.pay[sid] || o.pay[sid].st !== 'due') return send(400, { error: 'No payout is due for this order and store' });
        if (!ref) return send(400, { error: 'Enter the payment reference' });
        put('orders', { ...o, pay: { ...o.pay, [sid]: { ...o.pay[sid], st: 'paid', ref, tp: Date.now() } } });
        const st = db.stores[sid]; if (st) notify(st.owner, 'Payout sent', 'GHS ' + o.pay[sid].amt + ' for order ' + o.id + ' was paid to you. Reference: ' + ref);
        await audit('Payout marked paid: ' + o.id + ' / ' + sid + ' / ' + ref, req); await commit();
        return send(200, { ok: true });
      }
      if (a === 'weekly') {
        const out = {};
        for (const k of ['last', 'this']) {
          const r = weekCalc(db, cfg, k), saved = await R1(['HGET', 'weekly', r.id]), key = k === 'this' ? 'thisWeek' : 'last';
          if (saved && JSON.parse(saved).status === 'approved') out[key] = JSON.parse(saved);
          else {
            const rec = { ...r, status: r.list.length ? 'pending' : 'empty' };
            if (k === 'last' && r.list.length && !saved) await R1(['HSET', 'weekly', r.id, JSON.stringify(rec)]);
            out[key] = rec;
          }
        }
        return send(200, out);
      }
      if (a === 'wkapprove') {
        const k = ['last', 'this'].find((x) => weekCalc(db, cfg, x).id === b.id);
        if (!k) return send(400, { error: 'Unknown week' });
        const r = weekCalc(db, cfg, k), pick = new Set(Array.isArray(b.stores) ? b.stores : []), list = r.list.filter((x) => pick.has(x.store));
        if (!list.length) return send(400, { error: 'Select at least one store' });
        const rec = { ...r, list, status: 'approved', at: Date.now() };
        await R1(['HSET', 'weekly', r.id, JSON.stringify(rec)]);
        const cur = await getCfg(); cur.top = { id: r.id, label: r.label, stores: list.map((x) => x.store), at: rec.at };
        cmds.push(['SET', 'cfg', JSON.stringify(cur)]);
        list.forEach((x, i) => { const st = db.stores[x.store]; if (st) notify(st.owner, 'You are a Top Seller!', st.name + ' ranked #' + (i + 1) + ' on Delipo for ' + r.label + '. Congratulations!'); });
        await audit('Top sellers approved for ' + r.id, req); await commit();
        return send(200, { ok: true });
      }
    }

    if (a === 'order' || a === 'rent') {
      if (!w.uid) return send(403, { error: 'Log in as a customer' });
      if (!(await limit(req, 'pay', 30))) return send(429, { error: 'Too many attempts. Try again later.' });
      const ref = String(b.ref || '');
      if (!/^[\w-]{6,80}$/.test(ref)) return send(400, { error: 'Missing payment reference' });
      const claimed = await R1(['SET', 'ref:' + ref, 'pending', 'NX', 'EX', 600]);
      if (!claimed) {
        const v = await R1(['GET', 'ref:' + ref]);
        return v && v !== 'pending' ? send(200, { ok: true, id: v, dup: true }) : send(409, { error: 'This payment is being processed. Try again shortly.' });
      }
      let locked = false;
      try {
        const me = db.users[w.uid]; if (!me || !me.active) throw new Error('Account not active');
        const date = new Date().toLocaleDateString('en-GB'); let total, rec;
        if (a === 'order') {
          locked = await lockStock(); db.products = flat(await R1(['HGETALL', 'products'])); // one order at a time, so stock can never be oversold
          const items = (Array.isArray(b.items) ? b.items : []).slice(0, 30).map((i) => ({ id: String(i.id), q: Math.floor(Number(i.q)) }));
          if (!items.length || items.some((i) => !idOk(i.id) || !(i.q >= 1 && i.q <= 99))) throw new Error('Bad cart');
          total = 0;
          for (const i of items) {
            const p = db.products[i.id], st = p && db.stores[p.store];
            if (!p || !st || !st.active) throw new Error('An item is no longer available');
            if (p.stock < i.q) throw new Error(p.name + ' is out of stock');
            total += p.price * i.q;
          }
          total = Math.round(total * 100) / 100;
          const comm = cfg.set && cfg.set.comm != null ? cfg.set.comm : 0.05, pay = {};
          items.forEach((i) => { const p = db.products[i.id]; i.p = p.price; const x = (pay[p.store] = pay[p.store] || { amt: 0, st: 'held' }); x.amt = Math.round((x.amt + p.price * i.q * (1 - comm)) * 100) / 100; });
          rec = { id: 'o' + rid(), user: w.uid, items, addr: clean(b.addr, 300), total, status: 'Paid', date, ref, t: Date.now(), pin: String(crypto.randomInt(1000, 10000)), pay, delivery: null };
        } else {
          const plan = b.plan === 'year' ? 'year' : 'month', price = (cfg.set && cfg.set.plan && cfg.set.plan[plan]) || { month: 30, year: 350 }[plan];
          const name = clean(b.name), cat = clean(b.cat, 40) || 'Other';
          if (!name) throw new Error('Store name required');
          total = price; rec = { name, cat, plan };
        }
        const pv = await paystack(ref);
        if (!pv || pv.status !== 'success' || pv.currency !== 'GHS') throw new Error('Payment not confirmed by Paystack');
        if (Math.abs(pv.amount / 100 - total) > 0.01) throw new Error('Paid amount does not match the expected amount');
        if (String((pv.customer && pv.customer.email) || '').toLowerCase() !== me.email) throw new Error('This payment belongs to another account');
        let outId;
        if (a === 'order') {
          rec.items.forEach((i) => { const p = db.products[i.id]; put('products', { ...p, stock: p.stock - i.q }); });
          put('orders', rec); outId = rec.id;
        } else {
          const sid = 's' + rid();
          put('stores', { id: sid, name: rec.name, cat: rec.cat, owner: w.uid, verified: false, plan: rec.plan, logo: '', active: true, created: Date.now(), ref });
          put('orders', { id: 'r' + rid(), rent: 1, user: w.uid, total, status: 'Rent', date, ref, t: Date.now() });
          outId = sid;
        }
        cmds.push(['SET', 'ref:' + ref, outId], ['INCR', 'ver']);
        await R(cmds);
        if (locked) await R1(['DEL', 'lock:stock']);
        return send(200, { ok: true, id: outId });
      } catch (e) {
        if (locked) await R1(['DEL', 'lock:stock']);
        await R1(['DEL', 'ref:' + ref]);
        return send(400, { error: e.message });
      }
    }
    return send(400, { error: 'Unknown request' });
  } catch (e) {
    return send(500, { error: 'Server error: ' + e.message });
  }
}
