'use strict';
/* Safnas Finance v5.9 — PROFESSIONAL GOLD INTELLIGENCE
 * Gap-aware, non-overlapping historical holdouts; frozen live PASS/FAIL forensics;
 * explicit currency-stress scenarios. No paid APIs, no fabricated live probabilities.
 * This is research, not financial advice.
 */
const ensemble=require('./gold-ensemble-v58.cjs');
const OZ=31.1034768;
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const money=(x,d=2)=>finite(x)?Number(x.toFixed(d)):null;
function ageHours(ts,now){
 const t=Date.parse(ts||'');
 return Number.isFinite(t)?(now.getTime()-t)/36e5:null;
}
function score(p,actual){
 return ['rise','fall','range'].reduce((sum,k)=>sum+(Number(p[k])/100-(k===actual?1:0))**2,0);
}
/** Distinct fifth model: EWMA daily-return drift + volatility.
 * No kNN neighbors, no external ML package, no parameter fitting to a future label.
 * This simple lognormal model is a RESEARCH candidate, not a true market probability.
 */
function normalCdf(z){
 const abs=Math.abs(z),t=1/(1+.2316419*abs);
 const density=.3989422804014327*Math.exp(-.5*abs*abs);
 const tail=density*(.319381530*t-.356563782*t*t+1.781477937*t*t*t-
  1.821255978*t*t*t*t+1.330274429*t*t*t*t*t);
 return z>=0?1-tail:tail;
}
function ewmaForecast(prices,at,h){
 if(at<180||h<=0)return null;
 const daily=[];
 for(let i=at-179;i<=at;i++)daily.push(Math.log(prices[i]/prices[i-1]));
 if(!daily.every(Number.isFinite))return null;
 const last=daily.slice(-60);
 let weighted=0,total=0;
 for(let i=0;i<last.length;i++){const w=Math.pow(.95,last.length-1-i);weighted+=last[i]*w;total+=w;}
 const mu=weighted/total,sd=Math.sqrt(last.reduce((z,v)=>z+(v-mu)**2,0)/(last.length-1));
 const sigma=Math.max(.0005,sd)*Math.sqrt(h),mean=mu*h;
 const thr=ensemble.threshold(h)/100;
 const up=100*(1-normalCdf((Math.log(1+thr)-mean)/sigma));
 const down=100*normalCdf((Math.log(1-thr)-mean)/sigma);
 const sideways=Math.max(0,100-up-down);
 const p={rise:up,fall:down,range:sideways};
 const best=Object.entries(p).sort((a,b)=>b[1]-a[1])[0][0];
 const lnToPct=x=>100*(Math.exp(x)-1);
 return {id:'ewma',label:'EWMA Time-Series',referenceCases:last.length,
  probabilities:p,direction:best,
  scenarios:{lowPct:lnToPct(mean-1.2815515655*sigma),
   midPct:lnToPct(mean),highPct:lnToPct(mean+1.2815515655*sigma)},
  explanation:'Volatility-scaled time-series approximation; mathematically distinct from nearest-neighbor methods. Not calibrated to future market odds.'};
}
function gapAwareHoldout(history,h,now=new Date()){
 const rows=ensemble.clean(history,now),prices=rows.map(x=>x.usdOz);
 const empty={days:h.days,sessions:h.sessions,method:'purged_nonoverlapping_walk_forward',
  status:'insufficient',referenceSamples:0,earlyChecks:0,laterChecks:0,gapSessions:h.sessions,
  selectedModel:null,validated:false,modelBrier:null,baselineBrier:null,improvement:null,
  hitRatePct:null,rangeCoveragePct:null,modelAudits:[],
  explanation:'Not enough independent, dated observations to evaluate this horizon.'};
 if(prices.length<430)return empty;
 const feat=prices.map((_,i)=>ensemble.features(prices,i)),origin=[],max=prices.length-h.sessions-1;
 const first=Math.max(160,max-450);
 for(let i=first;i<=max;i+=Math.max(1,h.sessions)){
  origin.push(i);
 }
 if(origin.length<14)return {...empty,referenceSamples:origin.length};
 const trainLast=Math.floor(origin.length*.65)-1;
 const splitDateIndex=origin[trainLast];
 // Purge any test origin whose label interval could overlap the last training label.
 const early=origin.slice(0,trainLast+1);
 const later=origin.slice(trainLast+1).filter(i=>i>splitDateIndex+h.sessions);
 const competitors=[...ensemble.MODELS,{id:'ewma',label:'EWMA Time-Series'}];
 const tables=competitors.map(model=>{
   const calc=items=>{
    const records=[];
    for(const i of items){
     const predicted=model.id==='ewma'?ewmaForecast(prices,i,h.sessions):ensemble.distribution(prices,feat,i,h.sessions,model);
     const base=ensemble.baseline(prices,i,h.sessions);
     if(!predicted||!base)continue;
     const actualReturn=100*(prices[i+h.sessions]/prices[i]-1);
     const actual=ensemble.direction(actualReturn,ensemble.threshold(h.sessions));
     records.push({
      brier:score(predicted.probabilities,actual),baseline:score(base,actual),
      hit:predicted.direction===actual,
      inRange:actualReturn>=predicted.scenarios.lowPct&&actualReturn<=predicted.scenarios.highPct
     });
    }
    return records;
   };
   const a=calc(early),b=calc(later);
   const avg=arr=>arr.length?arr.reduce((s,x)=>s+x,0)/arr.length:null;
   const n=x=>money(x,4);
   return {id:model.id,trainChecks:a.length,laterChecks:b.length,
    earlyBrier:n(avg(a.map(x=>x.brier))),laterBrier:n(avg(b.map(x=>x.brier))),
    baselineBrier:n(avg(b.map(x=>x.baseline))),
    improvement:b.length?n(avg(b.map(x=>x.baseline))-avg(b.map(x=>x.brier))):null,
    laterHitRatePct:b.length?money(100*avg(b.map(x=>x.hit?1:0)),1):null,
    rangeCoveragePct:b.length?money(100*avg(b.map(x=>x.inRange?1:0)),1):null};
 });
 const eligible=tables.filter(x=>x.trainChecks>=35&&finite(x.earlyBrier)).sort((a,b)=>a.earlyBrier-b.earlyBrier);
 const selected=eligible[0]||null;
 const validated=!!selected&&selected.laterChecks>=20&&
  selected.improvement>=.025&&selected.rangeCoveragePct>=50;
 return {...empty,status:selected?'evaluated':'insufficient',
  referenceSamples:origin.length,earlyChecks:selected?.trainChecks||0,
  laterChecks:selected?.laterChecks||0,
  selectedModel:selected?.id||null,validated,
  modelBrier:selected?.laterBrier??null,baselineBrier:selected?.baselineBrier??null,
  improvement:selected?.improvement??null,hitRatePct:selected?.laterHitRatePct??null,
  rangeCoveragePct:selected?.rangeCoveragePct??null,modelAudits:tables,
  explanation:validated?
   'The candidate selected using earlier observations beat a rolling baseline on later, purged, non-overlapping historical outcomes. This is still not future proof.':
   'No model met the minimum independent holdout checks, score improvement and scenario coverage requirements.',
  method:'purged_nonoverlapping_walk_forward',
  selectionNote:'Candidate chosen on earlier outcomes only; later outcomes are separated by the full forecast horizon to reduce label overlap. Minimum 35 early and 20 later checks, Brier improvement ≥ 0.025 and scenario coverage ≥ 50%.'};
}
function currencyStress(h,fx,historyDate,now=new Date()){
 if(!h||!h.indicativeUsdOzRange)return {available:false,reason:'No validated dated gold-price scenario'};
 const age=ageHours(fx?.asOf,now);
 if(!fx||age===null||age<-.5||age>72||
   !finite(fx.SAR)||!finite(fx.LKR)||fx.SAR<=0||fx.LKR<=0){
  return {available:false,reason:'Verified USD/SAR or USD/LKR reference is missing or more than 72 hours old.'};
 }
 const result={available:true,fxObservedAt:fx.asOf,
  goldHistoryAsOf:historyDate,
  label:'Gold historical analogue range + hypothetical FX stress, NOT a future FX prediction',
  contexts:[]};
 const q=h.indicativeUsdOzRange;
 for(const [currency,region,stress] of [['SAR','Saudi Arabia',.005],['LKR','Sri Lanka',.03]]){
  for(const karat of [22,24]){
   const conversion=fx[currency]*karat/(24*OZ);
   const base={low:money(q.lowUsdOz*conversion),middle:money(q.midUsdOz*conversion),
    high:money(q.highUsdOz*conversion)};
   result.contexts.push({currency,region,karat,unit:currency+'/gram',
    fxReference:money(fx[currency],5),fxStressPct:money(stress*100,2),
    constantFx:base,
    hypotheticalStress:{low:money(base.low*(1-stress)),
      high:money(base.high*(1+stress))},
    caution:'FX movements are hypothetical sensitivities, not forecasted exchange rates. Taxes and jewellery fees excluded.'});
  }
 }
 return result;
}
function reviewSettled(ledger,limit=25){
 const values=Array.isArray(ledger?.entries)?ledger.entries:[];
 const settled=values.filter(x=>x?.status==='resolved'&&x.verdict&&
  finite(x.referenceUsdOz)&&finite(x.actualUsdOz)&&finite(x.actualReturnPct))
  .sort((a,b)=>String(b.actualDate).localeCompare(String(a.actualDate))).slice(0,limit);
 const studies=settled.map(x=>{
  const notes=[];
  if(x.verdict==='FAIL'){
   notes.push('The observed close did not match the direction locked at the forecast date.');
   if(x.rangeHit===false)notes.push('Actual return also fell outside the recorded illustrative scenario interval.');
   if(x.multiModelSnapshot?.models?.length){
    const votes=x.multiModelSnapshot.models.map(v=>v.direction);
    if(new Set(votes).size>1)notes.push('Original models disagreed; uncertainty was visible at the time.');
   }
  }else{
   notes.push('The recorded direction test passed. This does not mean the forecast price was exact.');
  }
  if(finite(x.absoluteMidErrorPct)&&x.absoluteMidErrorPct>4)
   notes.push('The middle-price estimate was substantially different from the actual closing price.');
  if(!notes.length)notes.push('The observation is archived; causal attribution requires separate evidence.');
  return {id:x.id,originDate:x.originDate,actualDate:x.actualDate,days:x.days,
    originalDirection:x.predictedDirection,verdict:x.verdict,
    startUsdOz:x.referenceUsdOz,actualUsdOz:x.actualUsdOz,returnPct:x.actualReturnPct,
    rangeHit:x.rangeHit??null,midErrorPct:x.absoluteMidErrorPct??null,
    hypotheses:notes,
    caveat:'These are observable errors and possible contributing conditions, NOT evidence of what caused the market move.',
    sourceUrl:x.settlementSourceUrl||x.sourceUrl||'https://xaus.com/api/v1/history'};
 });
 return {settledReviewed:studies.length,failedReviewed:studies.filter(x=>x.verdict==='FAIL').length,
  studies,description:settled.length?
  'Based only on forecasts locked before the future observations. No post-event outcome is used to change an earlier forecast.':
  'No gold forecasts have settled yet. Failure investigations start automatically after verified future dated closes arrive.',
  attributionRule:'Do not claim a specific news headline, real-yield change or currency movement caused a failed prediction without dated independent evidence.'};
}
function build(input={},now=new Date()){
 const {history=[],adaptive=null,ledger=null,fx=null,macro=[],cot=null,goldSpot=null}=input;
 if(!adaptive||adaptive.version!=='5.8'||!Array.isArray(adaptive.horizons)||adaptive.horizons.length<6)
   throw new Error('Valid v5.8 research required; will not manufacture new forecasts');
 const historyLast=adaptive.historyAsOf;
 const rows=ensemble.clean(history,now);
 if(!rows.length||rows.at(-1).date!==historyLast)throw new Error('Gold history and v5.8 reference do not match');
 const daysOld=Math.floor((Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(historyLast+'T00:00:00Z'))/864e5);
 const historyGood=daysOld>=0&&daysOld<=4;
 const horizons=adaptive.horizons.map(h=>{
  const validation=gapAwareHoldout(rows,{days:h.days,sessions:h.sessions},now);
  return {days:h.days,sessions:h.sessions,
   originalDirection:h.bias,scenario:h.indicativeUsdOzRange||null,
   historicalConfidence:historyGood&&validation.validated?'limited_historical_support':'NOT_PROVEN',
   validation,currencyScenarios:currencyStress(h,fx,historyLast,now),
   note:'No assured timing, no assured direction, no demonstrated live trading edge.'};
 });
 const newsStatus='unavailable';
 const currentFxAge=ageHours(fx?.asOf,now),spotAge=ageHours(goldSpot?.asOf,now);
 const quality={
  history:historyGood?'observed':'stale',historyAsOf:historyLast,historyDaysOld:daysOld,
  spot:spotAge!==null&&spotAge>=0&&spotAge<=24?'recent':'stale_or_missing',
  spotAsOf:goldSpot?.asOf||null,
  fx:currentFxAge!==null&&currentFxAge>=0&&currentFxAge<=72?'recent':'stale_or_missing',
  fxAsOf:fx?.asOf||null,
  managedMoney:cot?.available?'dated_weekly':'unavailable',
  macroAvailable:Array.isArray(macro)?macro.filter(x=>x.available).length:0,
  news:newsStatus,
  explanation:'Live source status is checked independently. Gold price history, currencies, economic reports and weekly futures positions are not equally fresh.'};
 const anyProven=horizons.filter(h=>h.historicalConfidence==='limited_historical_support').length;
 return {schemaVersion:1,version:'5.9',generatedAt:now.toISOString(),
  status:historyGood?'research_available':'historical_only',
  sourceReport:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-ensemble-v58.json',
  goldHistoryAsOf:historyLast,referenceUsdOz:adaptive.referenceUsdOz,
  summary:{modelsCompared:5,periods:6,purgedHoldoutSupported:historyGood?anyProven:0,
   forwardSettled:Number(ledger?.summary?.resolved)||0,forwardPending:Number(ledger?.summary?.pending)||0,
   headline:'Evidence-first gold intelligence — no unfounded price certainty'},
  quality,horizons,
  failureLab:reviewSettled(ledger),
  researchLinks:[{title:'Gold close history',url:'https://xaus.com/api/v1/history'},
    {title:'Historical model evaluation',url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-ensemble-v58.json'},
    {title:'Forward locked prediction record',url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-prediction-history-v57.json'}],
  guarantees:'None. This research does not predict an exact gold price or turning date. The gold and exchange-rate scenarios are illustrations; no investment recommendation.',
  researchGaps:['No verified real-time news impact attribution. Economic news must not be fabricated.',
    'Unsupervised FX stress assumptions are not USD/LKR forecasts.',
    'Purged historical backtests are separate from genuine forward PASS/FAIL records.']};
}
module.exports={gapAwareHoldout,currencyStress,reviewSettled,build,ageHours,ewmaForecast,normalCdf};
