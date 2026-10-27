import { mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Browser, Page } from 'playwright';
import { log } from './log.js';
import { launchBrowser } from './browser.js';
import { defaultOutFile, type ShowsiteConfig } from './config.js';
import { startEncoder, type Encoder } from './ffmpeg.js';
import type { ScanResult, Plan } from './plan.js';
import type { RenderOptions, RenderResult } from './render.js';
import { autoTourStops, planTour, tourY } from './tour-plan.js';

export function tourLayout(format: ShowsiteConfig['format']) {
  if(format==='9:16')return {viewport:{width:432,height:768},scale:2.5,output:{width:1080,height:1920}};
  if(format==='1:1')return {viewport:{width:720,height:720},scale:1.5,output:{width:1080,height:1080}};
  return {viewport:{width:1280,height:720},scale:1.5,output:{width:1920,height:1080}};
}

async function preparePage(browser: Browser, config: ShowsiteConfig, signal?: AbortSignal) {
  const layout=tourLayout(config.format);
  const context=await browser.newContext({viewport:layout.viewport,deviceScaleFactor:layout.scale,colorScheme:config.theme,locale:config.language,reducedMotion:'no-preference'});
  const page=await context.newPage();
  await page.clock.install();
  await page.goto(config.url,{waitUntil:'load',timeout:60000});
  for(const selector of config.hide) {
    await page.locator(selector).count(); // Invalid selectors should produce an actionable error.
    await page.addStyleTag({content:`${selector}{visibility:hidden!important}`});
  }
  await page.evaluate(async()=>{
    document.querySelectorAll('img').forEach(i=>i.loading='eager');
    await document.fonts.ready;
    await Promise.race([Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,15000))]);
  });
  await delay(4500,undefined,{signal});
  signal?.throwIfAborted();
  await page.clock.pauseAt(await page.evaluate(()=>Date.now()+100));
  await page.evaluate(()=>window.scrollTo({top:0,left:0,behavior:'instant'}));
  await page.clock.runFor(1000);
  return {page,context,layout};
}

async function inspect(page: Page, url: string): Promise<ScanResult> {
  return page.evaluate(url=>{
    const candidates=[...document.querySelectorAll('main > section, main > div > section, footer')];
    const sections=candidates.filter(e=>e.getBoundingClientRect().height>0).map((e,i)=>({
      index:i+1,name:(e.getAttribute('aria-label')||(e.querySelector('h1,h2') as HTMLElement|null)?.innerText||e.id||`Section ${i+1}`).replace(/\s+/g,' ').trim().slice(0,200),caption:'',
      top:Math.max(0,e.getBoundingClientRect().top+scrollY),height:e.getBoundingClientRect().height,selector:e.id?`#${CSS.escape(e.id)}`:'',
      kind:e.tagName==='FOOTER'?'footer' as const:i===0?'hero' as const:'section' as const,
    }));
    return {url,title:document.title,lang:document.documentElement.lang,dir:document.documentElement.dir,pageHeight:Math.max(innerHeight,document.documentElement.scrollHeight,document.body.scrollHeight),viewport:{width:innerWidth,height:innerHeight},sections};
  },url);
}

async function actionChoices(page: Page) {
  return page.evaluate(()=>[...document.querySelectorAll('button,[role="button"]')].filter(e=>{
    const b=e as HTMLButtonElement;
    return e.getBoundingClientRect().height>0&&!b.disabled&&!(b.form&&b.type==='submit')&&(e.textContent||e.getAttribute('aria-label'))?.trim();
  }).slice(0,60).map(e=>{
    const parts:string[]=[];let el:Element|null=e;
    while(el&&el.tagName!=='HTML'){
      if(el.id&&document.querySelectorAll(`#${CSS.escape(el.id)}`).length===1){parts.unshift(`#${CSS.escape(el.id)}`);break;}
      const siblings=el.parentElement?[...el.parentElement.children].filter(s=>s.tagName===el!.tagName):[el];
      parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(el)+1})`);el=el.parentElement;
    }
    return {label:(e.getAttribute('aria-label')||e.textContent||'Button').replace(/\s+/g,' ').trim().slice(0,100),selector:parts.join(' > '),scrollSelector:e.getAttribute('aria-controls')&&!/\s/.test(e.getAttribute('aria-controls')!)?`#${CSS.escape(e.getAttribute('aria-controls')!)}`:undefined};
  }));
}

export async function scanTour(config: ShowsiteConfig, thumbnails=false) {
  const browser=await launchBrowser(config.chromePath);
  try {
    const {page}=await preparePage(browser,config);
    const scan=await inspect(page,config.url);
    const stops=autoTourStops(Math.max(0,scan.pageHeight-scan.viewport.height),scan.viewport.height,scan.sections);
    const actions=await actionChoices(page);
    const images:Record<string,string>={};
    if(thumbnails)for(const [i,stop] of stops.entries()){
      await page.evaluate(y=>window.scrollTo({top:y,left:0,behavior:'instant'}),stop.y);
      await page.clock.runFor(700);
      images[i]=`data:image/jpeg;base64,${(await page.screenshot({type:'jpeg',quality:50,scale:'css'})).toString('base64')}`;
    }
    return {scan,visibleHeight:scan.viewport.height,thumbnails:images,tourStops:stops,actions};
  }finally{await browser.close();}
}

