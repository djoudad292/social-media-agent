const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
const config = require(path.join(__dirname, '..','..','shared','config'));
const redis = require(path.join(__dirname, '..','..','shared','redis'));
const azure = require(path.join(__dirname, '..','..','shared','azure-proxy'));
const PORT = process.env.PORT || 3001;
app.get('/health',(req,res)=>res.json({ok:true,service:'content'}));
app.use((req,res,next)=>{if(req.path==='/health')return next();const t=req.headers['x-agent-token'];if(config.gatewayToken&&t!==config.gatewayToken)return res.status(401).json({error:'Unauthorized'});next();});
app.post('/content/generate',async(req,res)=>{try{
  const {topic,type,tone}=req.body;
  const prompts={post:`Write a ${tone||'casual'} Facebook post about: ${topic}. Under 200 words. 3-5 hashtags + CTA.`,reel:`Write a 15s reel script about: ${topic}. Visual cues + CTA.`,thread:`Write 3-5 post thread about: ${topic}.`,idea:`Generate 5 content ideas about ${topic||'AI/tech'} for a tech page.`};
  const content=await azure.generateContent(prompts[type]||prompts.post,{systemPrompt:'Tech content creator. Direct, engaging, no filler.'});
  res.json({content,topic,type});
}catch(e){res.status(500).json({error:e.message})}});
app.post('/content/research',async(req,res)=>{try{
  const fetch=(await import('node-fetch')).default;
  const {query}=req.body;
  let results=[];
  const nr=await fetch(`https://newsapi.org/v2/everything?q=${encodeURIComponent(query||'AI tech')}&apiKey=${config.freenews.key}&pageSize=5`);
  const nd=await nr.json();
  if(nd?.articles)results.push(...nd.articles.slice(0,5).map(a=>({title:a.title,url:a.url,source:'news',summary:a.description})));
  const wr=await fetch(`https://r.jina.ai/${encodeURIComponent(query||'trending AI tools 2026')}`,{headers:{Authorization:`Bearer ${config.jina.key}`}});
  const wt=await wr.text();
  const summary=await azure.generateContent(`Summarize: ${wt.substring(0,3000)}`,{maxTokens:500});
  results.push({title:'Web Research',summary,source:'web'});
  const db=require(path.join(__dirname,'..','..','shared','db'));
  if(results.length)await db.saveTrending(results.filter(r=>r.title));
  res.json({results});
}catch(e){res.status(500).json({error:e.message})}});
async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('content'),60000);app.listen(PORT,'0.0.0.0',()=>console.log(`Content service on ${PORT}`));}
start();
