const express=require('express');const path=require('path');
const app=express();app.use(express.json());
const config=require(path.join(__dirname,'..','..','shared','config'));
const db=require(path.join(__dirname,'..','..','shared','db'));
const redis=require(path.join(__dirname,'..','..','shared','redis'));
const SIDECAR_PORT=process.env.SIDECAR_PORT||3999;
let fetch;
async function getFetch(){if(!fetch)fetch=(await import('node-fetch')).default;return fetch;}
async function call(u,b=null,m='GET'){try{const f=await getFetch();const o={method:m,headers:{'Content-Type':'application/json','x-agent-token':config.gatewayToken||''},timeout:60000};if(b)o.body=JSON.stringify(b);const r=await f(u,o);return await r.json();}catch(e){return{error:e.message,unreachable:true}}}

app.get('/health',(req,res)=>res.json({ok:true,service:'gateway'}));
app.get('/api/status',async(req,res)=>{const h=await redis.getHeartbeats();const s={};for(const[n,u]of Object.entries(config.services)){try{const f=await getFetch();const r=await f(`${u}/health`,{timeout:5000});s[n]=r.ok?'alive':'error'}catch{s[n]='down'}}res.json({services:s,heartbeats:h})});

const routes={
  'content/generate':['POST','content'],'content/research':['POST','content'],
  'media/reel':['POST','media'],'media/tts':['POST','media'],
  'data/scrape':['POST','data'],'data/analytics':['POST','data'],'data/leads/hunt':['POST','data'],'data/strategy':['POST','data'],'data/facebook/post':['POST','data'],
  'memory/posts':['GET','data','posts'],'memory/analytics':['GET','data','analytics'],'memory/trending':['GET','data','trending'],'memory/pause':['GET','data','pause'],
};
for(const[route,[method,svc,...extra]]of Object.entries(routes)){
  if(method==='POST')app.post(`/api/${route}`,async(req,res)=>{res.json(await call(`${config.services[svc]}/${route}`,req.body,'POST'))});
  else if(method==='GET')app.get(`/api/${route}`,async(req,res)=>{res.json(await call(`${config.services[svc]}/${route}?${new URLSearchParams(req.query)}`))});
}

// Direct Facebook post fallback
app.post('/api/facebook/post',async(req,res)=>{try{
  const{message}=req.body;if(!message)return res.status(400).json({error:'Message required'});
  const f=await getFetch();
  const r=await f(`https://graph.facebook.com/v21.0/me/feed`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({access_token:config.facebook.accessToken,message}).toString()});
  const d=await r.json();if(d.id){await db.savePost({content:message,type:'post',status:'posted',facebook_post_id:d.id});res.json({success:true,post_url:`https://facebook.com/${d.id}`});}
  else res.status(500).json({error:'Facebook error',raw:d});
}catch(e){res.status(500).json({error:e.message})}});

async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('gateway'),60000);app.listen(SIDECAR_PORT,'0.0.0.0',()=>console.log(`Gateway sidecar on ${SIDECAR_PORT}`));}
start();
