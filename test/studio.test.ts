import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { createServer, request, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { startStudio, studioConfig, serveFile } from "../src/studio.js";
vi.mock('../src/narration.js', () => ({ listVoices: async () => [], selectVoice: vi.fn(), synthesizeSpeech: vi.fn() }));
let studio: Awaited<ReturnType<typeof startStudio>>;
let token = '';
let temporary = '';
beforeAll(async()=>{ temporary=await mkdtemp(path.join(os.tmpdir(),'showsite-test-')); studio=await startStudio({port:0,open:false,outputDirectory:temporary}); const data=await (await fetch(studio.url+'/api/bootstrap')).json() as any;token=data.token; });
afterAll(async()=>{ await studio?.close(); await rm(temporary,{recursive:true,force:true}); });
const post=(data: unknown, headers: Record<string,string>={})=>fetch(studio.url+'/api/validate',{method:'POST',headers:{'content-type':'application/json','x-showsite-token':token,...headers},body:JSON.stringify(data)});

describe('local Studio boundary',()=>{
  it('serves the editor and its offline assets',async()=>{for(const p of ['/','/studio.js','/studio.css','/font.woff2','/demo'])expect((await fetch(studio.url+p)).status).toBe(200);});
  it('requires the session token for actions',async()=>expect((await post({url:'example.com'},{'x-showsite-token':'invalid'})).status).toBe(403));
  it('rejects cross-origin requests even with a token',async()=>expect((await post({url:'example.com'},{origin:'https://untrusted.example'})).status).toBe(403));
  it('rejects DNS rebinding hosts',async()=>{ const status=await new Promise<number|undefined>((resolve,reject)=>{const req=request(studio.url+'/api/bootstrap',{headers:{host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});expect(status).toBe(403); });
  it('allows the public demo to be recorded in an iframe',async()=>expect((await fetch(studio.url+'/demo',{headers:{'sec-fetch-site':'cross-site',origin:'http://showsite.local'}})).status).toBe(200));
  it('validates imported projects without launching a browser',async()=>{const res=await post({url:'localhost:3000',narration:{enabled:true}});expect(res.status).toBe(200);expect(await res.json()).toMatchObject({url:'http://localhost:3000/',music:'none'});});
  it.each([{out:'/tmp/overwrite'},{chromePath:'/tmp/executable'},{audio:'/etc/private'}])('does not expose host filesystem paths through imported configs',async bad=>{expect((await post({url:'example.com',...bad})).status).toBe(400);});
  it('rejects oversized request bodies',async()=>expect((await post({url:'example.com',padding:'x'.repeat(262144)})).status).toBe(400));
  it('saves projects on disk and roundtrips scripts and timing through a download',async()=>{
    const config={url:'https://example.com/',fps:24,narration:{enabled:true,rate:165},scenes:[{section:1,caption:'Welcome',narration:'A separate script',duration:3.4,camera:'hold'}]};
    const res=await fetch(studio.url+'/api/projects',{method:'POST',headers:{'content-type':'application/json','x-showsite-token':token},body:JSON.stringify(config)});
    expect(res.status).toBe(201);
    const saved=await res.json() as {file:string;url:string};
    const disk=JSON.parse(await readFile(saved.file,'utf8'));
    expect(disk).toMatchObject(config);
    const download=await fetch(studio.url+saved.url);
    expect(download.headers.get('content-disposition')).toContain('attachment;');
    expect(await download.json()).toEqual(disk);
    expect(studioConfig(disk)).toMatchObject(config);
  });
  it('does not render without scenes',async()=>{const res=await fetch(studio.url+'/api/render',{method:'POST',headers:{'content-type':'application/json','x-showsite-token':token},body:JSON.stringify({url:'example.com'})});expect(res.status).toBe(400);});
  it('serves no arbitrary local path',async()=>expect((await fetch(studio.url+'/api/video/not-a-file')).status).toBe(403));
});

describe('video seeking',()=>{
  let server: Server, url: string;
  beforeAll(async()=>{const file=path.join(temporary,'range.bin');await writeFile(file,'0123456789');server=createServer((req,res)=>{void serveFile(req,res,file,'application/octet-stream');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));url=`http://127.0.0.1:${(server.address() as any).port}`;});
  afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
  it('returns just the requested bytes',async()=>{const res=await fetch(url,{headers:{range:'bytes=2-5'}});expect(res.status).toBe(206);expect(res.headers.get('content-range')).toBe('bytes 2-5/10');expect(await res.text()).toBe('2345');});
  it('handles suffix ranges',async()=>{const res=await fetch(url,{headers:{range:'bytes=-3'}});expect(await res.text()).toBe('789');});
  it('rejects ranges past the end',async()=>expect((await fetch(url,{headers:{range:'bytes=100-'}})).status).toBe(416));
});
