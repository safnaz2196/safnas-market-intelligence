'use strict';
/* v5.8 ADAPTIVE MULTI-MODEL GOLD RESEARCH
 * Causal, date-locked four-model comparison; not investment advice.
 * Inputs: verified USD gold daily closes only. Economic inputs are presented
 * as evidence elsewhere, NOT secretly substituted for historical training data.
 *
 * Four deterministic data-based models: analogue kNN, trend kNN,
 * RSI-reversion kNN, volatility-regime kNN. Walk-forward origins only train on
 * samples whose future horizons already COMPLETED at that origin.
 * A model is NOT promoted until later untouched holdout checks beat a rolling
 * unconditional historical baseline by a meaningful Brier margin.
 */
const PERIODS=[{days:1,sessions:1},{days:3,sessions:2},{days:7,sessions:5},
 {days:14,sessions:10},{days:30,sessions:21},{days:90,sessions:63}];
const MODELS=[
 {id:'analogue',label:'Historical Similarity (kNN)',keys:['r5','r20','rsi','vol']},
 {id:'trend',label:'Trend / Momentum (kNN)',keys:['r5','r20','trend']},
 {id:'reversion',label:'RSI / Reversal (kNN)',keys:['rsi','trend','r5']},
 {id:'regime',label:'Volatility Regime (kNN)',keys:['vol','trend','r20']}
];
const SCALE={r5:5,r20:12,rsi:30,vol:18,trend:8};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const round=(v,d=3)=>finite(v)?Number(v.toFixed(d)):null;
const avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
const sd=a=>{if(a.length<2)return 0;const m=avg(a);return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/(a.length-1))};
const pct=(n,p)=>100*(n/p-1);
const quantile=(sorted,q)=>{const at=(sorted.length-1)*q,lo=Math.floor(at),hi=Math.ceil(at);return sorted[lo]+(sorted[hi]-sorted[lo])*(at-lo)};
const isDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
function clean(rows,now=new Date()){
 const max=now.toISOString().slice(0,10),map=new Map();
 for(const v of Array.isArray(rows)?rows:[]){
  const price=Number(v?.usdOz),date=v?.date;
  if(isDay(date)&&date<=max&&price>300&&price<15000)map.set(date,{date,usdOz:price});
 }
 return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-1100);
}
function rsi(closes,index,n=14){
 let gains=0,losses=0;
 for(let i=index-n+1;i<=index;i++){const d=closes[i]-closes[i-1];gains+=Math.max(d,0);losses+=Math.max(-d,0)}
 return losses===0?(gains===0?50:100):100-100/(1+gains/losses);
}
function features(closes,index) {
 if(index<55)return null;
 const p=closes[index],logs=[];
 for(let j=index-19;j<=index;j++)logs.push(Math.log(closes[j]/closes[j-1]));
 return {r5:pct(p,closes[index-5]),r20:pct(p,closes[index-20]),
  rsi:rsi(closes,index),
  vol:Math.max(.1,sd(logs)*Math.sqrt(252)*100),
  trend:pct(p,avg(closes.slice(index-49,index+1)))};
}
function direction(ret,threshold) {return ret>threshold?'rise':ret< -threshold?'fall':'range'}
function threshold(sessions){return round(Math.max(.5,Math.min(4,.5*Math.sqrt(sessions))),3)}
function distance(a,b,keys){
 let d=0;for(const key of keys){const x=(a[key]-b[key])/SCALE[key];d+=x*x;}return d;
}
function distribution(prices,featureCache,at,h,model,opts={}){
 const thr=threshold(h),limit=Math.min(at-h,prices.length-h-1);
 if(at<100||limit<95||!featureCache[at])return null;
 const candidates=[];
 const f=featureCache[at];
 for(let index=55;index<=limit;index++){
  if(!featureCache[index])continue;
  const delta=pct(prices[index+h],prices[index]);
  const d=distance(f,featureCache[index],model.keys);
  if(Number.isFinite(d)&&Number.isFinite(delta))candidates.push({distance:d,ret:delta});
 }
 if(candidates.length<60)return null;
 candidates.sort((a,b)=>a.distance-b.distance);
 const k=Math.min(80,Math.max(45,Math.floor(candidates.length*.22)));
 const chosen=candidates.slice(0,k);
 const returns=chosen.map(x=>x.ret).sort((a,b)=>a-b);
 const cats={rise:0,fall:0,range:0};
 for(const ret of returns)cats[direction(ret,thr)]++;
 const probabilities={rise:round((cats.rise+2)/(returns.length+6)*100,2),
  fall:round((cats.fall+2)/(returns.length+6)*100,2),
  range:round((cats.range+2)/(returns.length+6)*100,2)};
 const ranges={lowPct:round(quantile(returns,.10),3),midPct:round(quantile(returns,.50),3),
  highPct:round(quantile(returns,.90),3)};
 return {id:model.id,label:model.label,referenceCases:returns.length,trainingCandidates:candidates.length,
  probabilities,scenarios:ranges,medianReturnPct:ranges.midPct,
  direction:Object.entries(probabilities).sort((a,b)=>b[1]-a[1])[0][0],
  note:'Conditional frequencies of similar historical samples, NOT verified forward probabilities.'};
}
function baseline(prices,at,h){
 const end=at-h,returns=[];
 for(let i=Math.max(55,end-220);i<=end;i++){
  if(i+h>at)continue;
  returns.push(pct(prices[i+h],prices[i]));
 }
 if(returns.length<60)return null;
 const thr=threshold(h),count={rise:0,fall:0,range:0};
 for(const r of returns)count[direction(r,thr)]++;
 return {rise:(count.rise+2)/(returns.length+6)*100,
  fall:(count.fall+2)/(returns.length+6)*100,
  range:(count.range+2)/(returns.length+6)*100};
}
function brier(p,actual){
 return ['rise','fall','range'].reduce((sum,k)=>sum+(p[k]/100-(k===actual?1:0))**2,0);
}
function walkForward(prices,featuresByIndex,h,models){
 const n=prices.length,thr=threshold(h),limit=n-h-1;
 // Dated sequential validation: reserve LATER origins as an untouched holdout.
 const origins=[];
 const stride=Math.max(2,Math.floor(h/3));
 for(let i=Math.max(155,limit-290);i<=limit;i+=stride)origins.push(i);
 const limitSplit=Math.floor(origins.length*.65),early=origins.slice(0,limitSplit),later=origins.slice(limitSplit);
 const records={};
 for(const m of models)records[m.id]={train:[],holdout:[]};
 for(const [group,items] of [['train',early],['holdout',later]]){
  for(const at of items){
   const base=baseline(prices,at,h),actual=direction(pct(prices[at+h],prices[at]),thr);
   if(!base)continue;
   for(const m of models){
    const forecast=distribution(prices,featuresByIndex,at,h,m);
    if(!forecast)continue;
    records[m.id][group].push({brier:brier(forecast.probabilities,actual),
      baseline:brier(base,actual),directionCorrect:forecast.direction===actual});
   }
  }
 }
 const validation=models.map(m=>{
  const a=records[m.id].train,b=records[m.id].holdout;
  const x={id:m.id,trainCount:a.length,holdoutCount:b.length,selectionBrier:a.length?round(avg(a.map(r=>r.brier)),4):null,
   holdoutBrier:b.length?round(avg(b.map(r=>r.brier)),4):null,
   holdoutBaselineBrier:b.length?round(avg(b.map(r=>r.baseline)),4):null,
   holdoutDirectionHitRate:b.length?round(avg(b.map(r=>r.directionCorrect?1:0))*100,1):null};
  x.holdoutImprovement=x.holdoutCount?round(x.holdoutBaselineBrier-x.holdoutBrier,4):null;
  x.minHoldoutNeeded=20;
  x.validated=a.length>=28&&b.length>=20&&x.holdoutImprovement>=.025;
  return x;
 });
 const eligible=validation.filter(x=>x.trainCount>=28);
 eligible.sort((a,b)=>a.selectionBrier-b.selectionBrier);
 const selected=eligible[0]||null;
 const holdout=selected?validation.find(x=>x.id===selected.id):null;
 const verified=!!(holdout?.validated);
 return {selectedByEarlyPeriod:selected?.id||null,selectedModelValidated:verified,
  checksEarly:selected?.trainCount||0,checksLater:holdout?.holdoutCount||0,
  laterBrier:holdout?.holdoutBrier??null,laterBaselineBrier:holdout?.holdoutBaselineBrier??null,
  laterImprovement:holdout?.holdoutImprovement??null,
  models:validation,rule:'The model is selected on EARLIER walk-forward origins and must beat a rolling baseline on LATER untouched origins (at least 20 checks; Brier improvement ≥ 0.025).',
  note:verified?'Passed limited historical holdout check. Future skill still not guaranteed.':
   'No model has proven a meaningful out-of-sample improvement for this forecast period.'};
}
function evaluate(rows,now=new Date()){
 const data=clean(rows,now),price=data.map(x=>x.usdOz);
 if(price.length<420)throw new Error('At least 420 verified dated daily closes required for credible multi-model evaluation');
 const latest=data.at(-1),freshDays=Math.floor((Date.parse(now.toISOString().slice(0,10)+'T00:00:00Z')-Date.parse(latest.date+'T00:00:00Z'))/86400000);
 if(freshDays<0||freshDays>7)throw new Error('Gold historical price series is stale; refusing to publish current forecasts');
 const fs=price.map((_,i)=>features(price,i));
 const horizons=PERIODS.map(({days,sessions})=>{
  const models=MODELS.map(m=>distribution(price,fs,price.length-1,sessions,m)).filter(Boolean);
  const validation=walkForward(price,fs,sessions,MODELS);
  const chosen=validation.selectedByEarlyPeriod?models.find(m=>m.id===validation.selectedByEarlyPeriod):null;
  // Show scenario votes for research, but do NOT label unvalidated percentages as true odds.
  const vote={rise:0,fall:0,range:0};
  models.forEach(m=>vote[m.direction]++);
  const lead=chosen||models[0];
  const probs=lead?.probabilities||null;
  const signal=lead?.direction||'unavailable';
  const ranges=lead?.scenarios||null;
  const confidence=validation.selectedModelValidated?'historically_supported':'unproven';
  const probableTarget=ranges?{lowUsdOz:round(latest.usdOz*(1+ranges.lowPct/100),2),
    midUsdOz:round(latest.usdOz*(1+ranges.midPct/100),2),highUsdOz:round(latest.usdOz*(1+ranges.highPct/100),2)}:null;
  return {days,sessions,thresholdPct:threshold(sessions),bias:signal,
   consensus:{rise:vote.rise,fall:vote.fall,range:vote.range,total:models.length},
   modelCount:models.length,models,validation,confidence,
   conditionalHistoricalFrequencies:probs,
   scenarios:ranges,indicativeUsdOzRange:probableTarget,
   explanation:validation.selectedModelValidated?'Limited, out-of-sample historical evidence; still uncertain.':
    'Research only: disagreement and model errors prevent a reliable price-direction claim.',
   note:'Percentage values represent frequencies from matched historical cases, not a validated probability of future returns.'};
 });
 const active=horizons.filter(x=>x.confidence==='historically_supported').length;
 return {schemaVersion:1,version:'5.8',engine:'adaptive_four_model_causal_research',generatedAt:now.toISOString(),
  historyAsOf:latest.date,referenceUsdOz:round(latest.usdOz,2),historyCount:price.length,
  sources:[{label:'Dated historical gold closes',url:'https://xaus.com/api/v1/history'}],
  review:{horizonsEvaluated:horizons.length,horizonsWithHistoricalHoldoutEvidence:active,
   fullMarketReliabilityProven:false,
   note:'Backtests are not a substitute for forward live PASS/FAIL performance. Adjacent market indicators reuse correlated prices. Economic events can invalidate historical patterns.'},
  horizons,
  disclaimers:['Research does not forecast an exact price, an exact event date, or a guaranteed return.',
   'All comparison models are data-driven research methods; no language model or paid inference API is being used.',
   'Adaptive learning from ACTUAL future outcomes remains gated by the separate forward-only prediction ledger.',
   'USD/SAR and USD/LKR exchange rates can change the local price even when USD gold stays unchanged.']};
}
module.exports={PERIODS,MODELS,clean,features,direction,threshold,distribution,baseline,walkForward,evaluate};
