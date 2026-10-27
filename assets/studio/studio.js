'use strict';
const $ = id => document.getElementById(id);
const presets = { ink:'#1E2230', coral:'#C9401C', mist:'#E3E7EE', white:'#FFFFFF', black:'#000000', forest:'#14532D', ocean:'#0B3B60' };
const initial = () => ({ mode:'tour',tour:{speed:300,hold:1,stops:[],clickHold:12},url:'',format:'16:9',frame:'browser',background:'ink',theme:'light',fps:30,captions:{enabled:true,animation:'words'},narration:{enabled:true,rate:175},music:'none',sfx:false,hide:[],scenes:[],maxScenes:6 });
let config=initial(), selected=0, sections=[], thumbnails={}, token='', bootstrap={}, busy=false, jobId='', snapshot=null, tourActions=[];
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtTime = value => `${String(Math.floor(Math.ceil(value)/60)).padStart(2,'0')}:${String(Math.ceil(value)%60).padStart(2,'0')}`;
const isTour = () => config.mode==='tour';
const stop = () => config.tour?.stops[selected];
const hasContent = () => $('site-url').value.trim()===config.url&&(isTour()?Boolean(config.url):config.scenes.length>0);
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
  if(isTour()&&config.tour.stops.some(s=>!s.name.trim()))return;
  try { localStorage.setItem('showsite-project-v2',JSON.stringify({config,selected,sections,snapshot})); } catch {}
}
function setBusy(value) {
  busy=value; document.body.classList.toggle('busy',value);
  $('scan-btn').disabled=value; $('demo-btn').disabled=value; $('site-url').disabled=value; $('import-btn').disabled=value;
  $('save-btn').disabled=value||!config.url; $('render-btn').disabled=value||!hasContent();
  $('preview-btn').disabled=value||!hasContent(); $('voice-preview-btn').disabled=value||!scene()||!config.narration.enabled||!speech(scene()).trim();
  $('add-btn').disabled=value||!sections.length||config.scenes.length>=30;
  $('add-section').disabled=value||!sections.length;
  $('inspector').inert=value; $('capture-mode').disabled=value; $('add-tour-stop').disabled=value||!config.url||config.tour.stops.length>=200;
}
function changed() { $('preview-note').textContent=isTour()?'Stop preview. Refresh after moving a stop; Preview motion records the full path.':'Layout preview. Render to see the final camera motion and hear the voice-over.'; $('video').pause(); $('video').hidden=true; $('download-btn').hidden=true; $('edit-btn').hidden=true; drawPreview(); drawTimeline(); drawCards(); persist(); }
function showTab(name) {
  document.querySelectorAll('[data-tab]').forEach(b=>{const active=b.dataset.tab===name;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
  for(const tab of ['design','voice','scene']) $('tab-'+tab).hidden=tab!==name;
}
function setValue(id,value) { $(id).value=value ?? ''; }
function syncControls() {
  syncTourControls();
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
  if(isTour()){syncTourStop();return;}
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
  if(isTour()){drawTourCards();return;}
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
  $('surface').dataset.mode=config.mode||'highlights';
  if(isTour()){drawTourPreview();return;}
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
  if(isTour()){drawTourTimeline();return;}
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
  const old=config.scenes, oldTour=config.tour.stops; const sameUrl=url===config.url;
  const keepTour=sameUrl&&(!snapshot||(snapshot.format===config.format&&snapshot.theme===config.theme&&snapshot.mode===config.mode));
  notify('Finding sections and taking previews. This can take a moment on larger websites.');setBusy(true);$('scan-btn').textContent='Scanning website…';
  try {
    const result=await api('/api/scan','POST',{...config,url,scenes:[]});
    config=result.project;
    if(!sameUrl){delete config.tour.endClick;delete config.tour.endScroll;}
    if(!isTour()&&!sameUrl)config.tour.stops=[];
    if(sameUrl&&old.length){const available=new Set(result.scan.sections.map(s=>s.index));const kept=old.filter(s=>typeof s.section==='string'||available.has(s.section));if(kept.length)config.scenes=kept;}
    sections=result.scan.sections; thumbnails=result.thumbnails||{};selected=0;
    if(isTour()){
      thumbnails=Object.fromEntries(config.tour.stops.map((s,i)=>['y:'+s.y,result.thumbnails?.[i]]).filter(([,image])=>image));
      if(keepTour&&oldTour.length)config.tour.stops=oldTour;
      tourActions=result.actions||[];
    }
    snapshot={format:config.format,theme:config.theme,mode:config.mode,url:config.url,pageHeight:result.scan.pageHeight,viewport:result.scan.viewport};
    if(!config.language && result.scan.lang?.toLowerCase().startsWith('ar')) config.language='ar';
    populateSections();changed();syncControls();notify(isTour()?`${config.tour.stops.length} pause stops found. The full page and footer are included. Select a stop to adjust its position or pause.`:`${config.scenes.length} scenes found. Edit the captions and spoken lines, then export your video.${result.scan.brokenVideos?' Some videos on this page could not play in the selected browser.':''}`);
  }catch(e){notify(e.message,true);}finally{setBusy(false);syncScene();$('scan-btn').innerHTML='Scan website <span aria-hidden="true">→</span>';}
}
async function renderVideo(preview=false) {
  if(busy||!hasContent())return;
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
        notify(isTour()?'Your full tour is ready. Review its pacing and download the MP4.':preview?'Your motion preview is ready. Play it with sound, then export at your chosen frame rate.':'Your video is ready. Play it with sound and download the MP4.');break;
      }
      if(job.state==='error')throw new Error(job.error||'Rendering failed.');
      if(job.state==='cancelled'){notify('Render cancelled. Your project is still here.');break;}
    }
  }catch(e){notify(e.message,true);}finally{jobId='';setBusy(false);syncScene();$('progress-card').hidden=true;}
}
function validateDuration(){if(isTour()){if(snapshot?.mode==='tour'&&(snapshot.format!==config.format||snapshot.theme!==config.theme)){notify('Scan the website again after changing format or appearance so the pause positions match.',true);return false;}for(const id of ['tour-speed','tour-hold','tour-click-hold','tour-stop-y','tour-stop-hold','tour-stop-name']){const f=$(id);if(!f.disabled&&!f.checkValidity()){showTab(id.startsWith('tour-stop')?'scene':'design');f.reportValidity();return false;}}return true;}const field=$('scene-duration');if(scene()&&!field.checkValidity()){showTab('scene');field.reportValidity();return false;}return true;}
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
  document.querySelectorAll('[data-tab]').forEach(b=>{b.onclick=()=>showTab(b.dataset.tab);b.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')].filter(t=>!t.disabled);let i=tabs.indexOf(b);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:tabs.length-1))%tabs.length;showTab(tabs[i].dataset.tab);tabs[i].focus();};});
  document.querySelectorAll('[data-format]').forEach(b=>b.onclick=()=>{if(config.format!==b.dataset.format){config.tour.stops=[];thumbnails={};}config.format=b.dataset.format;config.frame=config.format==='9:16'?'phone':'browser';changed();syncControls();if(snapshot&&snapshot.format!==config.format)notify('Format updated. Find scenes again to refresh the website layout preview; review the updated stop positions.');});
  bindTourControls();
  bind('scan-form','submit',e=>{e.preventDefault();void scanWebsite();});bind('demo-btn','click',()=>{$('site-url').value=bootstrap.demoUrl;void scanWebsite();});
  bind('render-btn','click',()=>void renderVideo());bind('preview-btn','click',()=>void renderVideo(true));bind('voice-preview-btn','click',()=>void previewVoice());
  bind('cancel-btn','click',async()=>{if(!jobId)return;try{$('cancel-btn').disabled=true;await api('/api/jobs/'+jobId,'DELETE');}catch(e){notify(e.message,true);}});
  bind('edit-btn','click',()=>{$('video').pause();$('video').hidden=true;$('edit-btn').hidden=true;drawPreview();$('preview-note').textContent=isTour()?'Stop preview. Refresh after moving a stop; Preview motion records the full path.':'Layout preview. Render to see the final camera motion and hear the voice-over.';});
  bindValue('frame',v=>config.frame=v);bindValue('theme',v=>{config.theme=v;if(snapshot&&snapshot.theme!==v)notify('Appearance updated. Find scenes again to refresh the preview; review the updated stop positions.');});
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
  bind('import-btn','click',()=>$('project-file').click());bind('project-file','change',async()=>{const file=$('project-file').files[0];if(!file)return;try{if(file.size>262144)throw new Error('Project files must be 256 KB or smaller.');const value=JSON.parse(await file.text());config=await api('/api/validate','POST',value);sections=[];thumbnails={};snapshot=null;tourActions=[];selected=0;populateSections();changed();syncControls();notify('Project opened. Find scenes to refresh previews while keeping your captions and scripts.');}catch(e){notify(e.message,true);}finally{$('project-file').value='';}});
  try{
    bootstrap=await api('/api/bootstrap');token=bootstrap.token;
    for(const voice of bootstrap.voices.sort((a,b)=>{const rank=v=>v.language.startsWith('en')?0:v.language.startsWith('ar')?1:2;return rank(a)-rank(b)||a.name.localeCompare(b.name);})){const o=document.createElement('option');o.value=voice.id;o.textContent=`${voice.name} · ${voice.language}`;$('voice').append(o);}
    try{const saved=JSON.parse(localStorage.getItem('showsite-project-v2')||'null');if(saved?.config){config=await api('/api/validate','POST',saved.config);sections=Array.isArray(saved.sections)?saved.sections:[];snapshot=saved.snapshot||null;selected=Math.max(0,Math.min(Number(saved.selected)||0,(isTour()?config.tour.stops:config.scenes).length-1));}}catch{}
    if(bootstrap.initialUrl&&bootstrap.initialUrl!==config.url){config=initial();config.url=bootstrap.initialUrl;sections=[];selected=0;}
    if(bootstrap.voiceError){config.narration.enabled=false;$('voice-hint').textContent=bootstrap.voiceError;notify(bootstrap.voiceError,true);}
    populateSections();syncControls();
  }catch(e){setBusy(true);notify(`Couldn't connect to Studio. ${e.message} Start it with “showsite studio”, then reload.`,true);}
}
void boot();

function syncTourControls(){
  const tour=isTour();
  setValue('capture-mode',config.mode||'highlights');
  $('mode-description').textContent=tour?'Every section and the footer, at your pace. Silent, full-viewport capture.':'Selected scenes with captions, voice-over, music and device frames.';
  $('storyboard-title').textContent=tour?'Pause stops':'Storyboard';
  $('storyboard-hint').textContent=tour?'The page stays continuous between stops.':'Your story, one scene at a time.';
  $('tour-controls').hidden=!tour;$('tour-stop-editor').hidden=!tour;$('highlight-scene').hidden=tour;$('highlight-add').hidden=tour;$('add-tour-stop').hidden=!tour;
  $('voice-tab').disabled=tour;$('frame').disabled=tour;$('frame').hidden=tour;document.querySelector('label[for=frame]').hidden=tour;
  if($('video').hidden)$('preview-note').textContent=tour?'Stop preview. Refresh after moving a stop; Preview motion records the full path.':'Layout preview. Render to see the final camera motion and hear the voice-over.';
  $('background').closest('.field-group').hidden=tour;$('captions').closest('.field-group').hidden=tour;
  if(tour&&$('voice-tab').getAttribute('aria-selected')==='true')showTab('design');
  $('scene-tab').textContent=tour?'Stop':'Scene';
  $('timeline-track').classList.toggle('tour-timeline',tour);
  setValue('tour-speed',config.tour.speed);setValue('tour-hold',config.tour.hold);setValue('tour-click-hold',config.tour.clickHold);
  setValue('tour-end-click',config.tour.endClick);setValue('tour-end-scroll',config.tour.endScroll);
  const choices=$('tour-action');choices.innerHTML='<option value="">No click</option>';
  tourActions.forEach((a,i)=>{const o=document.createElement('option');o.value=String(i);o.textContent=a.label;choices.append(o);});
  const custom=document.createElement('option');custom.value='custom';custom.textContent='Custom CSS selector…';choices.append(custom);
  const found=tourActions.findIndex(a=>a.selector===config.tour.endClick);
  choices.value=config.tour.endClick?(found>=0?String(found):'custom'):'';
  $('tour-end-scroll').disabled=!config.tour.endClick;$('tour-click-hold').disabled=!config.tour.endClick;
}
function syncTourStop(){
  const s=stop();$('tour-selected-title').textContent=s?`Stop ${selected+1}`:'Choose a stop';
  for(const id of ['tour-stop-name','tour-stop-y','tour-stop-hold','tour-refresh','tour-remove'])$(id).disabled=busy||!s;
  $('tour-stop-name').required=Boolean(s);$('tour-stop-y').required=Boolean(s);
  setValue('tour-stop-name',s?.name);setValue('tour-stop-y',s?.y);setValue('tour-stop-hold',s?.hold);
  $('voice-preview-btn').disabled=true;
}
function drawTourCards(){
  const list=$('scene-list');list.innerHTML='';$('scene-count').textContent=config.tour.stops.length;
  if(!config.tour.stops.length){list.innerHTML='<div class="sidebar-empty"><p>Scan to choose your pauses.</p><small>A full tour still records from top to bottom without manual stops.</small></div>';return;}
  config.tour.stops.forEach((s,i)=>{
    const b=document.createElement('button');b.className='scene-card';b.setAttribute('aria-pressed',String(i===selected));b.setAttribute('aria-label',`Stop ${i+1}: ${s.name}, ${s.y} pixels`);
    if(thumbnails['y:'+s.y]){const img=document.createElement('img');img.className='scene-thumb';img.alt='';img.src=thumbnails['y:'+s.y];b.append(img);}
    const info=document.createElement('div');info.className='scene-meta';info.innerHTML=`<span class="scene-num">${String(i+1).padStart(2,'0')}</span><span class="scene-name">${esc(s.name)}</span><span class="scene-time">${(s.hold??config.tour.hold).toFixed(1)}s</span>`;b.append(info);
    const position=document.createElement('span');position.className='tour-card-position';position.textContent=`${Math.round(s.y).toLocaleString()} px from top`;b.append(position);
    b.onclick=()=>{selected=i;syncScene();drawCards();drawPreview();drawTimeline();showTab('scene');persist();};list.append(b);
  });
}
function drawTourPreview(){
  const s=stop(),has=Boolean(s);$('empty-stage').hidden=has;$('surface').hidden=!has||!$('video').hidden;
  $('resolution').textContent={'16:9':'1920 × 1080','1:1':'1080 × 1080','9:16':'1080 × 1920'}[config.format];
  $('stage-title').textContent=s?`Stop ${selected+1} · ${s.name}`:'Full website tour';
  $('stage-subtitle').textContent=s?`${Math.round(s.y).toLocaleString()} px · ${(s.hold??config.tour.hold).toFixed(1)}s pause`:'Scan the website to choose your pauses.';
  $('surface').dataset.format=config.format;$('device').dataset.frame='none';
  const img=s?thumbnails['y:'+s.y]:null;$('section-image').hidden=!img;$('missing-image').hidden=Boolean(img);$('missing-image').textContent='Refresh this stop to preview its position.';if(img)$('section-image').src=img;
}
function drawTourTimeline(){
  const compatible=snapshot?.mode==='tour'&&snapshot.format===config.format&&snapshot.theme===config.theme&&snapshot.url===config.url;
  const maxY=compatible?Math.max(0,snapshot.pageHeight-snapshot.viewport.height):Math.max(0,...config.tour.stops.map(s=>s.y));
  const stops=new Map(config.tour.stops.map(s=>[Math.min(maxY,s.y),s]));
  if(!stops.has(0))stops.set(0,{y:0});if(!stops.has(maxY))stops.set(maxY,{y:maxY});
  const pause=[...stops].reduce((sum,[y,s])=>sum+(y===0||y===maxY?Math.max(3,s.hold??config.tour.hold):s.hold??config.tour.hold),0);
  const total=maxY*Math.PI/(2*config.tour.speed)+pause+(config.tour.endClick?config.tour.clickHold:0);
  $('duration-label').textContent=compatible?`${config.tour.stops.length} stops · ~${fmtTime(total)}`:'Scan to estimate duration';
  $('timeline-end').textContent=compatible?'~'+fmtTime(total):'—';$('timeline-audio').textContent='Full viewport · silent';
  const track=$('timeline-track');track.innerHTML='';
  config.tour.stops.forEach((s,i)=>{const b=document.createElement('button');b.className='timeline-block';b.textContent=String(i+1).padStart(2,'0');b.setAttribute('aria-pressed',String(i===selected));b.setAttribute('aria-label',`Go to stop ${i+1}: ${s.name}`);b.onclick=()=>{selected=i;syncScene();drawCards();drawPreview();drawTimeline();persist();};track.append(b);});
}
function bindTourControls(){
  bind('site-url','input',()=>{setBusy(busy);if($('site-url').value.trim()!==config.url)notify('Scan the new website before exporting.');});
  bind('capture-mode','change',()=>{config.mode=$('capture-mode').value;$('voice-audio').pause();selected=0;thumbnails={};sections=[];snapshot=null;tourActions=[];populateSections();changed();syncControls();showTab('design');notify('Scan the website to refresh its layout and pause previews.');});
  for(const [id,key] of [['tour-speed','speed'],['tour-hold','hold'],['tour-click-hold','clickHold']])bindValue(id,v=>{if($(id).checkValidity()&&v!=='')config.tour[key]=Number(v);},'input');
  for(const id of ['tour-speed','tour-hold','tour-click-hold'])$(id).required=true;
  bindValue('tour-stop-name',v=>{if(stop())stop().name=v;},'input');
  bindValue('tour-stop-y',v=>{if(stop()&&$('tour-stop-y').checkValidity()&&v!=='')stop().y=Number(v);},'input');
  bindValue('tour-stop-hold',v=>{if(!stop())return;if(v==='')delete stop().hold;else if($('tour-stop-hold').checkValidity())stop().hold=Number(v);},'input');
  bind('tour-action','change',()=>{const a=tourActions[Number($('tour-action').value)];if($('tour-action').value===''){delete config.tour.endClick;delete config.tour.endScroll;}else if($('tour-action').value!=='custom'&&a){config.tour.endClick=a.selector;delete config.tour.endScroll;if(a.scrollSelector)config.tour.endScroll=a.scrollSelector;}else{$('tour-end-click').focus();return;}syncTourControls();changed();});
  bind('tour-end-click','input',()=>{const v=$('tour-end-click').value.trim();if(v)config.tour.endClick=v;else{delete config.tour.endClick;delete config.tour.endScroll;setValue('tour-end-scroll','');}$('tour-end-scroll').disabled=!v;$('tour-click-hold').disabled=!v;$('tour-action').value=v?'custom':'';changed();});
  bindValue('tour-end-scroll',v=>{if(v.trim())config.tour.endScroll=v.trim();else delete config.tour.endScroll;});
  bind('add-tour-stop','click',()=>{if(busy||config.tour.stops.length>=200)return;const y=Math.round((stop()?.y||0)+(snapshot?.viewport?.height||720)/2);config.tour.stops.push({y,name:'New pause'});selected=config.tour.stops.length-1;changed();syncControls();showTab('scene');});
  bind('tour-remove','click',()=>{config.tour.stops.splice(selected,1);selected=Math.max(0,selected-1);changed();syncControls();});
  bind('tour-refresh','click',async()=>{if(busy||!stop()||!validateDuration())return;setBusy(true);syncScene();notify('Loading this stop at its exact scroll position…');try{const result=await api('/api/tour-preview','POST',{config,y:stop().y});stop().y=result.y;thumbnails['y:'+result.y]=result.image;changed();notify('Stop preview refreshed.');}catch(e){notify(e.message,true);}finally{setBusy(false);syncScene();}});
}
