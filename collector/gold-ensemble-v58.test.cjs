'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const m=require('./gold-ensemble-v58.cjs');
const D=86400000,origin=Date.UTC(2024,0,1);
function history(n=900){
 return Array.from({length:n},(_,i)=>({date:new Date(origin+i*D).toISOString().slice(0,10),
 usdOz:2500*Math.exp(.0007*i+.025*Math.sin(i/13)+.009*Math.cos(i/5))}));
}
test('provides all six forward research windows without claiming exact forecasts',()=>{
 const rows=history(900);const now=new Date(rows.at(-1).date+'T12:00:00Z');
 const x=m.evaluate(rows,now);
 assert.deepEqual(x.horizons.map(h=>h.days),[1,3,7,14,30,90]);
 assert.equal(x.engine,'adaptive_four_model_causal_research');
 assert.ok(x.horizons.every(h=>h.modelCount===4&&h.indicativeUsdOzRange));
 assert.ok(x.horizons.every(h=>h.indicativeUsdOzRange.lowUsdOz<=h.indicativeUsdOzRange.midUsdOz));
 assert.ok(x.horizons.every(h=>h.indicativeUsdOzRange.midUsdOz<=h.indicativeUsdOzRange.highUsdOz));
 assert.ok(x.horizons.every(h=>['unproven','historically_supported'].includes(h.confidence)));
});
test('only past known labels can enter a forecast, never future closes',()=>{
 const rows=history(900),prices=rows.map(r=>r.usdOz),f=prices.map((_,i)=>m.features(prices,i));
 const originAt=790,h=21,model=m.MODELS[0];
 const first=m.distribution(prices,f,originAt,h,model);
 const mutated=[...prices];for(let i=originAt+1;i<mutated.length;i++)mutated[i]*=1.5;
 const ff=mutated.map((_,i)=>m.features(mutated,i));
 const second=m.distribution(mutated,ff,originAt,h,model);
 assert.deepEqual(first.probabilities,second.probabilities);
 assert.deepEqual(first.scenarios,second.scenarios);
});
test('three-way historical outcome buckets are bounded and sum to 100 approximately',()=>{
 const rows=history(900),prices=rows.map(r=>r.usdOz),f=prices.map((_,i)=>m.features(prices,i));
 for(const period of m.PERIODS){
  for(const model of m.MODELS){
   const z=m.distribution(prices,f,prices.length-1,period.sessions,model);
   assert.ok(z&&z.referenceCases>=40);
   const p=Object.values(z.probabilities);
   assert.ok(p.every(x=>x>=0&&x<=100));
   assert.ok(Math.abs(p.reduce((a,b)=>a+b,0)-100)<.04);
  }
 }
});
test('holdout cannot be labeled validated without enough later checks',()=>{
 const rows=history(900),x=m.evaluate(rows,new Date(rows.at(-1).date+'T10:00:00Z'));
 for(const h of x.horizons){
  if(h.validation.selectedModelValidated)
   assert.ok(h.validation.checksLater>=20&&h.validation.laterImprovement>=.025);
 }
 const h90=x.horizons.find(h=>h.days===90);
 assert.ok(h90.validation.checksLater<20);
 assert.equal(h90.validation.selectedModelValidated,false);
});
test('insufficient history and stale prices are not represented as live prediction',()=>{
 const rows=history(900);
 assert.throws(()=>m.evaluate(rows.slice(0,200),new Date(rows[199].date+'T10:00:00Z')),/420/);
 assert.throws(()=>m.evaluate(rows,new Date('2030-01-01T10:00:00Z')),/stale/);
});
test('trend, regime, reversion and analog models are distinct and specified',()=>{
 assert.deepEqual(m.MODELS.map(x=>x.id),['analogue','trend','reversion','regime']);
 assert.equal(m.direction(2,1),'rise');assert.equal(m.direction(-2,1),'fall');assert.equal(m.direction(.1,1),'range');
});
