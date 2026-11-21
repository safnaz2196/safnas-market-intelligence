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
 e.scenario,e.rawPositivePct,e.modelVersion,e.multiModelSnapshot||null])).digest('hex').slice(0,16);}
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
function scoreCandidateModels(settled){
 // Scores reference only forecasts that were recorded before the outcome.
 const ids=['analogue','trend','reversion','regime'];
 return DAYS.map(days=>{
  const rows=settled.filter(e=>e.days===days&&Array.isArray(e.multiModelResults)&&
    e.multiModelResults.length>=4).sort((a,b)=>String(a.actualDate).localeCompare(String(b.actualDate)));
  const scores=ids.map(id=>{
   const data=rows.map(e=>e.multiModelResults.find(x=>x.id===id)).filter(x=>Number.isFinite(x?.multiclassBrier));
   const n=data.length,split=Math.floor(n*.7);
   const early=data.slice(0,split),later=data.slice(split);
   const average=a=>a.reduce((s,x)=>s+x.multiclassBrier,0)/a.length;
   const earlier=early.length?rounded(average(early),4):null,laterBrier=later.length?rounded(average(later),4):null;
   const baselineBrier=rounded(2/3,4);
   return {id,recorded:n,earlyChecks:early.length,laterChecks:later.length,earlierBrier:earlier,
     laterBrier,baselineBrier,improvement:laterBrier===null?null:rounded(baselineBrier-laterBrier,4),
     historicallyValidated:n>=60&&early.length>=42&&later.length>=18&&baselineBrier-laterBrier>=.03};
  });
  const eligible=scores.filter(s=>s.earlyChecks>=42).sort((a,b)=>a.earlierBrier-b.earlierBrier);
  const selected=eligible[0]||null;
  const verified=!!selected?.historicallyValidated;
  return {days,completed:rows.length,selectedModel:verified?selected.id:null,
   candidateSelectedOnEarlierResults:selected?.id||null,
   learning:verified?'limited_forward_holdout_support':'collecting_or_unproven',
   verifiedForwardGain:verified,models:scores,
   warning:verified?'Past forward observations show some skill, but this can disappear.':
    'Not enough later verified outcomes or no advantage over a simple uniform baseline.'};
 });
}
function updateLedger({previous=null,legacy=null,history=[],horizons=[],now=new Date(),modelVersion='5.6',sourceUrl='https://xaus.com/api/v1/history'}={}){
 const rows=normalize(history,now),byDate=new Map(rows.map((row,i)=>[row.date,i]));
 let entries=Array.isArray(previous?.entries)?previous.entries.filter(validOldEntry).map(e=>({...e})):importLegacy(legacy,now);
 // Do not delete or rewrite original forecast snapshots; only status/actual fields change.
 const seen=new Set(entries.map(hKey));let newlyRecorded=0,newlySettled=0;
 for(const e of entries){
  if(e.status==='resolved')continue;
  const index=byDate.get(e.originDate);
  if(index===undefined||rows[index].usdOz!==e.referenceUsdOz){e.remainingCloses=null;continue;}
  const observedAfter=rows.length-1-index;
  e.observedCloses=Math.max(0,observedAfter);
  e.remainingCloses=Math.max(0,e.sessions-observedAfter);
  if(index+e.sessions>=rows.length)continue;
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
  // Score each originally stored candidate model against the LATER verified close.
  // No candidate may be added to an old locked record after its outcome is known.
  if(Array.isArray(e.multiModelSnapshot?.models)){
    const threshold=Number(e.multiModelSnapshot.thresholdPct)||.5;
    const actualClass=changePct>threshold?'rise':changePct< -threshold?'fall':'range';
    e.multiModelResults=e.multiModelSnapshot.models.map(m=>{
      const p=m.probabilities||{};
      const finiteProb=['rise','fall','range'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=100);
      const brier=finiteProb?['rise','fall','range'].reduce((s,k)=>s+(p[k]/100-(k===actualClass?1:0))**2,0):null;
      return {id:m.id,forecastClass:m.direction,actualClass,passed:m.direction===actualClass,
        multiclassBrier:Number.isFinite(brier)?rounded(brier,4):null};
    });
  }
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
    scenario,
    frozenPriceRange:scenario?{
      lowUsdOz:rounded(current.usdOz*(1+scenario.lowPct/100),2),
      midUsdOz:rounded(current.usdOz*(1+scenario.midPct/100),2),
      highUsdOz:rounded(current.usdOz*(1+scenario.highPct/100),2)
    }:null,
    evaluationRule:prediction==='rise'?'Closing price above starting price':prediction==='fall'?'Closing price below starting price':'Closing price within ±0.5% of starting price',
    rangePassLowUsdOz:prediction==='range'?rounded(current.usdOz*.995,2):null,
    rangePassHighUsdOz:prediction==='range'?rounded(current.usdOz*1.005,2):null,
    observedCloses:0,remainingCloses:h.sessions,
    status:'pending',sourceUrl,
    evidence:{historyAsOf:current.date,historyCount:rows.length},
    note:'Forecast was frozen before the next required dated closing observations. Historical scenario bounds are descriptive, not guaranteed limits.'};
   const adaptive=h.multiModel;
   if(adaptive&&Array.isArray(adaptive.models)){
     entry.multiModelSnapshot={
       modelVersion:'5.8',thresholdPct:adaptive.thresholdPct,
       selectedByEarlierValidation:adaptive.validation?.selectedByEarlyPeriod||null,
       historicalHoldoutValidated:!!adaptive.validation?.selectedModelValidated,
       researchBias:adaptive.bias,models:adaptive.models.map(m=>({
        id:m.id,direction:m.direction,referenceCases:m.referenceCases,
        probabilities:m.probabilities,scenarios:m.scenarios
       }))
     };
   }
   entry.snapshotHash=digest(entry);entries.push(entry);seen.add(hKey(entry));newlyRecorded++;
  }
 }
 // Legacy v5.6 observations did not preserve numeric scenario bounds. Never infer old ranges
 // from later reports. Show the publicly declared neutral-test band only as a rule.
 for(const e of entries) {
  if(e.status==='resolved'){e.remainingCloses=0;continue;}
  const idx=byDate.get(e.originDate);
  if(idx!==undefined&&rows[idx].usdOz===e.referenceUsdOz) {
   e.observedCloses=Math.max(0,rows.length-1-idx);
   e.remainingCloses=Math.max(0,e.sessions-e.observedCloses);
  }
 }
 entries.sort((a,b)=>a.originDate.localeCompare(b.originDate)||a.days-b.days);
 const summary=summarize(entries,models);
 return {schemaVersion:2,version:'5.7',generatedAt:now.toISOString(),
  lastObservedCloseDate:rows.at(-1)?.date||null,
  provider:'Dated gold closing prices, collected from a public historical feed',
  sourceUrl,entries,summary,
  learning:{status:models.some(m=>m.applied)?'validation_enabled':'learning_or_unproven',
   models,settledForLearning:settled.length,
   multiModelScorecards:scoreCandidateModels(settled),
   note:'Training requires at least 40 settled predictions per period. Uses earlier 70% to train and later 30% to test calibration. Only adjusts new forecasts if holdout Brier improves by at least 0.01.',
   warning:'Learning can reduce some historical error, but no improvement or future predictive skill is guaranteed.'},
  newlyRecorded,newlySettled};
}
module.exports={DAYS,normalize,updateLedger,trainingForHorizon,rubric};
