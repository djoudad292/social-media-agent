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
  res.json({tokenLength:t.length,tokenEnd:t.substring(t.length-10),fbTest,postTest});
}catch(e){res.json({error:e.message})}});
app.use((req,res,next)=>{if(req.path==='/health'||req.path==='/debug/fb')return next();const t=req.headers['x-agent-token'];if(config.gatewayToken&&t!==config.gatewayToken)return res.status(401).json({error:'Unauthorized'});next();});

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

// Auto-scrape every 2h (calls the full scrape endpoint on itself)
setInterval(async()=>{try{const fetch=(await import('node-fetch')).default;const r=await fetch(`http://localhost:${PORT}/data/scrape`,{method:'POST',timeout:60000});if(r.ok)console.log('Auto-scrape OK');}catch(e){console.error('Auto-scrape failed:',e.message)}},7200000);

async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('data'),60000);app.listen(PORT,'0.0.0.0',()=>console.log(`Data service on ${PORT}`));}
start();
