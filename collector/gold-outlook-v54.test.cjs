'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const m=require('./gold-outlook-v54.cjs');
function testRows(days=440) {
 const from=Date.UTC(2025,6,1);
 return Array.from({length:days},(_,i)=>({date:new Date(from+i*86400000).toISOString().slice(0,10),
  usdOz:3200*Math.exp(.0006*i+.045*Math.sin(i/9)+.012*Math.cos(i/17))}));
}
test('parses XAUS daily series and ignores invalid or impossible quotes',()=>{
 const r=m.cleanHistory({points:[{d:'2026-11-17',c:4200},{d:'2026-11-17',c:4210},{d:'2026-11-18',c:'bad'},
  {d:'2027-02-01',c:4300},{d:'2026-11-20',c:4250}]},new Date('2026-11-21T00:00:00Z'));
 assert.equal(r.length,2);assert.equal(r[0].usdOz,4210);
});
test('computes transparent 3 7 14 30 day windows from genuine dates',()=>{
 const data=testRows(440),now=new Date(data.at(-1).date+'T10:00:00Z'),r=m.model(data,now);
 assert.deepEqual(r.horizons.map(h=>h.days),[3,7,14,30]);
 assert.equal(r.historyCount,440);
 assert.ok(r.horizons.every(x=>x.scenarios&&x.scenarios.lowPct<=x.scenarios.midPct&&x.scenarios.midPct<=x.scenarios.highPct));
 assert.ok(r.horizons.every(x=>x.validation.count>=20));
 assert.ok(r.horizons.every(x=>['rise','fall','range'].includes(x.direction)));
 assert.equal(r.horizons[1].warning.includes('NOT the exact day'),true);
});
test('unreliable history stops rather than inventing outcomes',()=>{
 assert.throws(()=>m.model(testRows(70),new Date('2026-11-20T10:00:00Z')),/at least 160/);
 assert.throws(()=>m.model(testRows(170),new Date('2026-11-21T10:00:00Z')),/too old/);
});
test('source measurements are explicit and conditional',()=>{
 const x=m.model(testRows(220),new Date(testRows(220).at(-1).date+'T12:00:00Z'));
 const e=m.renderEvidence(x,[{name:'U.S. 10-year inflation-adjusted yield',available:true,last:1.5,change5:.2,source:'https://fred.stlouisfed.org',asOf:x.asOf,unit:'percentage points'}]);
 assert.equal(e.length,4);
 assert.ok(e.every(x=>x.source.startsWith('https://')));
 assert.match(e[3].interpretation,/not a certain effect/);
});

test('multi-factor research shows actual source dates and no unsupported probability',()=>{
 const rows=testRows(440),now=new Date(rows.at(-1).date+'T10:00:00Z');
 const modeled=m.model(rows,now),macro=[
  {name:'U.S. 10-year inflation-adjusted yield',available:true,change5:.25,asOf:modeled.asOf,source:'https://fred.stlouisfed.org/graph/'},
  {name:'Broad U.S. dollar index',available:true,change5:-.65,asOf:modeled.asOf,source:'https://fred.stlouisfed.org/graph/'}
 ];
 const d=m.deepResearch(modeled,macro,{usdOz:modeled.historyLastUsdOz*1.01,asOf:now.toISOString(),source:'https://api.gold-api.com/price/XAU'},now);
 assert.equal(d.sourceSignals.length,5);
 assert.ok(d.driverReasons.length>=2);
 assert.ok(d.levels.movingAverage20>0&&d.levels.movingAverage50>0);
 assert.ok(d.levels.prior20High>=d.levels.prior20Low);
 assert.ok(d.modelAudit.byHorizon.every(h=>typeof h.edgeDemonstrated==='boolean'));
 assert.ok(d.reliabilityNotes.some(t=>t.includes('NOT calibrated probabilities')));
 assert.equal(d.classification.match(/pressure|mixed/)!==null,true);
});
test('missing macro feeds leave explicit gaps rather than fabricated readings',()=>{
 const rows=testRows(440),now=new Date(rows.at(-1).date+'T10:00:00Z');
 const d=m.deepResearch(m.model(rows,now),[],null,now);
 assert.equal(d.sourceSignals.length,2);
 assert.equal(d.levels.spotVsLastHistoryClosePct,null);
 assert.equal(d.watchFor.length,4);
});
