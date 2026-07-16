const express=require('express');const path=require('path');
const app=express();app.use(express.json());
const config=require(path.join(__dirname,'..','..','shared','config'));
const db=require(path.join(__dirname,'..','..','shared','db'));
const redis=require(path.join(__dirname,'..','..','shared','redis'));
const azure=require(path.join(__dirname,'..','..','shared','azure-proxy'));
const PORT=process.env.PORT||3003;
app.get('/health',(req,res)=>res.json({ok:true,service:'data'}));
app.get('/debug/fb',async(req,res)=>{try{
  const t=config.facebook.accessToken||'';
  const https=require('https');const qs=require('querystring');
  const fbTest=await new Promise((resolve)=>{
    const r=https.get(`https://graph.facebook.com/v21.0/me?access_token=${encodeURIComponent(t)}`,resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
    r.on('error',e=>resolve({netError:e.message}));r.setTimeout(5000,()=>{r.destroy();resolve({timeout:true})});
  });
  const body=qs.stringify({access_token:t,message:'test from debug'});
  const postTest=await new Promise((resolve)=>{
    const r=https.request('https://graph.facebook.com/v21.0/me/feed',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
    r.on('error',e=>resolve({netError:e.message}));r.setTimeout(10000,()=>{r.destroy();resolve({timeout:true})});
    r.write(body);r.end();
  });
  // Check Instagram Business Account linked to page
  const igCheck=await new Promise((resolve)=>{
    const r=https.get(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,instagram_business_account{id,username,profile_pic}&access_token=${encodeURIComponent(t)}`,resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
    r.on('error',e=>resolve({netError:e.message}));r.setTimeout(5000,()=>{r.destroy();resolve({timeout:true})});
  });
  const targetPage=igCheck?.data?.find(p=>p.id==='651243158078819')||igCheck?.data?.[0];
  const igAccount=targetPage?.instagram_business_account||null;
  // Check token permissions
  const permCheck=await new Promise((resolve)=>{
    const r=https.get(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(t)}`,resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
    r.on('error',e=>resolve({netError:e.message}));r.setTimeout(5000,()=>{r.destroy();resolve({timeout:true})});
  });
  res.json({tokenLength:t.length,tokenEnd:t.substring(t.length-10),fbTest,postTest,instagram:{linked:!!igAccount,account:igAccount,targetPage,allPages:igCheck?.data?.map(p=>({id:p.id,name:p.name,ig:p.instagram_business_account?.username||null}))},permissions:permCheck?.data?.filter(p=>p.status==='granted').map(p=>p.permission)||[]});
}catch(e){res.json({error:e.message})}});
app.use((req,res,next)=>{if(req.path==='/health'||req.path==='/debug/fb'||req.path==='/api/telegram/webhook'||req.path==='/api/telegram/webhook-info'||req.path==='/api/telegram/set-webhook')return next();const t=req.headers['x-agent-token'];if(config.gatewayToken&&t!==config.gatewayToken)return res.status(401).json({error:'Unauthorized'});next();});

// Data routes

app.post('/data/scrape',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;const trends=[];
  const rr=await fetch('https://www.reddit.com/r/technology/hot.json?limit=10',{headers:{'User-Agent':'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36'}});
  try{const rd=await rr.json();if(rd?.data?.children)rd.data.children.forEach(c=>{const d=c.data;trends.push({source:'reddit',title:d.title,url:`https://reddit.com${d.permalink}`,score:d.score,summary:(d.selftext||'').substring(0,300)});});}catch{}
  const hr=await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');let ids=[];try{ids=await hr.json();}catch{}
  for(const id of ids.slice(0,10)){try{const ir=await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);const it=await ir.json();if(it?.title)trends.push({source:'hackernews',title:it.title,url:it.url||`https://news.ycombinator.com/item?id=${id}`,score:it.score,summary:''});}catch{}}
  if(trends.length)await db.saveTrending(trends);
  res.json({trends_count:trends.length,trends});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/data/analytics',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const r=await fetch(`https://graph.facebook.com/v21.0/${config.facebook.pageId}/insights?metric=page_impressions,page_engaged_users,page_fans&period=days_28&access_token=${config.facebook.accessToken}`);
  const d=await r.json();if(d?.data){const a={};d.data.forEach(i=>{const v=i.values?.[0]?.value||0;if(i.name==='page_impressions')a.impressions=v;if(i.name==='page_engaged_users')a.engaged_users=v;if(i.name==='page_fans')a.followers=v;});a.date=new Date().toISOString().split('T')[0];a.raw_data=d;await db.saveAnalytics(a);res.json(a);}
  else res.status(500).json({error:'Facebook API error',raw:d});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/data/leads/hunt',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const q=req.body.niche||'startups hiring AI developers 2026';
  const wr=await fetch(`https://s.jina.ai/${encodeURIComponent(q)}`,{headers:{Authorization:`Bearer ${config.jina.key}`}});
  const wt=await wr.text();
  const lt=await azure.generateContent(`Extract up to 5 leads from this. JSON array: company, need, contact, email, source_url.\n${wt.substring(0,4000)}`,{maxTokens:1000,temperature:0.3});
  let leads=[];try{const m=lt.match(/\[[\s\S]*?\]/);if(m)leads=JSON.parse(m[0]);}catch{}
  const saved=[];for(const l of leads.slice(0,5)){try{saved.push(await db.saveLead({company:l.company||'Unknown',contact:l.contact||l.company,email:l.email||'',score:0.5,source:'web',notes:l.need||'',status:'new'}));}catch{}}
  res.json({leads:saved.length?saved:leads});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/data/strategy',async(req,res)=>{try{
  const week=req.body.week||(()=>{const n=new Date();return `${n.getFullYear()}-W${String(Math.ceil(((n-new Date(n.getFullYear(),0,1))/86400000+(new Date(n.getFullYear(),0,1).getDay()+1))/7)).padStart(2,'0')}`})();
  const pt=await azure.generateContent('Create a 7-day content plan for tech page "djaouad tech". Mix: 40% educational, 20% engaging, 20% social proof, 10% promotional, 10% personal. JSON array: day, type(post/reel/challenge), topic, description.',{maxTokens:1500});
  let plan=[];try{const m=pt.match(/\[[\s\S]*?\]/s);if(m)plan=JSON.parse(m[0]);}catch{plan=[{raw:pt}]}
  await db.saveStrategy(week,plan);res.json({week,plan});
}catch(e){res.status(500).json({error:e.message})}});

