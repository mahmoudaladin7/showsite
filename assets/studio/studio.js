'use strict';
const $ = id => document.getElementById(id);
const presets = { ink:'#1E2230', coral:'#C9401C', mist:'#E3E7EE', white:'#FFFFFF', black:'#000000', forest:'#14532D', ocean:'#0B3B60' };
const initial = () => ({ url:'',format:'16:9',frame:'browser',background:'ink',theme:'light',fps:30,captions:{enabled:true,animation:'words'},narration:{enabled:true,rate:175},music:'none',sfx:false,hide:[],scenes:[],maxScenes:6 });
let config=initial(), selected=0, sections=[], thumbnails={}, token='', bootstrap={}, busy=false, jobId='', snapshot=null;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = value => `${String(Math.floor(value/60)).padStart(2,'0')}:${String(Math.ceil(value%60)).padStart(2,'0')}`;
const scene = () => config.scenes[selected];
const speech = s => s.narration === undefined ? s.caption || '' : s.narration;
const estimate = s => Math.max(s.duration || 3,config.narration.enabled && speech(s).trim() ? speech(s).trim().split(/\s+/).length/config.narration.rate*60+1.1 : 0);
function notify(message, error=false) { $('notice').hidden=!message; $('notice').textContent=message; $('notice').classList.toggle('error',error); }
async function api(url, method='GET', data) {
  const res=await fetch(url,{method,headers:{'x-showsite-token':token,...(data!==undefined?{'content-type':'application/json'}:{})},body:data!==undefined?JSON.stringify(data):undefined});
  const value=await res.json();
  if(!res.ok) throw new Error(value.error || `Request failed (${res.status})`);
  return value;
}
function persist() {
  try { localStorage.setItem('showsite-project-v2',JSON.stringify({config,selected,sections})); } catch {}
}
function setBusy(value) {
  busy=value; document.body.classList.toggle('busy',value);
  $('scan-btn').disabled=value; $('demo-btn').disabled=value; $('site-url').disabled=value; $('import-btn').disabled=value;
  $('save-btn').disabled=value||!config.url; $('render-btn').disabled=value||!config.scenes.length;
  $('preview-btn').disabled=value||!config.scenes.length; $('voice-preview-btn').disabled=value||!scene()||!config.narration.enabled||!speech(scene()).trim();
  $('add-btn').disabled=value||!sections.length||config.scenes.length>=30;
  $('add-section').disabled=value||!sections.length;
  $('inspector').inert=value;
}
function changed() { $('preview-note').textContent='Layout preview. Render to see the final camera motion and hear the voice-over.'; $('video').pause(); $('video').hidden=true; $('download-btn').hidden=true; $('edit-btn').hidden=true; drawPreview(); drawTimeline(); drawCards(); persist(); }
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
  for(const tab of ['design','voice','scene']) $('tab-'+tab).hidden=tab!==name;
}
function setValue(id,value) { $(id).value=value ?? ''; }
function syncControls() {
  setValue('site-url',config.url); setValue('frame',config.frame); setValue('theme',config.theme); setValue('background',config.background);
  setValue('address-bar',config.addressBar); setValue('animation',config.captions.animation); setValue('fps',config.fps);
  $('captions').checked=config.captions.enabled; $('narration').checked=config.narration.enabled; $('sfx').checked=config.sfx;
  setValue('language',config.language); setValue('voice',config.narration.voice); setValue('speech-rate',config.narration.rate);
  $('rate-label').textContent=config.narration.rate+' wpm'; setValue('music',config.music);
  document.querySelectorAll('[data-format]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.format===config.format)));
  document.querySelectorAll('[data-background]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.background===config.background)));
  syncScene(); drawCards(); drawTimeline(); drawPreview(); setBusy(busy);
}
function syncScene() {
  const s=scene();
  for(const id of ['caption','script','scene-silent','camera','scene-duration','remove-scene']) $(id).disabled=!s||busy;
  $('selected-title').textContent=s?`Scene ${String(selected+1).padStart(2,'0')}`:'Choose a scene';
  setValue('caption',s?.caption); setValue('script',s?.narration); $('scene-silent').checked=s?.narration==='';
  $('script').disabled=!s||busy||s.narration==='';
  setValue('camera',s?.camera||'scroll'); setValue('scene-duration',s?.duration||3);
  $('move-up').disabled=!s||selected===0||busy; $('move-down').disabled=!s||selected===config.scenes.length-1||busy;
  $('voice-preview-btn').disabled=!s||busy||!config.narration.enabled||!speech(s).trim();
}
function drawCards() {
  const list=$('scene-list');
  $('scene-count').textContent=config.scenes.length;
  if(!config.scenes.length) { list.innerHTML='<div class="sidebar-empty"><span class="empty-number">01</span><p>Your scenes start here.</p><small>Scan a website to find the moments worth showing.</small></div>';return; }
  list.innerHTML='';
  config.scenes.forEach((s,i)=>{
    const b=document.createElement('button'); b.className='scene-card';b.dataset.scene=String(i);b.setAttribute('aria-pressed',String(i===selected));
    b.setAttribute('aria-label',`Scene ${i+1}: ${s.caption||'Untitled scene'}`);
    const image=document.createElement('img'); image.className='scene-thumb';image.alt='';
    if(thumbnails[s.section]) image.src=thumbnails[s.section];else { image.hidden=true; const placeholder=document.createElement('div');placeholder.className='scene-thumb';b.append(placeholder); }
    b.append(image);
    const info=document.createElement('div');info.className='scene-meta';
    info.innerHTML=`<span class="scene-num">${String(i+1).padStart(2,'0')}</span><span class="scene-name">${esc(s.caption||sections.find(x=>x.index===s.section)?.name||'Untitled scene')}</span><span class="scene-time">${estimate(s).toFixed(1)}s</span>`;
    b.append(info); b.onclick=()=>{selected=i;syncScene();drawCards();drawPreview();drawTimeline();showTab('scene');persist();}; list.append(b);
  });
}
function drawPreview() {
  const s=scene(), has=Boolean(s);
  $('empty-stage').hidden=has; $('surface').hidden=!has||!$('video').hidden;
  $('resolution').textContent={'16:9':'1920 × 1080','1:1':'1080 × 1080','9:16':'1080 × 1920'}[config.format];
  $('stage-title').textContent=has?`Scene ${String(selected+1).padStart(2,'0')} · ${s.camera==='zoom'?'Slow push-in':s.camera==='hold'?'Hold still':'Smooth scroll'}`:'The big picture';
  $('stage-subtitle').textContent=has?'Layout preview · render for final motion & sound':'Your website, with a little main-character energy.';
  if(!has)return;
  $('surface').dataset.format=config.format; $('surface').style.background=presets[config.background]||config.background;
  const bg=presets[config.background]||config.background; $('preview-caption').style.color=['mist','white','#FFFFFF','#ffffff'].includes(config.background)||bg==='#E3E7EE'?'#14161D':'white';
  $('preview-caption').textContent=config.captions.enabled?s.caption||'':'';
  $('device').dataset.frame=config.frame;
  try{$('preview-host').textContent=config.addressBar||new URL(config.url).host;}catch{$('preview-host').textContent='';}
  const img=thumbnails[s.section]; $('section-image').hidden=!img; $('missing-image').hidden=Boolean(img);if(img)$('section-image').src=img;
}
function drawTimeline() {
  const total=config.scenes.reduce((sum,s)=>sum+estimate(s),0);
  $('duration-label').textContent=`${config.scenes.length} scene${config.scenes.length===1?'':'s'} · ${config.narration.enabled?'~':''}${total.toFixed(1)}s`;
  $('timeline-end').textContent=fmtTime(total);
  $('timeline-audio').textContent=config.narration.enabled?`Voice-over${config.music!=='none'?' + soft music':''} · local & free`:config.music==='none'?(config.sfx?'Camera whooshes':'Silent video'):`${config.music==='calm'?'Calm':'Upbeat'} soundtrack`;
  const track=$('timeline-track');if(!config.scenes.length){track.innerHTML='<div class="timeline-placeholder"></div><div class="timeline-placeholder"></div><div class="timeline-placeholder"></div>';return;}
  track.innerHTML='';config.scenes.forEach((s,i)=>{const b=document.createElement('button');b.className='timeline-block';b.style.flexGrow=estimate(s);b.setAttribute('aria-pressed',String(i===selected));b.setAttribute('aria-label',`Go to scene ${i+1}`);b.textContent=`${String(i+1).padStart(2,'0')}  ${s.caption||'Scene'}`;b.onclick=()=>{selected=i;syncScene();drawCards();drawPreview();drawTimeline();persist();};track.append(b);});
}
function populateSections() {
  const select=$('add-section');select.innerHTML='';
  for(const section of sections){const o=document.createElement('option');o.value=section.index;o.textContent=`${section.index}. ${section.name}`;select.append(o);}
  if(!sections.length)select.innerHTML='<option>Scan to find sections</option>';
}
async function scanWebsite() {
  if(busy)return;
  const url=$('site-url').value.trim(); if(!url){$('site-url').focus();return;}
  const old=config.scenes; const sameUrl=url===config.url;
  notify('Finding sections and taking previews. This can take a moment on larger websites.');setBusy(true);$('scan-btn').textContent='Finding scenes…';
  try {
    const result=await api('/api/scan','POST',{...config,url,scenes:[]});
    config=result.project;
    if(sameUrl&&old.length){const available=new Set(result.scan.sections.map(s=>s.index));const kept=old.filter(s=>typeof s.section==='string'||available.has(s.section));if(kept.length)config.scenes=kept;}
    sections=result.scan.sections; thumbnails=result.thumbnails||{};selected=0;snapshot={format:config.format,theme:config.theme};
    if(!config.language && result.scan.lang?.toLowerCase().startsWith('ar')) config.language='ar';
    populateSections();changed();syncControls();notify(`${config.scenes.length} scenes found. Edit the captions and spoken lines, then export your video.${result.scan.brokenVideos?' Some videos on this page could not play in the selected browser.':''}`);
  }catch(e){notify(e.message,true);}finally{setBusy(false);syncScene();$('scan-btn').innerHTML='Find scenes <span aria-hidden="true">→</span>';}
}
async function renderVideo(preview=false) {
  if(busy||!config.scenes.length)return;
  if(!validateDuration())return;
  notify('');setBusy(true);$('progress-card').hidden=false;$('cancel-btn').disabled=false;$('progress').value=0;$('progress-label').textContent='Starting your video';$('progress-detail').textContent=preview?'Motion preview · 12 fps. Final export uses your selected frame rate.':'Your video is being made locally. You can cancel at any time.';
  $('video').pause();
  try {
    const result=await api('/api/render','POST',{...config,fps:preview?12:config.fps});jobId=result.id;
    while(jobId){
      await new Promise(r=>setTimeout(r,650));const job=await api('/api/jobs/'+jobId);
      $('progress').value=job.percent;$('progress-label').textContent=`${job.phase} · ${job.percent}%`;
      if(job.state==='done'){
        $('video').src=job.videoUrl;$('video').hidden=false;$('surface').hidden=true;$('empty-stage').hidden=true;
        $('download-btn').href=job.videoUrl+'?download=1';$('download-btn').download=job.filename;$('download-btn').hidden=false;$('edit-btn').hidden=false;
        $('preview-note').textContent=`${preview?'Draft preview':'Final video'} · ${job.duration.toFixed(1)} seconds · saved to showsite-output/${job.filename}`;
        notify(preview?'Your motion preview is ready. Play it with sound, then export at your chosen frame rate.':'Your video is ready. Play it with sound and download the MP4.');break;
      }
      if(job.state==='error')throw new Error(job.error||'Rendering failed.');
      if(job.state==='cancelled'){notify('Render cancelled. Your project is still here.');break;}
    }
  }catch(e){notify(e.message,true);}finally{jobId='';setBusy(false);syncScene();$('progress-card').hidden=true;}
}
function validateDuration(){const field=$('scene-duration');if(scene()&&!field.checkValidity()){showTab('scene');field.reportValidity();return false;}return true;}
async function previewVoice(){
  if(busy||!scene()||!speech(scene()).trim())return;
  setBusy(true);$('voice-preview-btn').textContent='Generating voice…';notify('');
  try{const clip=await api('/api/voice-preview','POST',{config,text:speech(scene())});$('voice-audio').src=clip.url;$('voice-audio').hidden=false;await $('voice-audio').play().catch(()=>{});notify(`${clip.voice} · ${clip.duration.toFixed(1)} seconds. Listen and adjust the script or pace if needed.`);}
  catch(e){notify(e.message,true);}finally{setBusy(false);$('voice-preview-btn').innerHTML='<span aria-hidden="true">▷</span> Listen to this scene';}
}
function bind(id,event,fn){$(id).addEventListener(event,fn);}
function bindValue(id,fn,event='change'){bind(id,event,()=>{fn($(id).value);changed();if(event!=='input')syncScene();else $('voice-preview-btn').disabled=busy||!scene()||!config.narration.enabled||!speech(scene()).trim();});}
function bindCheck(id,fn){bind(id,'change',()=>{fn($(id).checked);changed();syncScene();});}
async function boot(){
  // Correct the aside lookup without relying on global ID bindings.
  document.querySelector('.inspector').id='inspector';
  for(const [name,color] of Object.entries(presets)){const b=document.createElement('button');b.className='swatch';b.dataset.background=name;b.style.background=color;b.setAttribute('aria-label',`${name} background`);b.setAttribute('aria-pressed',String(name===config.background));b.onclick=()=>{config.background=name;syncControls();changed();};$('swatches').append(b);}
  document.querySelectorAll('[data-tab]').forEach(b=>{b.onclick=()=>showTab(b.dataset.tab);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;showTab(tabs[i].dataset.tab);tabs[i].focus();};});
  document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{config.format=b.dataset.format;config.frame=config.format==='9:16'?'phone':'browser';changed();syncControls();if(snapshot&&snapshot.format!==config.format)notify('Format updated. Find scenes again to refresh the website layout preview; your edits will be kept.');});
  bind('scan-form','submit',e=>{e.preventDefault();void scanWebsite();});bind('demo-btn','click',()=>{$('site-url').value=bootstrap.demoUrl;void scanWebsite();});
  bind('render-btn','click',()=>void renderVideo());bind('preview-btn','click',()=>void renderVideo(true));bind('voice-preview-btn','click',()=>void previewVoice());
  bind('cancel-btn','click',async()=>{if(!jobId)return;try{$('cancel-btn').disabled=true;await api('/api/jobs/'+jobId,'DELETE');}catch(e){notify(e.message,true);}});
  bind('edit-btn','click',()=>{$('video').pause();$('video').hidden=true;$('edit-btn').hidden=true;drawPreview();$('preview-note').textContent='Layout preview. Render to see the final camera motion and hear the voice-over.';});
  bindValue('frame',v=>config.frame=v);bindValue('theme',v=>{config.theme=v;if(snapshot&&snapshot.theme!==v)notify('Appearance updated. Find scenes again to refresh the preview; your edits will be kept.');});
  bindValue('background',v=>{config.background=v;document.querySelectorAll('[data-background]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.background===v)));});
  bindValue('address-bar',v=>{if(v)config.addressBar=v;else delete config.addressBar;},'input');bindValue('animation',v=>config.captions.animation=v);bindValue('fps',v=>config.fps=Number(v));
  bindValue('language',v=>{if(v)config.language=v;else delete config.language;delete config.narration.voice;setValue('voice','');});bindValue('voice',v=>{if(v)config.narration.voice=v;else delete config.narration.voice;});
  bindValue('speech-rate',v=>{config.narration.rate=Number(v);$('rate-label').textContent=v+' wpm';},'input');bindValue('music',v=>config.music=v);
  bindCheck('narration',v=>config.narration.enabled=v);bindCheck('captions',v=>config.captions.enabled=v);bindCheck('sfx',v=>config.sfx=v);
  bindValue('caption',v=>{if(scene())scene().caption=v;},'input');bindValue('script',v=>{if(scene()){if(v)scene().narration=v;else delete scene().narration;}},'input');
  bindCheck('scene-silent',v=>{if(!scene())return;if(v)scene().narration='';else delete scene().narration;syncScene();});
  bindValue('camera',v=>{if(scene())scene().camera=v;});bindValue('scene-duration',v=>{if(scene()&&$('scene-duration').checkValidity()&&v)scene().duration=Number(v);},'input');
  bind('move-up','click',()=>{if(selected>0){[config.scenes[selected-1],config.scenes[selected]]=[config.scenes[selected],config.scenes[selected-1]];selected--;changed();syncScene();}});
  bind('move-down','click',()=>{if(selected<config.scenes.length-1){[config.scenes[selected+1],config.scenes[selected]]=[config.scenes[selected],config.scenes[selected+1]];selected++;changed();syncScene();}});
  bind('remove-scene','click',()=>{config.scenes.splice(selected,1);selected=Math.max(0,Math.min(selected,config.scenes.length-1));changed();syncControls();});
  bind('add-btn','click',()=>{const s=sections.find(s=>s.index===Number($('add-section').value));if(!s||config.scenes.length>=30)return;config.scenes.push({section:s.index,caption:s.caption,camera:'scroll',duration:3});selected=config.scenes.length-1;changed();syncControls();showTab('scene');});
  bind('save-btn','click',async()=>{
    if(busy||!validateDuration())return;
    setBusy(true);
    try {
      const saved=await api('/api/projects','POST',config);
      notify(`Project saved to ${saved.file}. `);
      const link=document.createElement('a');link.href=saved.url;link.download=saved.filename;link.textContent='Download a copy';link.style.textDecoration='underline';$('notice').append(link);
    } catch(e) {notify(e.message,true);} finally {setBusy(false);syncScene();}
  });
  bind('import-btn','click',()=>$('project-file').click());bind('project-file','change',async()=>{const file=$('project-file').files[0];if(!file)return;try{if(file.size>262144)throw new Error('Project files must be 256 KB or smaller.');const value=JSON.parse(await file.text());config=await api('/api/validate','POST',value);sections=[];thumbnails={};selected=0;populateSections();changed();syncControls();notify('Project opened. Find scenes to refresh previews while keeping your captions and scripts.');}catch(e){notify(e.message,true);}finally{$('project-file').value='';}});
  try{
    bootstrap=await api('/api/bootstrap');token=bootstrap.token;
    for(const voice of bootstrap.voices.sort((a,b)=>{const rank=v=>v.language.startsWith('en')?0:v.language.startsWith('ar')?1:2;return rank(a)-rank(b)||a.name.localeCompare(b.name);})){const o=document.createElement('option');o.value=voice.id;o.textContent=`${voice.name} · ${voice.language}`;$('voice').append(o);}
    try{const saved=JSON.parse(localStorage.getItem('showsite-project-v2')||'null');if(saved?.config){config=await api('/api/validate','POST',saved.config);sections=Array.isArray(saved.sections)?saved.sections:[];selected=Math.max(0,Math.min(Number(saved.selected)||0,config.scenes.length-1));}}catch{}
    if(bootstrap.initialUrl&&bootstrap.initialUrl!==config.url){config=initial();config.url=bootstrap.initialUrl;sections=[];selected=0;}
    if(bootstrap.voiceError){config.narration.enabled=false;$('voice-hint').textContent=bootstrap.voiceError;notify(bootstrap.voiceError,true);}
    populateSections();syncControls();
  }catch(e){setBusy(true);notify(`Couldn't connect to Studio. ${e.message} Start it with “showsite studio”, then reload.`,true);}
}
void boot();
