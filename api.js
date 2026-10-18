const U=process.env.UPSTASH_REDIS_REST_URL||process.env.KV_REST_API_URL,K=process.env.UPSTASH_REDIS_REST_TOKEN||process.env.KV_REST_API_TOKEN,cr=require('crypto');
const R=async(...c)=>(await(await fetch(U,{method:'POST',headers:{Authorization:'Bearer '+K},body:JSON.stringify(c)})).json()).result;
const g=async k=>{const v=await R('GET',k);return v?JSON.parse(v):null},s=(k,v)=>R('SET',k,JSON.stringify(v));
const H=(p,x)=>cr.scryptSync(p,x,32).toString('hex'),tok=()=>cr.randomBytes(24).toString('hex');
const pub=u=>({u:u.u,bio:u.bio,pic:u.pic,ver:u.ver}),pk=(a,b)=>[a,b].sort().join('|'),flip=(a,v)=>{const i=a.indexOf(v);i<0?a.push(v):a.splice(i,1);return a};
const mk=async(u,p)=>{u=String(u||'').toLowerCase();if(!/^[a-z0-9._]{3,24}$/.test(u))throw Error('Username: 3-24 letters, numbers, . or _');
if(String(p||'').length<6)throw Error('Password needs 6+ characters');if(await g('u:'+u))throw Error('That username is taken');
const x=tok().slice(0,16),me={u,h:H(p,x),x,bio:'',pic:'',ver:0,ban:0,t:Date.now()};await s('u:'+u,me);await R('SADD','users',u);return me};
const sess=async u=>{const t=tok();await R('SET','s:'+t,u,'EX',2592000);return t};
const reel=async(id,me)=>{const r=await g('r:'+id);if(!r)return null;const a=await g('u:'+r.u);return{...r,likes:r.likes.length,liked:me?r.likes.includes(me.u):0,au:a?pub(a):{u:r.u}}};
const A={
async signup(b){const me=await mk(b.u,b.p);return{t:await sess(me.u),me:pub(me)}},
async login(b){const n=String(b.u||'').toLowerCase();
if(process.env.ADMIN_USER&&n===process.env.ADMIN_USER.toLowerCase()&&b.p===process.env.ADMIN_PASS){const t=tok();await R('SET','s:'+t,'~admin','EX',43200);return{t,admin:1}}
const me=await g('u:'+n);if(!me||H(String(b.p||''),me.x)!==me.h)throw Error('Wrong username or password');if(me.ban)throw Error('This account has been suspended');
return{t:await sess(n),me:pub(me)}},
async me(b,me,adm){return adm?{admin:1}:{me:pub(me)}},
async profile(b,me){me.bio=String(b.bio||'').slice(0,160);if(b.pic!==undefined&&String(b.pic).length<40000)me.pic=b.pic;await s('u:'+me.u,me);return{me:pub(me)}},
async user(b,me){const u=await g('u:'+String(b.u).toLowerCase());if(!u)throw Error('No such user');const fl=await g('fl:'+u.u)||[],f=await g('f:'+u.u)||[];return{...pub(u),followers:fl.length,following:f.length,isF:me?fl.includes(me.u):0}},
async people(b,me){const q=String(b.q||'').toLowerCase();const all=await R('SMEMBERS','users');return{list:all.filter(x=>x.includes(q)&&x!==me.u).slice(0,20)}},
async follow(b,me){const t=String(b.u).toLowerCase();if(t===me.u||!await g('u:'+t))throw Error('Not allowed');
const f=await g('f:'+me.u)||[],fl=await g('fl:'+t)||[];flip(f,t);flip(fl,me.u);await s('f:'+me.u,f);await s('fl:'+t,fl);return{on:f.includes(t)}},
async friends(b,me){const f=await g('f:'+me.u)||[],fl=await g('fl:'+me.u)||[];return{following:f,followers:fl,mutual:f.filter(x=>fl.includes(x))}},
async reelPost(b,me){const url=String(b.url||'').trim();if(!/^https?:\/\//.test(url))throw Error('Add a video link');const id=Date.now().toString(36)+tok().slice(0,4);
await s('r:'+id,{id,u:me.u,url,cap:String(b.cap||'').slice(0,140),likes:[],boost:0,t:Date.now()});await R('LPUSH','reels',id);return{id}},
async feed(b,me){const ids=await R('LRANGE','reels',0,59),f=await g('f:'+me.u)||[],cfg=await g('cfg')||{follow:5,fresh:6};
const L=(await Promise.all(ids.map(i=>reel(i,me)))).filter(Boolean);const now=Date.now();
L.forEach(r=>r.sc=r.likes+r.boost*10+(f.includes(r.u)?cfg.follow:0)-(now-r.t)/36e5/cfg.fresh);return{list:L.sort((a,b)=>b.sc-a.sc)}},
async like(b,me){const r=await g('r:'+b.id);flip(r.likes,me.u);await s('r:'+b.id,r);return{on:r.likes.includes(me.u),n:r.likes.length}},
async saveReel(b,me){const v=await g('sv:'+me.u)||[];flip(v,b.id);await s('sv:'+me.u,v);return{on:v.includes(b.id)}},
async saved(b,me){const v=await g('sv:'+me.u)||[];return{list:(await Promise.all(v.map(i=>reel(i,me)))).filter(Boolean)}},
async send(b,me){const t=String(b.to).toLowerCase(),f=await g('f:'+me.u)||[],fl=await g('fl:'+me.u)||[];if(!f.includes(t)||!fl.includes(t))throw Error('You can chat once you both follow each other');
const k='c:'+pk(me.u,t),c=await g(k)||[];c.push({f:me.u,m:String(b.m||'').slice(0,500),t:Date.now()});await s(k,c.slice(-200));await R('SADD','ib:'+me.u,t);await R('SADD','ib:'+t,me.u);return{ok:1}},
async thread(b,me){return{list:await g('c:'+pk(me.u,String(b.w).toLowerCase()))||[]}},
async inbox(b,me){return{list:await R('SMEMBERS','ib:'+me.u)}},
async report(b,me){await R('SADD','reports',pk(me.u,String(b.w).toLowerCase()));return{ok:1}},
async promote(b,me){const id=Date.now().toString(36);if(!String(b.ti||'').trim())throw Error('Add a title');await s('sg:'+id,{id,t:String(b.ti).slice(0,40),u:me.u,n:String(b.n||'').slice(0,600),l:String(b.l||'').slice(0,400)});await R('LPUSH','songs',id);return{id}},
async songs(b){const q=String(b.q||'').toLowerCase(),ids=await R('LRANGE','songs',0,199);const L=(await Promise.all(ids.map(i=>g('sg:'+i)))).filter(Boolean);return{list:L.filter(x=>(x.t+x.u+x.l).toLowerCase().includes(q))}},
async noteAdd(b,me){const n=await g('nt:'+me.u)||[];n.push({title:String(b.title||'Note').slice(0,60),l:String(b.l||'').slice(0,300)});await s('nt:'+me.u,n);return{list:n}},
async notes(b,me){return{list:await g('nt:'+me.u)||[]}},
async noteDel(b,me){const n=await g('nt:'+me.u)||[];n.splice(b.i,1);await s('nt:'+me.u,n);return{list:n}},
async tuts(b){return{list:(await g('tut')||[]).filter(x=>!b.i||x.i===b.i)}},
// admin
async aStats(b,me,adm){return{users:await R('SCARD','users'),reels:await R('LLEN','reels'),reports:await R('SMEMBERS','reports'),cfg:await g('cfg')||{follow:5,fresh:6}}},
async aUsers(b,me,adm){const all=await R('SMEMBERS','users');return{list:(await Promise.all(all.map(x=>g('u:'+x)))).filter(Boolean).map(u=>({u:u.u,ver:u.ver,ban:u.ban}))}},
async aCreate(b){const me=await mk(b.u,b.p);return{u:me.u}},
async aSet(b){const u=await g('u:'+b.u);if(!u)throw Error('No such user');if(b.k==='del'){await R('DEL','u:'+b.u);await R('SREM','users',b.u);return{ok:1}}u[b.k]=b.v?1:0;await s('u:'+b.u,u);return{ok:1}},
async aReelDel(b){await R('LREM','reels',0,b.id);await R('DEL','r:'+b.id);return{ok:1}},
async aBoost(b){const r=await g('r:'+b.id);r.boost=Number(b.v)||0;await s('r:'+b.id,r);return{ok:1}},
async aCfg(b){const c={follow:Number(b.follow)||0,fresh:Math.max(1,Number(b.fresh)||6)};await s('cfg',c);return c},
async aReported(b){const k=String(b.k);if(!(await R('SISMEMBER','reports',k)))throw Error('Only reported chats can be opened');return{list:await g('c:'+k)||[]}},
async aTut(b){const t=await g('tut')||[];t.push({i:b.i,title:String(b.title).slice(0,80),yt:b.yt});await s('tut',t);return{list:t}}
};
const OPEN=['signup','login','tuts','songs','user'];
module.exports=async(req,res)=>{if(req.method==='GET')return res.status(200).json({api:'running',database:!!(U&&K),admin:!!(process.env.ADMIN_USER&&process.env.ADMIN_PASS)});try{const b=req.body||{};let me=null,adm=0;
if(b.t){const v=await R('GET','s:'+b.t);if(v==='~admin')adm=1;else if(v){me=await g('u:'+v);if(me&&me.ban)me=null}}
if(!A[b.a])throw Error('Unknown action');
const isA=/^a[A-Z]/.test(b.a);
if(isA&&!adm)throw Error('Not allowed');
if(!isA&&!OPEN.includes(b.a)&&b.a!=='me'&&!me)throw Error('Please log in to continue');
if(b.a==='me'&&!me&&!adm)throw Error('Please log in to continue');
res.status(200).json(await A[b.a](b,me,adm))}catch(e){res.status(200).json({err:e.message})}};