app.get('/data/memory/:type',async(req,res)=>{try{
  const{type}=req.params;const{limit,days}=req.query;
  const m={posts:()=>days?db.getRecentPosts(parseInt(days)||7):db.getPosts(parseInt(limit)||20),analytics:()=>db.getAnalytics(parseInt(days)||28),trending:()=>db.getLatestTrends(parseInt(limit)||20),pause:()=>db.getPauseState()};
  if(m[type])res.json(await m[type]());else res.status(400).json({error:'Unknown type'});
}catch(e){res.status(500).json({error:e.message})}});

// Content generation direct (bypass stuck content service)
app.post('/api/content/generate',async(req,res)=>{try{
  const {topic,type,tone}=req.body;
  const prompts={post:`Write a ${tone||'casual'} Facebook post about: ${topic}. Under 200 words. 3-5 hashtags + CTA.`,reel:`Write a 15s reel script about: ${topic}. Visual cues + CTA.`,thread:`Write 3-5 post thread about: ${topic}.`,idea:`Generate 5 content ideas about ${topic||'AI/tech'} for a tech page.`};
  const content=await azure.generateContent(prompts[type]||prompts.post,{systemPrompt:'Tech content creator. Direct, engaging, no filler.'});
  res.json({content,topic,type});
}catch(e){res.status(500).json({error:e.message})}});
app.post('/api/content/research',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const {query}=req.body;let results=[];
  const nr=await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(query||'AI tech')}&apiKey=${config.freenews.key}&pageSize=5`);
  const nd=await nr.json();
  if(nd?.articles)results.push(...nd.articles.slice(0,5).map(a=>({title:a.title,url:a.url,source:'news',summary:a.description})));
  const wr=await fetch(`https://s.jina.ai/${encodeURIComponent(query||'trending AI tools 2026')}`,{headers:{Authorization:`Bearer ${config.jina.key}`}});
  const wt=await wr.text();
  const summary=await azure.generateContent(`Summarize: ${wt.substring(0,3000)}`,{maxTokens:500});
  results.push({title:'Web Research',summary,source:'web'});
  if(results.length)await db.saveTrending(results.filter(r=>r.title));
  res.json({results});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/data/facebook/post',async(req,res)=>{try{
  const{message}=req.body;if(!message)return res.status(400).json({error:'Message required'});
  const fetch=(await import('node-fetch')).default;
  const r=await fetch(`https://graph.facebook.com/v21.0/me/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:config.facebook.accessToken,message}).toString()});
  const d=await r.json();if(d.id){await db.savePost({content:message,type:'post',status:'posted',facebook_post_id:d.id});res.json({success:true,post_url:`https://facebook.com/${d.id}`});}
  else res.status(500).json({error:'Facebook error',raw:d});
}catch(e){res.status(500).json({error:e.message})}});

