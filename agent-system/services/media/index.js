const express=require('express');const path=require('path');const{execSync}=require('child_process');const fs=require('fs');
const app=express();app.use(express.json({limit:'50mb'}));
const config=require(path.join(__dirname,'..','..','shared','config'));
const redis=require(path.join(__dirname,'..','..','shared','redis'));
const azure=require(path.join(__dirname,'..','..','shared','azure-proxy'));
const PORT=process.env.PORT||3002;
const TMP='/tmp/agent-media';if(!fs.existsSync(TMP))fs.mkdirSync(TMP,{recursive:true});
app.get('/health',(req,res)=>res.json({ok:true,service:'media'}));
app.use((req,res,next)=>{if(req.path==='/health')return next();const t=req.headers['x-agent-token'];if(config.gatewayToken&&t!==config.gatewayToken)return res.status(401).json({error:'Unauthorized'});next();});
app.post('/media/reel',async(req,res)=>{try{
  const{script,topic}=req.body;if(!script)return res.status(400).json({error:'Script required'});
  const fetch=(await import('node-fetch')).default;
  const kw=topic||script.substring(0,50);
  const pr=await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(kw)}&per_page=2&orientation=portrait`,{headers:{Authorization:config.pexels.key}});
  const pd=await pr.json();const clips=[];
  if(pd?.videos?.length){for(let i=0;i<Math.min(pd.videos.length,2);i++){const vf=pd.videos[i].video_files.find(f=>f.quality==='hd')||pd.videos[i].video_files[0];if(vf?.link){const cp=`${TMP}/clip${i}.mp4`;execSync(`curl -s -L "${vf.link}" -o ${cp}`,{timeout:30000});clips.push(cp);}}}
  const ttsPath=`${TMP}/voiceover.mp3`;
  const esc=script.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');const ssml=`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='en-US-JennyNeural'>${esc}</voice></speak>`;
  await(fetch(`https://${config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':config.speech.key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-16khz-128kbitrate-mono-mp3'},body:ssml}).then(async r=>{const b=Buffer.from(await r.arrayBuffer());fs.writeFileSync(ttsPath,b);}));
  const musicPath=`${TMP}/music.wav`;try{execSync(`sox -n ${musicPath} synth 15 sine 440 vol 0.1`,{timeout:10000});}catch{fs.writeFileSync(musicPath,'');}
  const out=`${TMP}/reel_final.mp4`;const clipSrc=clips.length>0?`-i ${clips[0]}`:'-f lavfi -i color=c=black:s=1080x1920:d=15';
  execSync(`ffmpeg ${clipSrc} -i ${ttsPath} -i ${musicPath} -filter_complex "[0:v]crop=ih*9/16:ih,scale=1080:1920[v];[1:a][2:a]amix=inputs=2:duration=first[a]" -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -threads 1 -t 15 ${out} -y`,{timeout:120000,stdio:'pipe'});
  const db=require(path.join(__dirname,'..','..','shared','db'));
  const vb=fs.readFileSync(out);const fn=`reels/${Date.now()}.mp4`;
  await db.supabase.storage.from('media').upload(fn,vb,{contentType:'video/mp4',upsert:false});
  const{pdata}=db.supabase.storage.from('media').getPublicUrl(fn);
  [out,ttsPath,musicPath,...clips].forEach(f=>{try{fs.unlinkSync(f)}catch{}});
  res.json({video_url:pdata.publicUrl,duration:15});
}catch(e){res.status(500).json({error:e.message})}});
app.post('/media/tts',async(req,res)=>{try{
  const{text,voice}=req.body;if(!text)return res.status(400).json({error:'Text required'});
  const fetch=(await import('node-fetch')).default;
  const vn=voice||'en-US-JennyNeural';const esc=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');const ssml=`<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${vn}'>${esc}</voice></speak>`;
  const r=await fetch(`https://${config.speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`,{method:'POST',headers:{'Ocp-Apim-Subscription-Key':config.speech.key,'Content-Type':'application/ssml+xml','X-Microsoft-OutputFormat':'audio-16khz-128kbitrate-mono-mp3'},body:ssml});
  const db=require(path.join(__dirname,'..','..','shared','db'));const fn=`tts/${Date.now()}.mp3`;
  const b=Buffer.from(await r.arrayBuffer());await db.supabase.storage.from('media').upload(fn,b,{contentType:'audio/mpeg',upsert:false});
  const{pdata}=db.supabase.storage.from('media').getPublicUrl(fn);
  res.json({audio_url:pdata.publicUrl,voice:vn});
}catch(e){res.status(500).json({error:e.message})}});
async function start(){await redis.connect().catch(()=>{});setInterval(()=>redis.heartbeat('media'),60000);app.listen(PORT,'0.0.0.0',()=>console.log(`Media service on ${PORT}`));}
start();
