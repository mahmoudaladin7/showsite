import { describe, expect, it } from 'vitest';
import { autoTourStops, planTour, tourY } from '../src/tour-plan.js';
import { resolveConfig } from '../src/config.js';
import { tourLayout } from '../src/tour.js';
const settings=(tour={})=>resolveConfig({url:'example.com',mode:'tour',tour}).tour;

describe('full tour coverage and pacing',()=>{
 it('covers a long pinned page and footer without a six-scene cap',()=>{
  const stops=autoTourStops(31108,720,[{top:0,name:'Hero'},{top:30000,name:'Footer'}]);
  const steps=planTour(31108,720,settings({stops}));
  expect(stops.length).toBeGreaterThan(30);expect(steps[0]?.from).toBe(0);expect(steps.at(-1)?.to).toBe(31108);
  for(let i=1;i<steps.length;i++){expect(steps[i]!.from).toBe(steps[i-1]!.to);expect(steps[i]!.start).toBeCloseTo(steps[i-1]!.start+steps[i-1]!.duration);}
 });
 it('respects the maximum velocity, including during the middle of easing',()=>{
  const steps=planTour(10000,720,settings({speed:180,stops:[{y:0,name:'Top'},{y:10000,name:'Bottom'}]}));
  const move=steps.find(s=>s.kind==='scroll')!;
  for(let t=move.start;t<move.start+move.duration-.01;t+=.1)expect((tourY(move,t+.01)-tourY(move,t))/.01).toBeLessThanOrEqual(180.001);
 });
 it('slower speed adds travel time, while custom pauses only add reading time',()=>{
  const end=(speed:number,hold:number)=>{const s=planTour(2000,720,settings({speed,stops:[{y:1000,name:'Detail',hold}]}));return s.at(-1)!.start+s.at(-1)!.duration;};
  expect(end(150,2)).toBeGreaterThan(end(300,2));expect(end(300,7)-end(300,2)).toBeCloseTo(5);
 });
 it('sorts edited stops, clamps to the measured page, and always includes top and bottom',()=>{
  const steps=planTour(2000,720,settings({stops:[{y:9000,name:'Old footer'},{y:900,name:'Middle'},{y:300,name:'Earlier'}]}));
  expect(steps.filter(s=>s.kind==='hold').map(s=>s.to)).toEqual([0,300,900,2000]);
 });
 it('deduplicates coincident stops and handles a one-screen page',()=>{
  const steps=planTour(0,720,settings({stops:[{y:0,name:'One'},{y:0,name:'Two'}]}));
  expect(steps).toHaveLength(1);expect(steps[0]?.duration).toBe(3);
 });
 it('bounds preview count on very tall pages without losing the bottom',()=>{
  const stops=autoTourStops(1000000,720);expect(stops.length).toBeLessThanOrEqual(162);expect(stops.at(-1)?.y).toBe(1000000);
 });
 it.each(['16:9','1:1','9:16'] as const)('renders the complete %s viewport at its output aspect ratio',format=>{
  const l=tourLayout(format);expect(l.viewport.width*l.scale).toBe(l.output.width);expect(l.viewport.height*l.scale).toBe(l.output.height);
 });
});

describe('tour project validation',()=>{
 it('keeps old projects in highlights mode',()=>expect(resolveConfig({url:'example.com'}).mode).toBe('highlights'));
 it('roundtrips custom stops and ending actions',()=>{
  const c=resolveConfig({url:'example.com',mode:'tour',tour:{speed:200,hold:2,stops:[{y:1234,name:'Material detail',hold:8}],endClick:'#begin',endScroll:'#dialog',clickHold:14}});
  expect(resolveConfig(JSON.parse(JSON.stringify(c)))).toEqual(c);
 });
 it.each([{speed:0},{speed:Infinity},{hold:-1},{clickHold:2},{stops:[{y:-1,name:'bad'}]},{stops:[{y:1,name:''}]},{stops:[{y:1,name:'x',hold:31}]},{endClick:''},{endScroll:'#panel'},{stops:Array.from({length:201},()=>({y:1,name:'x'}))}])('rejects invalid tour settings: %j',tour=>expect(()=>settings(tour)).toThrow());
});
