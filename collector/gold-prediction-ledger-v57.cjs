'use strict';
/* v5.7 Gold Prediction Learning Ledger
   - Every published prediction is locked before later observed outcomes.
   - The provider's dated daily close, not a future guess, settles each outcome.
   - Adaptation stays OFF until an earlier train / later holdout test beats baseline.
   - Never backfills historical model predictions or relabels unproven skill as AI accuracy. */
const crypto=require('node:crypto');
const DAYS=[1,3,7,14,30,90],ALLOWED=new Set(DAYS);
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const numberOrNull=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const clip=(x,lo=.05,hi=.95)=>Math.min(hi,Math.max(lo,x));
const rounded=(x,n=3)=>Number.isFinite(x)?Number(x.toFixed(n)):null;
const isDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function normalize(rows,now){
 const limit=now.toISOString().slice(0,10),map=new Map();
 for(const x of Array.isArray(rows)?rows:[]){
  const d=x?.date,v=Number(x?.usdOz);
  if(isDay(d)&&d<=limit&&Number.isFinite(v)&&v>300&&v<15000)map.set(d,{date:d,usdOz:v});
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
}
function hKey(e){return e.originDate+'|'+e.days;}
function digest(e){return crypto.createHash('sha256').update(JSON.stringify([
 e.originDate,e.days,e.sessions,e.referenceUsdOz,e.predictedDirection,
 e.scenario,e.rawPositivePct,e.modelVersion])).digest('hex').slice(0,16);}
function brier(list,fn){
 return list.reduce((s,r)=>{const d=fn(r)-(r.actualDirection==='rise'?1:0);return s+d*d;},0)/list.length;
}
function adapt(p,fit){return clip(.5+fit.gain*(p-.5)+fit.bias);}
function trainingForHorizon(settled,days){
 const candidates=settled.filter(e=>e.days===days&&
    Number.isFinite(e.rawPositivePct)&&e.rawPositivePct>=0&&e.rawPositivePct<=100)
    .sort((a,b)=>String(a.actualDate).localeCompare(String(b.actualDate))||String(a.originDate).localeCompare(String(b.originDate)));
 const n=candidates.length;
 const base={days,settled:n,minimum:40,learning:'collecting',applied:false,trained:0,holdout:0,
  trainingBrier:null,baselineBrier:null,holdoutBrier:null,holdoutBaselineBrier:null,holdoutImprovement:null,
  gain:null,bias:null,description:'Only forecasts recorded BEFORE their outcomes can train this model.'};
 if(n<40)return base;
 const split=Math.floor(n*.7),train=candidates.slice(0,split),holdout=candidates.slice(split);
 if(train.length<28||holdout.length<12)return base;
 const baseRate=clip((train.filter(e=>e.actualDirection==='rise').length+5)/(train.length+10));
 const scores=[];
 for(const gain of [0,.25,.5,.75,1,1.25]){
  for(const bias of [-.10,-.05,0,.05,.10]){
   const fit={gain,bias};
   scores.push({fit,loss:brier(train,e=>adapt(e.rawPositivePct/100,fit))});
  }
 }
 scores.sort((a,b)=>a.loss-b.loss);
 const winner=scores[0],evalLoss=brier(holdout,e=>adapt(e.rawPositivePct/100,winner.fit));
 const baseline=brier(holdout,()=>baseRate),gain=baseline-evalLoss;
 const verified=gain>=.01; // Meaningful lower Brier score on later, unseen outcomes
 return {...base,learning:verified?'validated':'paused_no_out_of_sample_edge',applied:verified,
  trained:train.length,holdout:holdout.length,trainingBrier:rounded(winner.loss,4),
  baselineBrier:rounded(brier(train,()=>baseRate),4),holdoutBrier:rounded(evalLoss,4),
  holdoutBaselineBrier:rounded(baseline,4),holdoutImprovement:rounded(gain,4),
  gain:verified?winner.fit.gain:null,bias:verified?winner.fit.bias:null,
  description:verified?
    'A simple calibration improved Brier score on later held-out outcomes. It may still fail in future.':
    'The learned calibration did not beat its historical baseline on later outcomes; automatic adjustments remain disabled.'};
}
function rubric(e,returnPct){
 if(e.predictedDirection==='rise')return returnPct>0;
 if(e.predictedDirection==='fall')return returnPct<0;
 return Math.abs(returnPct)<=.5; // explicit neutral band for sideways forecasts
}
function validOldEntry(e){
 return e&&isDay(e.originDate)&&ALLOWED.has(e.days)&&Number.isInteger(e.sessions)&&
  e.sessions>0&&e.sessions<=90&&positive(e.referenceUsdOz)&&
  ['rise','fall','range'].includes(e.predictedDirection)&&['pending','resolved'].includes(e.status);
}
function importLegacy(legacy,now){
 if(!Array.isArray(legacy?.entries))return [];
 const at=Number.isFinite(Date.parse(legacy.generatedAt))?legacy.generatedAt:now.toISOString();
 return legacy.entries.map(e=>({
  id:e.originDate+'|'+e.days,originDate:e.originDate,createdAt:at,
  days:e.days,sessions:e.sessions,referenceUsdOz:e.referenceUsdOz,
  predictedDirection:e.lean,rawPositivePct:numberOrNull(e.historicalSampleRisePct),
  modelVersion:'5.6-legacy',legacy:true,scenario:null,
  modelEdgeDemonstrated:!!e.modelEdgeDemonstrated,
  status:e.status==='resolved'?'pending':'pending',sourceUrl:'https://xaus.com/api/v1/history',
  note:'Migrated from the original v5.6 journal. No new historical forecasts were invented.'
 })).filter(validOldEntry);
}
function summarize(entries,models){
 const resolved=entries.filter(e=>e.status==='resolved'),pending=entries.filter(e=>e.status==='pending');
 const passed=resolved.filter(e=>e.passed===true),failed=resolved.filter(e=>e.passed===false);
 const rates=resolved.filter(e=>Number.isFinite(e.absoluteMidErrorPct));
 return {recorded:entries.length,pending:pending.length,resolved:resolved.length,passed:passed.length,failed:failed.length,
  overallDirectionHitRate:resolved.length?rounded(passed.length/resolved.length*100,1):null,
  averageMidPriceErrorPct:rates.length?rounded(rates.reduce((a,e)=>a+e.absoluteMidErrorPct,0)/rates.length,2):null,
  byHorizon:DAYS.map(days=>{
   const a=resolved.filter(e=>e.days===days),p=pending.filter(e=>e.days===days),pass=a.filter(e=>e.passed).length,
    mids=a.filter(e=>Number.isFinite(e.absoluteMidErrorPct)),
    bounded=a.filter(e=>typeof e.rangeHit==='boolean');
   return {days,recorded:a.length+p.length,resolved:a.length,pending:p.length,passed:pass,failed:a.length-pass,
    hitRate:a.length?rounded(pass/a.length*100,1):null,
    averageMidPriceErrorPct:mids.length?rounded(mids.reduce((s,e)=>s+e.absoluteMidErrorPct,0)/mids.length,2):null,
    rangeCoveragePct:bounded.length?rounded(bounded.filter(e=>e.rangeHit).length/bounded.length*100,1):null,
    learning:models.find(m=>m.days===days)?.learning||'collecting'};
  }),
  definition:'PASS means the observed later close matched the locked forecast direction. RISE > 0%, FALL < 0%; RANGE means within ±0.5% of the recorded starting close. All other settled outcomes are FAIL.',
  horizonRule:'A horizon is settled after the required number of NEW dated provider closing observations, not at a promised exact calendar time.',
  warning:'Past accuracy is not guaranteed future performance. Models are not trained on pending outcomes.'};
}
function updateLedger({previous=null,legacy=null,history=[],horizons=[],now=new Date(),modelVersion='5.6',sourceUrl='https://xaus.com/api/v1/history'}={}){
 const rows=normalize(history,now),byDate=new Map(rows.map((row,i)=>[row.date,i]));
 let entries=Array.isArray(previous?.entries)?previous.entries.filter(validOldEntry).map(e=>({...e})):importLegacy(legacy,now);
 // Do not delete or rewrite original forecast snapshots; only status/actual fields change.
 const seen=new Set(entries.map(hKey));let newlyRecorded=0,newlySettled=0;
 for(const e of entries){
  if(e.status==='resolved')continue;
  const index=byDate.get(e.originDate);
  if(index===undefined||rows[index].usdOz!==e.referenceUsdOz||index+e.sessions>=rows.length)continue;
  const actual=rows[index+e.sessions];
  // Protection against creating "predictions" after a target closing date.
  if(Number.isFinite(Date.parse(e.createdAt))&&
     Date.parse(e.createdAt)>=Date.parse(actual.date+'T00:00:00Z'))continue;
  const changePct=(actual.usdOz/e.referenceUsdOz-1)*100;
  const range=e.scenario;
  const actualPct=rounded(changePct,4);
  e.status='resolved';e.actualDate=actual.date;e.actualUsdOz=actual.usdOz;
  e.actualReturnPct=actualPct;
  e.actualDirection=changePct>0?'rise':changePct<0?'fall':'range';
  e.passed=rubric(e,changePct);
  e.verdict=e.passed?'PASS':'FAIL';
  e.resolvedAt=now.toISOString();e.settlementSourceUrl=e.sourceUrl||sourceUrl;
  if(range&&Number.isFinite(range.lowPct)&&Number.isFinite(range.midPct)&&Number.isFinite(range.highPct)){
   const mid=e.referenceUsdOz*(1+range.midPct/100);
   e.predictedMiddleUsdOz=rounded(mid,2);
   e.absoluteMidErrorPct=rounded(Math.abs(mid/actual.usdOz-1)*100,3);
   e.rangeHit=changePct>=range.lowPct&&changePct<=range.highPct;
  }
  newlySettled++;
 }
 const settled=entries.filter(e=>e.status==='resolved');
 // Fit only on actual completed historical outcomes; no pending predictions are training data.
 const models=DAYS.map(days=>trainingForHorizon(settled,days));
 const current=rows.at(-1),currentAge=current?(Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')-
  Date.parse(current.date+'T00:00:00Z'))/86400000:Infinity;
 if(rows.length>=160&&currentAge>=0&&currentAge<=4){
  for(const h of horizons){
   if(!ALLOWED.has(h?.days)||!Number.isInteger(h.sessions)||h.sessions<1||h.sessions>90||
    !['rise','fall','range'].includes(h.direction)||seen.has(current.date+'|'+h.days))continue;
   const learning=models.find(m=>m.days===h.days),raw=numberOrNull(h.probUp);
   const corrected=learning?.applied&&raw!==null?rounded(adapt(raw/100,learning)*100,2):null;
   const prediction=corrected!==null?corrected>=57?'rise':corrected<=43?'fall':'range':h.direction;
   const scenario=h.scenarios&&
    [h.scenarios.lowPct,h.scenarios.midPct,h.scenarios.highPct].every(Number.isFinite)?
      {lowPct:h.scenarios.lowPct,midPct:h.scenarios.midPct,highPct:h.scenarios.highPct}:null;
   const entry={id:current.date+'|'+h.days,originDate:current.date,createdAt:now.toISOString(),
    days:h.days,sessions:h.sessions,referenceUsdOz:current.usdOz,predictedDirection:prediction,
    rawDirection:h.direction,rawPositivePct:raw,adaptedPositivePct:corrected,
    learningApplied:corrected!==null,modelVersion,modelEdgeDemonstrated:!!h.validation?.edgeDemonstrated,
    scenario,status:'pending',sourceUrl,
    evidence:{historyAsOf:current.date,historyCount:rows.length},
    note:'Frozen before the next required dated closing observations.'};
   entry.snapshotHash=digest(entry);entries.push(entry);seen.add(hKey(entry));newlyRecorded++;
  }
 }
 entries.sort((a,b)=>a.originDate.localeCompare(b.originDate)||a.days-b.days);
 const summary=summarize(entries,models);
 return {schemaVersion:2,version:'5.7',generatedAt:now.toISOString(),
  provider:'Dated gold closing prices, collected from a public historical feed',
  sourceUrl,entries,summary,
  learning:{status:models.some(m=>m.applied)?'validation_enabled':'learning_or_unproven',
   models,settledForLearning:settled.length,
   note:'Training requires at least 40 settled predictions per period. Uses earlier 70% to train and later 30% to test calibration. Only adjusts new forecasts if holdout Brier improves by at least 0.01.',
   warning:'Learning can reduce some historical error, but no improvement or future predictive skill is guaranteed.'},
  newlyRecorded,newlySettled};
}
module.exports={DAYS,normalize,updateLedger,trainingForHorizon,rubric};
