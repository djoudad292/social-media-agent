const express=require('express');const path=require('path');
const app=express();app.use(express.json());
const config=require(path.join(__dirname,'..','..','shared','config'));
const db=require(path.join(__dirname,'..','..','shared','db'));
const redis=require(path.join(__dirname,'..','..','shared','redis'));
const azure=require(path.join(__dirname,'..','..','shared','azure-proxy'));
const PORT=process.env.PORT||3003;
app.use((req,res,next)=>{const t=req.headers['x-agent-token'];if(config.gatewayToken&&t!==config.gatewayToken)return res.status(401).json({error:'Unauthorized'});next();});
app.get('/health',(req,res)=>res.json({ok:true,service:'data'}));

// Scrape Reddit + HN
app.post('/data/scrape',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;const trends=[];
  const rr=await fetch('https://www.reddit.com/r/technology/hot.json?limit=10',{headers:{'User-Agent':'AgentSystem/1.0'}});
  const rd=await rr.json();if(rd?.data?.children)rd.data.children.forEach(c=>{const d=c.data;trends.push({source:'reddit',title:d.title,url:`https://reddit.com${d.permalink}`,score:d.score,summary:(d.selftext||'').substring(0,300)});});
  const hr=await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');const ids=await hr.json();
  for(const id of ids.slice(0,10)){try{const ir=await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);const it=await ir.json();if(it?.title)trends.push({source:'hackernews',title:it.title,url:it.url||`https://news.ycombinator.com/item?id=${id}`,score:it.score,summary:''});}catch{}}
  if(trends.length)await db.saveTrending(trends);
  res.json({trends_count:trends.length,trends});
}catch(e){res.status(500).json({error:e.message})}});

// Facebook Analytics
app.post('/data/analytics',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const r=await fetch(`https://graph.facebook.com/v21.0/${config.facebook.pageId}/insights?metric=page_impressions,page_engaged_users,page_fans&period=days_28&access_token=${config.facebook.accessToken}`);
  const d=await r.json();if(d?.data){const a={};d.data.forEach(i=>{const v=i.values?.[0]?.value||0;if(i.name==='page_impressions')a.impressions=v;if(i.name==='page_engaged_users')a.engaged_users=v;if(i.name==='page_fans')a.followers=v;});a.date=new Date().toISOString().split('T')[0];a.raw_data=d;await db.saveAnalytics(a);res.json(a);}
  else res.status(500).json({error:'Facebook API error',raw:d});
}catch(e){res.status(500).json({error:e.message})}});

// Hunt leads
app.post('/data/leads/hunt',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const q=req.body.niche||'startups hiring AI developers 2026';
  const wr=await fetch(`https://r.jina.ai/${encodeURIComponent(q)}`,{headers:{Authorization:`Bearer ${config.jina.key}`}});
  const wt=await wr.text();
  const lt=await azure.generateContent(`Extract up to 5 leads from this. JSON array: company, need, contact, email, source_url.\n${wt.substring(0,4000)}`,{maxTokens:1000,temperature:0.3});
  let leads=[];try{const m=lt.match(/\[[\s\S]*?\]/);if(m)leads=JSON.parse(m[0]);}catch{}
  const saved=[];for(const l of leads.slice(0,5)){try{saved.push(await db.saveLead({company:l.company||'Unknown',contact:l.contact||l.company,email:l.email||'',score:0.5,source:'web',notes:l.need||'',status:'new'}));}catch{}}
  res.json({leads:saved.length?saved:leads});
}catch(e){res.status(500).json({error:e.message})}});

// Generate weekly strategy
app.post('/data/strategy',async(req,res)=>{try{
  const week=req.body.week||(()=>{const n=new Date();return `${n.getFullYear()}-W${String(Math.ceil(((n-new Date(n.getFullYear(),0,1))/86400000+(new Date(n.getFullYear(),0,1).getDay()+1))/7)).padStart(2,'0')}`})();
  const pt=await azure.generateContent('Create a 7-day content plan for tech page "djaouad tech". Mix: 40% educational, 20% engaging, 20% social proof, 10% promotional, 10% personal. JSON array: day, type(post/reel/challenge), topic, description.',{maxTokens:1500});
  let plan=[];try{const m=pt.match(/\[[\s\S]*?\]/s);if(m)plan=JSON.parse(m[0]);}catch{plan=[{raw:pt}]}
  await db.saveStrategy(week,plan);res.json({week,plan});
}catch(e){res.status(500).json({error:e.message})}});

// Memory endpoints
app.get('/data/memory/:type',async(req,res)=>{try{
  const{type}=req.params;const{limit,days}=req.query;
  const m={posts:()=>days?db.getRecentPosts(parseInt(days)||7):db.getPosts(parseInt(limit)||20),analytics:()=>db.getAnalytics(parseInt(days)||28),trending:()=>db.getLatestTrends(parseInt(limit)||20),pause:()=>db.getPauseState()};
  if(m[type])res.json(await m[type]());else res.status(400).json({error:'Unknown type'});
}catch(e){res.status(500).json({error:e.message})}});

// Post to Facebook
app.post('/data/facebook/post',async(req,res)=>{try{
  const{message}=req.body;if(!message)return res.status(400).json({error:'Message required'});
  const fetch=(await import('node-fetch')).default;
  const r=await fetch(`https://graph.facebook.com/v21.0/me/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:config.facebook.accessToken,message}).toString()});
  const d=await r.json();if(d.id){await db.savePost({content:message,type:'post',status:'posted',facebook_post_id:d.id});res.json({success:true,post_url:`https://facebook.com/${d.id}`});}
  else res.status(500).json({error:'Facebook error',raw:d});
}catch(e){res.status(500).json({error:e.message})}});

// Auto-scrape every 2h
setInterval(async()=>{try{const fetch=(await import('node-fetch')).default;const r=await fetch('https://www.reddit.com/r/technology/hot.json?limit=5',{headers:{'User-Agent':'AgentSystem/1.0'}});const d=await r.json();const t=(d?.data?.children||[]).map(c=>({source:'reddit',title:c.data.title,url:`https://reddit.com${c.data.permalink}`,score:c.data.score}));if(t.length)await db.saveTrending(t);}catch{}},7200000);

async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('data'),60000);app.listen(PORT,'0.0.0.0',()=>console.log(`Data service on ${PORT}`));}
start();
