'use strict';
const {test}=require('node:test'), assert=require('node:assert/strict');
const {updateLedger,trainingForHorizon,rubric}=require('./gold-prediction-ledger-v57.cjs');
const DAY=86400000,start=Date.UTC(2026,0,1);
const series=Array.from({length:260},(_,i)=>({date:new Date(start+i*DAY).toISOString().slice(0,10),usdOz:3200+i*2}));
const horizon=(days,sessions,direction='rise')=>({days,sessions,direction,probUp:67,
 scenarios:{lowPct:-1,midPct:.5,highPct:2},validation:{edgeDemonstrated:false}});
function run(rows,horizons,prev=null,legacy=null){
 return updateLedger({previous:prev,legacy,history:rows,horizons,
  now:new Date(rows.at(-1).date+'T09:10:00Z'),modelVersion:'v5.7-test'});
}
test('locks all six future horizons on first new dated close, none evaluated in advance',()=>{
 const h=[horizon(1,1),horizon(3,2),horizon(7,5),horizon(14,10),horizon(30,21),horizon(90,63)];
 const v=run(series.slice(0,190),h);
 assert.equal(v.schemaVersion,2);assert.equal(v.entries.length,6);
 assert.equal(v.summary.pending,6);assert.equal(v.summary.resolved,0);
 assert.equal(v.summary.overallDirectionHitRate,null);
 assert.ok(v.entries.every(e=>e.snapshotHash&&e.status==='pending'&&e.scenario.midPct===.5));
 assert.ok(v.entries.every(e=>e.adaptedPositivePct===null));
});
test('automatic PASS/FAIL and absolute price error are calculated only after later observations',()=>{
 const hs=[horizon(1,1,'rise'),horizon(7,5,'fall')];
 const v0=run(series.slice(0,191),hs);
 const v1=run(series.slice(0,200),hs,v0);
 const old=v1.entries.filter(e=>e.originDate===series[190].date);
 assert.equal(old.length,2);assert.equal(v1.summary.resolved,2);
 assert.equal(old.find(e=>e.days===1).verdict,'PASS');
 assert.equal(old.find(e=>e.days===7).verdict,'FAIL');
 assert.equal(old.find(e=>e.days===1).actualDate,series[191].date);
 assert.ok(old.every(e=>Number.isFinite(e.absoluteMidErrorPct)&&typeof e.rangeHit==='boolean'));
 assert.equal(old.find(e=>e.days===1).snapshotHash,v0.entries.find(e=>e.days===1).snapshotHash);
 assert.equal(v1.summary.byHorizon.find(x=>x.days===1).hitRate,100);
});
test('previous forecast for the same date is immutable and never overwritten on repeat polls',()=>{
 const hs=[horizon(7,5,'rise')],v0=run(series.slice(0,190),hs);
 const amended=[horizon(7,5,'fall')],v1=run(series.slice(0,190),amended,v0);
 assert.equal(v1.newlyRecorded,0);assert.equal(v1.entries.length,1);
 assert.equal(v1.entries[0].predictedDirection,'rise');
 assert.equal(v1.entries[0].snapshotHash,v0.entries[0].snapshotHash);
});
test('range PASS within half percent, FAIL outside; model never learns from pending rows',()=>{
 assert.equal(rubric({predictedDirection:'range'},.40),true);
 assert.equal(rubric({predictedDirection:'range'},-.45),true);
 assert.equal(rubric({predictedDirection:'range'},.61),false);
 assert.equal(rubric({predictedDirection:'rise'},-.02),false);
 assert.equal(trainingForHorizon([],7).applied,false);
 const v=run(series.slice(0,190),[horizon(7,5,'rise')]);
 assert.equal(v.learning.models.find(x=>x.days===7).learning,'collecting');
});
test('import v5.6 locked journal without fabricating outcomes and protect from hindsight',()=>{
 const original=run(series.slice(0,190),[horizon(1,1)]);
 const legacy={generatedAt:series[189].date+'T09:10:00Z',
 entries:[{originDate:series[189].date,days:1,sessions:1,referenceUsdOz:series[189].usdOz,
 lean:'fall',historicalSampleRisePct:30,modelEdgeDemonstrated:false,status:'pending'}]};
 const second=run(series.slice(0,190),[horizon(1,1)],null,legacy);
 assert.equal(second.entries.length,1);
 assert.equal(second.entries[0].legacy,true);
 assert.equal(second.entries[0].status,'pending');
 const future=run(series.slice(0,192),[horizon(1,1)],second);
 assert.equal(future.entries[0].verdict,'FAIL');
 // A predated/outcome-known legacy row cannot be incorrectly "passed".
 const cheated={...legacy,generatedAt:series[191].date+'T09:10:00Z'};
 const a=run(series.slice(0,192),[],null,cheated);
 assert.equal(a.entries[0].status,'pending');
});
test('holdout learning engages ONLY after enough earlier resolved and verified skill',()=>{
 const resolved=[];
 for(let i=0;i<60;i++){
  const up=i%2===0;
  resolved.push({days:7,actualDate:new Date(start+i*DAY).toISOString().slice(0,10),
   originDate:new Date(start+(i-6)*DAY).toISOString().slice(0,10),
   rawPositivePct:up?89:11,actualDirection:up?'rise':'fall',status:'resolved'});
 }
 const trained=trainingForHorizon(resolved,7);
 assert.equal(trained.trained,42);assert.equal(trained.holdout,18);
 assert.equal(trained.applied,true);
 assert.ok(trained.holdoutBrier<trained.holdoutBaselineBrier);
 assert.equal(trainingForHorizon(resolved.slice(0,20),7).applied,false);
 const reversed=resolved.map((x,i)=>({...x,actualDirection:i%2===0?'fall':'rise'}));
 assert.equal(trainingForHorizon(reversed,7).applied,false);
});
test('no future close / missing original observation cannot resolve historical prediction',()=>{
 const hs=[horizon(7,5)],v0=run(series.slice(0,190),hs);
 const withoutOrigin=series.slice(0,198).filter(x=>x.date!==series[189].date);
 const out=updateLedger({previous:v0,history:withoutOrigin,horizons:[],now:new Date(series[197].date+'T09:00:00Z')});
 assert.equal(out.entries[0].status,'pending');
});