export async function previewTourStop(config: ShowsiteConfig, y: number) {
  if(!Number.isFinite(y)||y<0||y>10000000)throw new Error('Choose a valid scroll position.');
  const browser=await launchBrowser(config.chromePath);
  try{
    const {page}=await preparePage(browser,config);
    await page.evaluate(y=>window.scrollTo({top:y,left:0,behavior:'instant'}),y);
    await page.clock.runFor(1500);
    return {y:await page.evaluate(()=>scrollY),image:`data:image/jpeg;base64,${(await page.screenshot({type:'jpeg',quality:75,scale:'css'})).toString('base64')}`};
  }finally{await browser.close();}
}

/** Direct viewport recording: CSS, JavaScript timers and rAF use the same frame clock. */
export async function renderTour(config: ShowsiteConfig, options: RenderOptions={}): Promise<RenderResult> {
  const started=Date.now();const progress=(phase:string,percent:number)=>options.onProgress?.({phase,percent});
  options.signal?.throwIfAborted();progress('Opening full tour',2);
  const browser=await launchBrowser(config.chromePath);
  let encoder:Encoder|undefined, partial:string|undefined;
  const cancel=()=>{encoder?.abort();void browser.close().catch(()=>{});};
  options.signal?.addEventListener('abort',cancel,{once:true});
  try{
    options.signal?.throwIfAborted();
    const {page,context,layout}=await preparePage(browser,config,options.signal);
    const scan=await inspect(page,config.url);
    const maxY=Math.max(0,scan.pageHeight-scan.viewport.height);
    const tour={...config.tour,stops:config.tour.stops.length?config.tour.stops:autoTourStops(maxY,scan.viewport.height,scan.sections)};
    const steps=planTour(maxY,scan.viewport.height,tour);
    const scrollEnd=steps.at(-1)!.start+steps.at(-1)!.duration;
    const total=scrollEnd+(tour.endClick?tour.clickHold:0);
    const frames=Math.ceil(total*config.fps);
    const out=path.resolve(config.out??defaultOutFile(config.url,config.format));
    await mkdir(path.dirname(out),{recursive:true});
    partial=`${out}.partial-${randomUUID()}.mp4`;
    encoder=startEncoder({out:partial,fps:config.fps,width:layout.output.width,height:layout.output.height,duration:frames/config.fps,audio:[]});
    options.signal?.throwIfAborted();
    const cdp=await context.newCDPSession(page);
    let index=0,clicked=false,checkedPanel=false;
    log.step(`Recording full tour · ${Math.ceil(total)} seconds`);
    progress(`Recording full tour · ${Math.ceil(total)} seconds`,10);
    for(let i=0;i<frames;i++){
      options.signal?.throwIfAborted();const t=i/config.fps;
      while(index<steps.length-1&&t>=steps[index]!.start+steps[index]!.duration)index++;
      if(t<scrollEnd)await page.evaluate(y=>window.scrollTo({top:y,left:0,behavior:'instant'}),tourY(steps[index]!,t));
      else if(!clicked&&tour.endClick){
        const target=page.locator(tour.endClick);
        if(await target.count()!==1)throw new Error('The ending button must match exactly one element. Rescan or edit its selector.');
        if(!await target.isVisible())throw new Error('The ending button is hidden at the bottom of the page. Choose a visible button.');
        // Clock is paused; use a DOM click so Playwright's stability wait does not need a live rAF loop.
        await target.evaluate((e:HTMLElement)=>e.click());clicked=true;
      }
      if(clicked&&tour.endScroll&&t>scrollEnd+4){
        const panel=page.locator(tour.endScroll);
        if(!checkedPanel){if(await panel.count()!==1||!await panel.isVisible())throw new Error('The ending scroll panel was not found. Check its selector.');checkedPanel=true;}
        const p=Math.min(1,(t-scrollEnd-4)/2.5);
        await panel.evaluate((e:HTMLElement,p:number)=>e.scrollTop=(e.scrollHeight-e.clientHeight)*(1-Math.cos(Math.PI*p))/2,p);
      }
      await page.clock.runFor(Math.round((i+1)*1000/config.fps)-Math.round(i*1000/config.fps));
      const shot=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:94,optimizeForSpeed:true});
      await encoder.write(Buffer.from(shot.data,'base64'));
      if(i%Math.max(1,Math.round(config.fps/2))===0){
        log.progress(`${((i+1)/config.fps).toFixed(1)}s of ${total.toFixed(1)}s`,i+1,frames);
        progress(clicked?'Recording ending action':`Recording · ${steps[index]!.name}`,Math.round(10+(i+1)/frames*85));
      }
    }
    progress('Finishing MP4',97);await encoder.finish();options.signal?.throwIfAborted();
    await rename(partial,out);partial=undefined;progress('Ready',100);
    const plan:Plan={total:frames/config.fps,fadeIn:0,fadeOut:0,scenes:steps.map((s,i)=>({key:String(i),name:s.name,caption:'',start:s.start,duration:s.duration,camera:s.kind==='scroll'?'scroll':'hold',fromY:s.from,toY:s.to,travel:s.kind==='scroll'?s.duration:0,zoomTo:1}))};
    return {file:out,duration:frames/config.fps,frames,plan,scan,seconds:(Date.now()-started)/1000};
  }catch(error){encoder?.abort();throw error;}
  finally{
    options.signal?.removeEventListener('abort',cancel);await browser.close().catch(()=>{});
    if(partial)await rm(partial,{force:true}).catch(()=>{});
  }
}