// Gateway sidecar routes (merged into data service)

let fetch;
async function getFetch(){if(!fetch)fetch=(await import('node-fetch')).default;return fetch;}
async function proxyCall(u,b=null,m='GET'){try{const f=await getFetch();const o={method:m,headers:{'Content-Type':'application/json','x-agent-token':config.gatewayToken||''},timeout:60000};if(b)o.body=JSON.stringify(b);const r=await f(u,o);return await r.json();}catch(e){return{error:e.message,unreachable:true}}}

app.get('/api/status',async(req,res)=>{const h=await redis.getHeartbeats();const s={};for(const[n,u]of Object.entries(config.services)){try{const f=await getFetch();const r=await f(`${u}/health`,{timeout:5000});s[n]=r.ok?'alive':'error'}catch{s[n]='down'}}res.json({services:s,heartbeats:h})});

const proxyRoutes={
  'media/reel':['POST','media'],'media/tts':['POST','media'],
  'data/scrape':['POST','data'],'data/analytics':['POST','data'],'data/leads/hunt':['POST','data'],'data/strategy':['POST','data'],'data/facebook/post':['POST','data'],
  'memory/posts':['GET','data','posts'],'memory/analytics':['GET','data','analytics'],'memory/trending':['GET','data','trending'],'memory/pause':['GET','data','pause'],
};
for(const[route,[method,svc,...extra]]of Object.entries(proxyRoutes)){
  if(method==='POST')app.post(`/api/${route}`,async(req,res)=>{res.json(await proxyCall(`${config.services[svc]}/${route}`,req.body,'POST'))});
  else if(method==='GET')app.get(`/api/${route}`,async(req,res)=>{res.json(await proxyCall(`${config.services[svc]}/${route}?${new URLSearchParams(req.query)}`))});
}

