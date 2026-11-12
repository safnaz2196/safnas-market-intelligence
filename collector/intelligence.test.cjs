const test=require('node:test'),assert=require('node:assert/strict');
const i=require('./intelligence-core.cjs'),ml=require('./ml-core.cjs');
const samples=Array.from({length:275},(_,n)=>({date:new Date(Date.UTC(2025,0,1+n*2)).toISOString().slice(0,10),close:1000*Math.exp(n*.0004+Math.sin(n/8)*.014+Math.cos(n/19)*.022)}));
test('dated price risk context has finite realized volatility',()=>{const r=i.marketRisk(samples,new Date(samples.at(-1).date+'T09:00:00Z'));assert.equal(r.available,true);assert.ok(Number.isFinite(r.annualizedVolatilityPct));});
test('stale series does not get a market regime',()=>assert.equal(i.marketRisk(samples,new Date('2030-01-01')).available,false));
test('missing annual economic indicator stays missing',()=>{const m=i.macroAudit({gdpGrowth:{points:[{year:'2024',value:5.1}]}},2026);assert.equal(m.available,1);assert.equal(m.indicators.annualInflation.value,null);});
test('company quote alone does not trigger buy recommendation',()=>assert.equal(i.companyCoverage([{ticker:'TEST.N0000',price:10}]).companyPredictionsAvailable,false));
test('240 dated closes can be evaluated with two purged folds and final audit',()=>{const rows=samples.slice(-240),now=new Date(rows.at(-1).date+'T09:00:00Z');for(const h of [5,20]){const result=ml.trainAndValidate(rows,h,now);assert.equal(result.ok,true,result.reason);assert.ok(result.validationSamples>=22)}});
