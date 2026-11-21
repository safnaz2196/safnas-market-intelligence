'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ensemble=require('./gold-ensemble-v58.cjs');
const v59=require('./gold-professional-v59.cjs');
const ORIGIN=Date.UTC(2024,0,1),DAY=86400000;
const SERIES=Array.from({length:920},(_,i)=>({date:new Date(ORIGIN+i*DAY).toISOString().slice(0,10),
 usdOz:2400*Math.exp(.0008*i+.035*Math.sin(i/17)+.008*Math.cos(i/6))}));
const NOW=new Date(SERIES.at(-1).date+'T10:00:00Z');
const report=()=>ensemble.evaluate(SERIES,NOW);
test('purged holdout leaves a full horizon gap and avoids claiming long-horizon skill',()=>{
 const audit=v59.gapAwareHoldout(SERIES,{days:7,sessions:5},NOW);
 assert.equal(audit.method,'purged_nonoverlapping_walk_forward');
 assert.equal(audit.gapSessions,5);
 assert.equal(audit.modelAudits.length,5);
 assert.ok(audit.earlyChecks>=35);
 if(audit.validated)assert.ok(audit.laterChecks>=20&&audit.improvement>=.025&&audit.rangeCoveragePct>=50);
 const long=v59.gapAwareHoldout(SERIES,{days:90,sessions:63},NOW);
 assert.equal(long.validated,false);
});
test('local 22K and 24K USD/SAR USD/LKR stress is transparent and not a forex forecast',()=>{
 const adaptive=report(),h=adaptive.horizons[2];
 const fx={asOf:NOW.toISOString(),SAR:3.75,LKR:332.50};
 const out=v59.currencyStress(h,fx,adaptive.historyAsOf,NOW);
 assert.equal(out.available,true);
 assert.equal(out.contexts.length,4);
 const sa22=out.contexts.find(x=>x.currency==='SAR'&&x.karat===22);
 const sa24=out.contexts.find(x=>x.currency==='SAR'&&x.karat===24);
 assert.ok(sa22.constantFx.middle<sa24.constantFx.middle);
 assert.ok(sa22.hypotheticalStress.low<sa22.constantFx.low);
 assert.equal(sa22.fxStressPct,.5);
 assert.equal(out.contexts.find(x=>x.currency==='LKR').fxStressPct,3);
 assert.match(out.label,/NOT a future FX prediction/);
});
test('reject stale/missing exchange reference instead of inventing local predictions',()=>{
 const h=report().horizons[2];
 assert.equal(v59.currencyStress(h,null,'2026-01-01',NOW).available,false);
 assert.equal(v59.currencyStress(h,{asOf:'2019-01-01',SAR:3.75,LKR:300},'2026-01-01',NOW).available,false);
});
test('failed live prediction displays only source-supported error hypotheses',()=>{
 const settled={entries:[{id:'g7',status:'resolved',originDate:'2026-11-01',actualDate:'2026-11-10',days:7,
  verdict:'FAIL',predictedDirection:'rise',referenceUsdOz:3550,actualUsdOz:3410,
  actualReturnPct:-3.94,rangeHit:false,absoluteMidErrorPct:5,
  multiModelSnapshot:{models:[{direction:'rise'},{direction:'fall'}]},
  sourceUrl:'https://xaus.com/api/v1/history'}]};
 const lab=v59.reviewSettled(settled);
 assert.equal(lab.failedReviewed,1);
 assert.equal(lab.studies[0].hypotheses.length,4);
 assert.match(lab.studies[0].caveat,/NOT evidence/);
 assert.equal(lab.studies[0].sourceUrl,'https://xaus.com/api/v1/history');
 const empty=v59.reviewSettled({entries:[]});
 assert.equal(empty.studies.length,0);
 assert.match(empty.description,/No gold forecasts have settled yet/);
});
test('professional report preserves six horizons and clearly marks unproven forecasting',()=>{
 const r=report(),fx={asOf:NOW.toISOString(),SAR:3.75,LKR:330};
 const v=v59.build({history:SERIES,adaptive:r,fx,
  ledger:{summary:{pending:6,resolved:0},entries:[]},goldSpot:{asOf:NOW.toISOString(),usdOz:SERIES.at(-1).usdOz}},NOW);
 assert.equal(v.version,'5.9');assert.equal(v.horizons.length,6);
 assert.equal(v.quality.history,'observed');
 assert.equal(v.summary.forwardPending,6);
 assert.equal(v.failureLab.settledReviewed,0);
 assert.ok(v.horizons.every(h=>h.currencyScenarios.available));
 assert.ok(v.horizons.every(h=>h.validation.status==='insufficient'||h.validation.modelAudits.length===5));
 assert.equal(v.quality.news,'unavailable');
 assert.match(v.guarantees,/None/);
});
test('refuse mismatched history so new report cannot mislabel old prices as current',()=>{
 const adapt=report();
 assert.throws(()=>v59.build({history:SERIES.slice(0,-7),adaptive:adapt},NOW),/do not match/);
});

test('EWMA time-series model is independent of kNN and does not see future prices',()=>{
 const prices=SERIES.map(v=>v.usdOz);
 const at=710,h=10;
 const first=v59.ewmaForecast(prices,at,h);
 const changed=prices.slice();
 for(let i=at+1;i<changed.length;i++)changed[i]*=1.7;
 const second=v59.ewmaForecast(changed,at,h);
 assert.equal(first.id,'ewma');
 assert.ok(first.scenarios.lowPct<first.scenarios.midPct);
 assert.ok(first.scenarios.midPct<first.scenarios.highPct);
 assert.deepEqual(first.probabilities,second.probabilities);
 assert.deepEqual(first.scenarios,second.scenarios);
 assert.ok(Math.abs(Object.values(first.probabilities).reduce((a,b)=>a+b,0)-100)<.001);
});