app.post('/api/facebook/post',async(req,res)=>{try{
  const https=require('https');const qs=require('querystring');
  const t=config.facebook.accessToken||'';
  const body=qs.stringify({access_token:t,message:req.body.message||'test'});
  const fbRes=await new Promise((resolve)=>{
    const r=https.request('https://graph.facebook.com/v21.0/me/feed',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
    r.on('error',e=>resolve({netError:e.message}));r.setTimeout(15000,()=>{r.destroy();resolve({timeout:true})});r.write(body);r.end();
  });
  if(fbRes.id){try{await db.savePost({content:req.body.message||'test',type:'post',status:'posted',facebook_post_id:fbRes.id});}catch{}res.json({success:true,post_url:`https://facebook.com/${fbRes.id}`});}
  else res.status(500).json({error:'Facebook error',raw:fbRes});
}catch(e){res.json({error:e.message})}});

// ====== Telegram Bot ======

const tgBotToken = config.telegram.botToken || '';
function tgApi(method, payload = {}) {
  return new Promise((resolve) => {
    if (!tgBotToken) return resolve({ ok: false, error: 'no bot token' });
    const https = require('https');
    const body = JSON.stringify(payload);
    const r = https.request(`https://api.telegram.org/bot${tgBotToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve({ ok: false, error: e.message }) } }); });
    r.on('error', e => resolve({ ok: false, error: e.message }));
    r.setTimeout(10000, () => { r.destroy(); resolve({ ok: false, error: 'timeout' }) });
    r.write(body); r.end();
  });
}
function tgSendMessage(chatId, text) { return tgApi('sendMessage', { chat_id: chatId, text }); }
function tgSendAction(chatId) { return tgApi('sendChatAction', { chat_id: chatId, action: 'typing' }); }

app.post('/api/telegram/webhook', async (req, res) => {
  res.json({ ok: true }); // acknowledge immediately
  if (!tgBotToken) return;
  const update = req.body;
  const msg = update?.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  tgSendAction(chatId);
  const [cmd, ...args] = text.split(' ');
  const arg = args.join(' ');
  try {
    switch (cmd) {
      case '/start':
      case '/help':
        await tgSendMessage(chatId,
          '🤖 *Social Media Engine*\n\n'
          + '`/status` — System + queue status\n'
          + '`/queue` — Scheduled items\n'
          + '`/schedule <topic> <date>` — Schedule a post\n'
          + '`/post <message>` — Post to Facebook now\n'
          + '`/generate <topic>` — Generate content via AI\n'
          + '`/autopilot on|off` — Toggle auto-pilot\n'
          + '`/pause [hours]` — Pause auto-pilot\n'
          + '`/stats` — Queue statistics\n'
          + '`/cancel <id>` — Remove from queue\n'
          + '`/scrape` — Fetch latest trends'
        );
        break;
      case '/status': {
        const stats = await db.queueStats().catch(() => ({}));
        const pause = await db.getPauseState().catch(() => ({}));
        const q = await db.getQueue({ limit: 3 }).catch(() => []);
        await tgSendMessage(chatId,
          `*System Status*\n\n`
          + `🤖 Auto-pilot: ${autoPilotInterval ? 'ON' : 'OFF'}\n`
          + `⏸️ Paused: ${pause.paused ? 'Yes' : 'No'}\n`
          + `📅 Scheduled: ${stats.scheduled || 0}\n`
          + `✅ Posted: ${stats.posted || 0}\n`
          + `❌ Failed: ${stats.failed || 0}\n`
          + `\n*Next ${Math.min(3, q.length)} scheduled:*\n`
          + (q.slice(0, 3).map(i => `• #${i.id} — ${i.topic || 'untitled'} (${new Date(i.scheduled_for).toLocaleString()})`).join('\n') || 'None')
        );
        break;
      }
      case '/queue': {
        const status = arg || 'scheduled';
        const items = await db.getQueue({ status, limit: 15 }).catch(() => []);
        if (!items.length) {
          await tgSendMessage(chatId, `No items with status "${status}".`);
          break;
        }
        const lines = items.map(i => `#${i.id} [${i.platform}] ${i.topic || 'untitled'} — ${new Date(i.scheduled_for).toLocaleString()}`);
        // Telegram has 4096 char limit, chunk if needed
        for (let i = 0; i < lines.length; i += 15) {
          await tgSendMessage(chatId, `*Queue (${status})*\n\n${lines.slice(i, i + 15).join('\n')}`);
        }
        break;
      }
      case '/schedule': {
        if (!arg) { await tgSendMessage(chatId, 'Usage: `/schedule <topic> [platform] [hours-from-now]`\nExample: `/schedule AI trends`'); break; }
        const parts = arg.split('|').map(s => s.trim());
        const topic = parts[0];
        const platform = parts[1] || 'facebook';
        const hours = parseInt(parts[2]) || 6;
        const sched = new Date(Date.now() + hours * 3600000).toISOString();
        const item = await db.addToQueue({ content: '', topic, type: 'post', platform, scheduled_for: sched, tone: 'casual' });
        await tgSendMessage(chatId, `✅ *Scheduled #${item.id}*\nTopic: ${topic}\nPlatform: ${platform}\nTime: ${new Date(sched).toLocaleString()}`);
        break;
      }
      case '/post': {
        if (!arg) { await tgSendMessage(chatId, 'Usage: `/post <message>`'); break; }
        const https = require('https'); const qs = require('querystring');
        const body = qs.stringify({ access_token: config.facebook.accessToken || '', message: arg });
        const fbRes = await new Promise((resolve) => {
          const r = https.request('https://graph.facebook.com/v21.0/me/feed', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } }, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { resolve({ parseError: e.message }) } }); });
          r.on('error', e => resolve({ netError: e.message })); r.setTimeout(15000, () => { r.destroy(); resolve({ timeout: true }) }); r.write(body); r.end();
        });
        if (fbRes.id) {
          try { await db.savePost({ content: arg, type: 'post', status: 'posted', facebook_post_id: fbRes.id }); } catch {}
          await tgSendMessage(chatId, `✅ *Posted!*\nhttps://facebook.com/${fbRes.id}`);
        } else {
          await tgSendMessage(chatId, `❌ Facebook error:\n\`${JSON.stringify(fbRes)}\``);
        }
        break;
      }
      case '/generate': {
        if (!arg) { await tgSendMessage(chatId, 'Usage: `/generate <topic>`'); break; }
        await tgSendMessage(chatId, `⏳ Generating content about: ${arg}...`);
        const content = await azure.generateContent(`Write a social media post about: ${arg}. Under 200 words.`, { maxTokens: 500 });
        const item = await db.addToQueue({ content, topic: arg, type: 'post', platform: 'facebook', scheduled_for: new Date(Date.now() + 3600000).toISOString(), tone: 'casual' });
        await tgSendMessage(chatId, `✅ *Generated & Scheduled #${item.id}*\n\n${content.substring(0, 1000)}`);
        break;
      }
      case '/autopilot': {
        if (arg === 'on') {
          if (autoPilotInterval) { await tgSendMessage(chatId, 'Auto-pilot already running.'); break; }
          autoPilotInterval = setInterval(autoPilotCycle, AUTOPILOT_INTERVAL);
          autoPilotCycle();
          await tgSendMessage(chatId, '✅ Auto-pilot started.');
        } else if (arg === 'off') {
          if (autoPilotInterval) { clearInterval(autoPilotInterval); autoPilotInterval = null; }
          await tgSendMessage(chatId, '⏸️ Auto-pilot stopped.');
        } else {
          await tgSendMessage(chatId, 'Usage: `/autopilot on|off`');
        }
        break;
      }
      case '/pause': {
        const hours = parseInt(arg) || 0;
        const expiresAt = hours > 0 ? new Date(Date.now() + hours * 3600000).toISOString() : null;
        await db.setPauseState(true, expiresAt);
        await tgSendMessage(chatId, hours > 0 ? `⏸️ Paused for ${hours}h (until ${new Date(expiresAt).toLocaleString()})` : '⏸️ Paused indefinitely. `/autopilot on` to resume.');
        break;
      }
      case '/stats': {
        const stats = await db.queueStats().catch(() => ({}));
        await tgSendMessage(chatId,
          `*Queue Statistics*\n\n`
          + `📅 Scheduled: ${stats.scheduled || 0}\n`
          + `✅ Posted: ${stats.posted || 0}\n`
          + `❌ Failed: ${stats.failed || 0}\n`
          + `\n*By platform:*\n`
          + Object.entries(stats.by_platform || {}).map(([p, c]) => `• ${p}: ${c}`).join('\n') || 'None'
        );
        break;
      }
      case '/cancel': {
        if (!arg || isNaN(parseInt(arg))) { await tgSendMessage(chatId, 'Usage: `/cancel <id>`'); break; }
        await db.removeFromQueue(parseInt(arg));
        await tgSendMessage(chatId, `🗑️ Cancelled item #${arg}.`);
        break;
      }
      case '/scrape': {
        await tgSendMessage(chatId, '⏳ Scraping trends...');
        const fetch = (await import('node-fetch')).default;
        const r = await fetch(`http://localhost:${PORT}/data/scrape`, { method: 'POST', timeout: 60000 });
        const d = await r.json();
        await tgSendMessage(chatId, `✅ Scraped ${d.trends_count || 0} trends.\nTop: ${(d.trends || []).slice(0, 3).map(t => `• ${t.title}`).join('\n')}`);
        break;
      }
      default:
        if (text.startsWith('/')) {
          await tgSendMessage(chatId, `Unknown command: ${cmd}\nTry /help`);
        }
    }
  } catch (e) {
    await tgSendMessage(chatId, `❌ Error: ${e.message}`);
  }
});

