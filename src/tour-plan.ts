import type { TourConfig, TourStop } from './config.js';

export interface TourStep { kind: 'hold' | 'scroll'; from: number; to: number; start: number; duration: number; name: string }

/** Preview stops are bounded; the path between them still covers every scroll position. */
export function autoTourStops(maxY: number, viewport: number, sections: { top: number; name: string }[] = []): TourStop[] {
  const spacing = Math.max(viewport, Math.ceil(maxY / 160));
  const points = new Set([0, maxY]);
  for (let y = spacing; y < maxY; y += spacing) points.add(y);
  for (const section of sections.slice(0, 30)) {
    const y = Math.max(0, Math.min(maxY, section.top));
    for (const p of points) if (p !== 0 && p !== maxY && Math.abs(p - y) < spacing * .4) points.delete(p);
    points.add(y);
  }
  return [...points].sort((a,b) => a-b).map(y => ({ y: Math.round(y), name: [...sections].sort((a,b) => b.top-a.top).find(s => s.top <= y+2)?.name ?? 'Website' }));
}

/** Start/end coverage is mandatory, even when the user removes or reorders pauses. */
export function planTour(maxY: number, viewport: number, tour: TourConfig): TourStep[] {
  if (!Number.isFinite(maxY) || maxY < 0 || !Number.isFinite(viewport) || viewport <= 0) throw new Error('Invalid page dimensions.');
  if (!Number.isFinite(tour.speed) || tour.speed < 30 || tour.speed > 2000 || !Number.isFinite(tour.hold) || tour.hold < 0 || tour.hold > 30) throw new Error('Invalid tour speed or pause.');
  const stops = new Map<number, TourStop>();
  for (const stop of tour.stops.length ? tour.stops : autoTourStops(maxY, viewport)) {
    const y = Math.max(0, Math.min(maxY, stop.y));
    stops.set(y, { ...stop, y });
  }
  if (!stops.has(0)) stops.set(0, { y:0, name:'Top of page' });
  if (!stops.has(maxY)) stops.set(maxY, { y:maxY, name:'End of page' });
  let start=0, previous=0;
  const steps: TourStep[]=[];
  for (const stop of [...stops.values()].sort((a,b)=>a.y-b.y)) {
    if (stop.y > previous) {
      // Sine easing's maximum derivative is PI/2. The configured speed is the peak, not the average.
      const duration=(stop.y-previous)*Math.PI/(2*tour.speed);
      steps.push({kind:'scroll',from:previous,to:stop.y,start,duration,name:stop.name});start+=duration;
    }
    const hold=stop.hold ?? tour.hold;
    const duration=stop.y===0||stop.y===maxY ? Math.max(3,hold) : hold;
    if(duration){steps.push({kind:'hold',from:stop.y,to:stop.y,start,duration,name:stop.name});start+=duration;}
    previous=stop.y;
  }
  return steps;
}
export function tourY(step: TourStep, time: number) {
  const p=Math.max(0,Math.min(1,(time-step.start)/step.duration));
  return step.from+(step.to-step.from)*(1-Math.cos(Math.PI*p))/2;
}