app.post('/api/telegram/set-webhook', async (req, res) => {
  try {
    if (!tgBotToken) return res.status(400).json({ error: 'no bot token' });
    const url = req.body.url || `${config.services.data || `https://agent-data-1qw0.onrender.com`}/api/telegram/webhook`;
    const result = await tgApi('setWebhook', { url, allowed_updates: ['message'], drop_pending_updates: true });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/telegram/webhook-info', async (req, res) => {
  try {
    if (!tgBotToken) return res.status(400).json({ error: 'no bot token' });
    const result = await tgApi('getWebhookInfo');
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ====== Scheduler Engine ======

app.post('/api/scheduler/schedule',async(req,res)=>{try{
  const{content,topic,type,platform,scheduled_for,tone}=req.body;
  if(!scheduled_for)return res.status(400).json({error:'scheduled_for (ISO date) required'});
  if(!content&&!topic)return res.status(400).json({error:'content or topic required'});
  let finalContent=content;
  if(!finalContent&&topic){const p={post:`Write a ${tone||'casual'} post about: ${topic}. Under 200 words.`,reel:`Write a 15s reel script about: ${topic}.`,thread:`Write 3-5 post thread about: ${topic}.`,idea:`Generate 5 content ideas about ${topic}.`};finalContent=await azure.generateContent(p[type]||p.post);}
  const item=await db.addToQueue({content:finalContent,topic,type,platform,scheduled_for,tone});
  res.json({success:true,item});
}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/scheduler/queue',async(req,res)=>{try{
  const items=await db.getQueue({status:req.query.status,platform:req.query.platform,limit:req.query.limit||50});
  res.json({items});
}catch(e){res.status(500).json({error:e.message})}});

app.delete('/api/scheduler/queue/:id',async(req,res)=>{try{await db.removeFromQueue(req.params.id);res.json({success:true});}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/scheduler/stats',async(req,res)=>{try{res.json(await db.queueStats());}catch(e){res.status(500).json({error:e.message})}});

// Ticker: process due items (call via cron or externally)
app.post('/api/scheduler/tick',async(req,res)=>{try{
  const due=await db.getDueItems();const results=[];
  for(const item of due){
    try{
      let contentToPost = item.content;
      if (!contentToPost && item.topic) {
        contentToPost = await azure.generateContent(`Write a ${item.tone||'casual'} social media post about: ${item.topic}. Under 200 words.`, {maxTokens:500});
      }
      let postResult;
      if (!contentToPost) { postResult = { error: 'empty content' }; }
      else if(item.platform==='facebook'){
        const https=require('https');const qs=require('querystring');
        const body=qs.stringify({access_token:config.facebook.accessToken||'',message:contentToPost});
        postResult=await new Promise((resolve)=>{
          const r=https.request('https://graph.facebook.com/v21.0/me/feed',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Content-Length':Buffer.byteLength(body)}},resp=>{let d='';resp.on('data',c=>d+=c);resp.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){resolve({parseError:e.message})}});});
          r.on('error',e=>resolve({netError:e.message}));r.setTimeout(15000,()=>{r.destroy();resolve({timeout:true})});r.write(body);r.end();
        });
      }else{
        postResult={error:`Platform ${item.platform} not implemented`};
      }
      if(postResult&&postResult.id){await db.markPosted(item.id,postResult);results.push({id:item.id,status:'posted',post_url:`https://facebook.com/${postResult.id}`});}
      else{await db.removeFromQueue(item.id);results.push({id:item.id,status:'failed',error:postResult});}
    }catch(e){results.push({id:item.id,status:'error',error:e.message});}
  }
  res.json({processed:results.length,results});
}catch(e){res.status(500).json({error:e.message})}});

// ====== Auto-Pilot Engine ======

let autoPilotInterval=null;
const AUTOPILOT_INTERVAL=3600000; // check every hour

async function autoPilotCycle(){
  try{
    const pause=await db.getPauseState();
    if(pause.paused&&(!pause.expires_at||new Date(pause.expires_at)>new Date()))return;
    // Check if we have a strategy for this week
    const now=new Date();const week=`${now.getFullYear()}-W${String(Math.ceil(((now-new Date(now.getFullYear(),0,1))/86400000+(new Date(now.getFullYear(),0,1).getDay()+1))/7)).padStart(2,'0')}`;
    let strategy=await db.getStrategy(week);
    if(!strategy){
      const pt=await azure.generateContent('Create a 7-day content plan for tech page "djaouad tech". Mix: education 40%, engagement 20%, social proof 20%, promo 10%, personal 10%. JSON array: day, type(post/reel/challenge), topic, description.',{maxTokens:1500});
      let plan=[];try{const m=pt.match(/\[[\s\S]*?\]/s);if(m)plan=JSON.parse(m[0]);}catch{plan=[{day:1,type:'post',topic:'AI trends',description:'Top AI trends'}]}
      await db.saveStrategy(week,plan);
      strategy=await db.getStrategy(week);
    }
    if(!strategy||!strategy.plan)return;
    const queue=await db.getQueue({status:'scheduled',limit:20});
    if(queue.length>=5)return; // enough queued
    const trending=await db.getLatestTrends(5);
    const trendTopics=trending.map(t=>t.title).filter(Boolean);
    for(const day of strategy.plan.slice(0,7)){
      const topic=day.topic||(trendTopics.length?trendTopics[Math.floor(Math.random()*trendTopics.length)]:'AI tech');
      // Schedule for 2-6 hours from now (spread throughout day)
      const hour=8+Math.floor(Math.random()*12);
      const sched=new Date();sched.setHours(hour,0,0,0);
      if(sched<=now)sched.setDate(sched.getDate()+1);
      try{await db.addToQueue({content:'',topic,type:day.type||'post',platform:'facebook',scheduled_for:sched.toISOString(),tone:'casual'});}catch{}
    }
  }catch(e){console.error('Auto-pilot error:',e.message);}
}

app.post('/api/autopilot/start',async(req,res)=>{try{
  if(autoPilotInterval)return res.json({success:true,status:'already_running'});
  autoPilotInterval=setInterval(autoPilotCycle,AUTOPILOT_INTERVAL);
  autoPilotCycle(); // run immediately
  res.json({success:true,status:'started',interval_ms:AUTOPILOT_INTERVAL});
}catch(e){res.status(500).json({error:e.message})}});

app.post('/api/autopilot/stop',async(req,res)=>{try{
  if(autoPilotInterval){clearInterval(autoPilotInterval);autoPilotInterval=null;}
  res.json({success:true,status:'stopped'});
}catch(e){res.status(500).json({error:e.message})}});

app.get('/api/autopilot/status',async(req,res)=>{try{
  const pause=await db.getPauseState();
  res.json({running:!!autoPilotInterval,paused:pause.paused,expires_at:pause.expires_at});
}catch(e){res.status(500).json({error:e.message})}});

// Auto-scrape every 2h
setInterval(async()=>{try{const fetch=(await import('node-fetch')).default;const r=await fetch(`http://localhost:${PORT}/data/scrape`,{method:'POST',timeout:60000});if(r.ok)console.log('Auto-scrape OK');}catch(e){console.error('Auto-scrape failed:',e.message)}},7200000);

// Auto-tick every 15 minutes (process due queue items)
setInterval(async()=>{try{const fetch=(await import('node-fetch')).default;await fetch(`http://localhost:${PORT}/api/scheduler/tick`,{method:'POST',timeout:60000});}catch(e){console.error('Auto-tick failed:',e.message)}},900000);

async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('data'),60000);await db.initDatabase().catch(()=>{});app.listen(PORT,'0.0.0.0',()=>console.log(`Data service on ${PORT}`));}
start();
// v2 - telegram bot
