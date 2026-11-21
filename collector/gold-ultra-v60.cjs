'use strict';
/* Safnas Finance v6.0 — Ultra Autonomous Gold Intelligence.
 * Composes verified v5.4/5.8/5.9 evidence, 5 distinct research candidates,
 * forward-locked PASS/FAIL results and market-risk events without fabricated odds.
 * Pure builder: no Firestore writes or credentials, free public JSON output.
 */
const professional=require('./gold-professional-v59.cjs');
const ensemble=require('./gold-ensemble-v58.cjs');
const OUNCE_GRAMS=31.1034768,PERIODS=new Set([1,3,7,14,30,90]);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const positive=x=>finite(x)&&x>0;
const round=(x,d=2)=>finite(x)?Number(x.toFixed(d)):null;
const isoDate=(x)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
  Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const hours=(x,now)=>{const ts=Date.parse(x||'');return Number.isFinite(ts)?(now.getTime()-ts)/3600000:null;};
function sourceState(timestamp,maxHours,now){
 const h=hours(timestamp,now);
 return {observedAt:typeof timestamp==='string'?timestamp:null,
  ageHours:round(h,1),status:h===null?'unavailable':h<-.1?'invalid_future':h<=maxHours?'recent':'stale'};
}
function spotAgreement(primary,secondary,now){
 const a=primary,b=secondary;
 if(!positive(a?.usdOz)||!positive(b?.usdOz))return {status:'not_checked',discrepancyPct:null,reason:'Two verified spot quotations were not available.'};
 const ageA=hours(a.asOf,now),ageB=hours(b.asOf,now);
 if(ageA===null||ageB===null||ageA<0||ageB<0||ageA>6||ageB>6||
    Math.abs(Date.parse(a.asOf)-Date.parse(b.asOf))>2*3600000)
   return {status:'not_comparable',discrepancyPct:null,reason:'Spot observations are too old or too far apart in time for a fair comparison.'};
 const pct=Math.abs(100*(a.usdOz-b.usdOz)/((a.usdOz+b.usdOz)/2));
 return {status:pct<=1?'consistent':pct<=2?'review':'disagreement',discrepancyPct:round(pct,3),
  comparedAt:now.toISOString(),providers:[a.source||'Primary spot',b.source||'Backup spot'],
  reason:pct<=1?'Spot references broadly agree (not independent exchange ticks).':
    'Two quoted spot references diverge; check timestamps and provider methodology.'};
}
function economy(outlook,now){
 const data=Array.isArray(outlook?.macro)?outlook.macro:[];
 const facts=[];
 for(const v of data){
  if(!v?.available||!finite(v.change5)||!v.asOf)continue;
  const age=hours(v.asOf+'T00:00:00Z',now);
  if(age===null||age<0||age>24*21)continue;
  const label=String(v.name||'Macroeconomic indicator');
  const isYield=/real|inflation-adjusted/i.test(label);
  const direction=v.change5>0?(isYield?'potential_headwind':'potential_headwind'):
    v.change5<0?'potential_support':'neutral';
  facts.push({label,change5:round(v.change5,3),unit:v.unit||'index points',
    directionalContext:direction,asOf:v.asOf,source:v.source||null,
    explanation:isYield?'Higher real yields often make non-yielding gold less attractive; this is not a deterministic rule.':
      'A stronger dollar can pressure USD gold, but the relationship can change.'});
 }
 const pos=outlook?.advanced?.managedMoney;
 if(pos?.available&&isoDate(pos.asOf)&&finite(pos.weeklyChangeContracts)){
  facts.push({label:'CFTC managed-money positioning',change5:pos.weeklyChangeContracts,
   unit:'net contracts · weekly change',directionalContext:'context_only',asOf:pos.asOf,
   source:pos.source,explanation:'Weekly delayed positioning; net longs cannot determine next-day gold direction.'});
 }
 return facts;
}
function candidateVotes(adaptiveH,history,now){
 const original=Array.isArray(adaptiveH?.models)?adaptiveH.models:[];
 const candidates=original.filter(x=>['rise','fall','range'].includes(x.direction))
  .map(x=>({id:x.id,label:x.label,direction:x.direction,referenceCases:x.referenceCases||null,
   conditionalHistoricalFrequencies:x.probabilities||null,
   scenarios:x.scenarios||null,
   note:'Historical matched-case frequency. Not a calibrated future probability.'}));
 const price=ensemble.clean(history,now).map(x=>x.usdOz);
 if(price.length>=420&&adaptiveH?.sessions>0){
  const candidate=professional.ewmaForecast(price,price.length-1,adaptiveH.sessions);
  if(candidate)candidates.push({id:'ewma',label:candidate.label,direction:candidate.direction,
    referenceCases:candidate.referenceCases,
    conditionalHistoricalFrequencies:Object.fromEntries(Object.entries(candidate.probabilities).map(([k,v])=>[k,round(v,2)])),
    scenarios:Object.fromEntries(Object.entries(candidate.scenarios).map(([k,v])=>[k,round(v,3)])),
    note:'Lognormal time-series approximation, not calibrated market odds.'});
 }
 const counts={rise:0,fall:0,range:0};
 for(const c of candidates)counts[c.direction]++;
 const max=Math.max(counts.rise,counts.fall,counts.range);
 return {candidates,votes:counts,total:candidates.length,
  dominant:max===0?'unavailable':Object.values(counts).filter(x=>x===max).length>1?'mixed':
    Object.keys(counts).find(k=>counts[k]===max),
  agreement:candidates.length?round(max/candidates.length*100,1):null,
  note:'Agreement is not independent evidence: four models use overlapping historical gold-price features.'};
}
function grams(spot,fx){
 if(!positive(spot)||!positive(fx?.SAR)||!positive(fx?.LKR))return null;
 const x={};
 for(const currency of ['SAR','LKR']){
  x[currency]={
   purity22:round(spot/OUNCE_GRAMS*fx[currency]*22/24,2),
   purity24:round(spot/OUNCE_GRAMS*fx[currency],2),
   currency,unit:currency+'/gram'};
 }
 return x;
}
function build({outlook,adaptive,professionalReport,ledger,history=[],backupSpot=null},now=new Date()){
 if(outlook?.version!=='5.4'||adaptive?.version!=='5.8'||
    professionalReport?.version!=='5.9'||!Array.isArray(professionalReport.horizons)||professionalReport.horizons.length!==6)
  throw Error('Compatible dated v5.4, v5.8 and v5.9 gold research reports required.');
 if(!isoDate(adaptive.historyAsOf)||adaptive.historyAsOf!==professionalReport.goldHistoryAsOf)
  throw Error('Conflicting historical reference dates; refusing to combine inconsistent forecasts.');
 const quality=professionalReport.quality||{};
 const spotSource=outlook.current?.historical?null:outlook.current;
 const ageSpot=sourceState(spotSource?.asOf,6,now),ageFx=sourceState(outlook.current?.fx?.asOf,72,now);
 const goldDay=adaptive.historyAsOf;
 const histState=sourceState(goldDay+'T00:00:00Z',24*6,now);
 const spotOk=ageSpot.status==='recent'&&positive(spotSource?.usdOz);
 const fxOk=ageFx.status==='recent';
 const primary=spotOk?{usdOz:spotSource.usdOz,asOf:spotSource.asOf,source:spotSource.source}:null;
 const compared=spotAgreement(primary,backupSpot,now);
 const crossIssue=['review','disagreement'].includes(compared.status);
 const latest=Array.isArray(ledger?.entries)?ledger.entries:[];
 const outcomes=latest.filter(e=>e?.status==='resolved'&&['PASS','FAIL'].includes(e.verdict));
 const pending=latest.filter(e=>e?.status==='pending');
 const facts=economy(outlook,now);
 const tech=outlook.advanced?.technical||{};
 const volatility=Number(tech.volatilityAnnualizedPct);
 const riskGrade=!spotOk||!fxOk||histState.status!=='recent'?'DATA_LIMITED':
  crossIssue?'SOURCE_CONFLICT':finite(volatility)&&volatility>=32?'ELEVATED_VOLATILITY':'STANDARD_UNCERTAINTY';
 const events=[];
 const add=(level,title,detail,asOf,source=null)=>{
  events.push({level,title,detail,asOf:asOf||null,source});
 };
 if(!spotOk||!fxOk)add('warning','Market reference needs updating','Spot and/or exchange-rate observations are unavailable or stale. Current local prices are withheld.',now.toISOString());
 if(crossIssue)add('warning','Gold providers disagree',compared.reason,now.toISOString(),primary?.source);
 if(riskGrade==='ELEVATED_VOLATILITY')add('risk','Unusually wide historical price movement',
  'Observed 20-session volatility is elevated; scenario ranges may be less reliable.',tech.asOf,tech.source);
 if(outcomes.length)add('info',outcomes.length+' completed forecast result'+(outcomes.length>1?'s':''),
  'Every PASS or FAIL is checked against a later dated market close.',outcomes.at(-1)?.actualDate,
  outcomes.at(-1)?.settlementSourceUrl||null);
 const validated=professionalReport.horizons.filter(h=>h.historicalConfidence==='limited_historical_support').length;
 if(validated===0)add('caution','Forecasting edge not demonstrated',
  'No window passed the independent historical holdout checks. Model votes are descriptive only.',adaptive.historyAsOf);
 const local=spotOk&&fxOk?grams(primary.usdOz,outlook.current.fx):null;
 const horizons=professionalReport.horizons.map(h=>{
  if(!PERIODS.has(h.days))throw Error('Unexpected forecast window');
  const a=adaptive.horizons.find(v=>v.days===h.days);
  const votes=candidateVotes(a,history,now);
  const locked=pending.find(e=>e.days===h.days)||null;
  const settlements=outcomes.filter(e=>e.days===h.days);
  const trend=h.historicalConfidence==='limited_historical_support'?'limited_historical_support':'UNPROVEN';
  const prices=h.currencyScenarios?.available?h.currencyScenarios:null;
  return {days:h.days,sessions:h.sessions,expectedBias:votes.dominant,modelAgreement:votes.agreement,
   models:votes.candidates,modelVotes:votes.votes,modelCount:votes.total,
   statisticalDirectionReliable:trend==='limited_historical_support',
   reliability:trend,validation:h.validation||null,
   goldScenarioUSD:h.scenario||null,localScenarios:prices,
   lockedForecast:locked?{originDate:locked.originDate,direction:locked.predictedDirection,
    startUsdOz:locked.referenceUsdOz,remainingCloses:locked.remainingCloses??null,
    scenario:locked.scenario||null,status:locked.status,decisionSource:locked.decisionSource||'existing_locked_forecast'}:null,
   settledCount:settlements.length,passed:settlements.filter(e=>e.verdict==='PASS').length,
   note:'Directional votes and gold ranges are research scenarios, not promises or calibrated probabilities.'};
 });
 const recent=[...latest].sort((a,b)=>String(b.originDate).localeCompare(String(a.originDate))).slice(0,20)
  .map(e=>({id:e.id,days:e.days,originDate:e.originDate,actualDate:e.actualDate||null,
   expected:e.predictedDirection,startUsdOz:e.referenceUsdOz,
   actualUsdOz:e.actualUsdOz??null,actualReturnPct:e.actualReturnPct??null,
   status:e.status,verdict:e.verdict||null,remainingCloses:e.remainingCloses??null,
   frozenRange:e.frozenPriceRange||null,rangeHit:e.rangeHit??null}));
 const evidence=[...facts,
  {label:'Technical volatility (20 sessions)',value:finite(volatility)?round(volatility,2):null,unit:'% annualized',
   explanation:'Historical variability, not a directional signal.',asOf:tech.asOf||goldDay,
   source:tech.source||'https://xaus.com/api/v1/history'}];
 return {schemaVersion:1,version:'6.0',generatedAt:now.toISOString(),status:spotOk&&fxOk?'research_available':'limited',
  brand:'Safnas Finance v6.0 · Ultra Autonomous Gold Intelligence',
  latestReference:{usdOz:spotOk?round(primary.usdOz,2):null,
   asOf:spotSource?.asOf||null,source:spotSource?.source||null,
   goldHistoryAsOf:goldDay,fxAsOf:outlook.current?.fx?.asOf||null,
   fx:fxOk?{SAR:outlook.current.fx.SAR,LKR:outlook.current.fx.LKR}:null,
   localGramPrices:local},
  sourceIntegrity:{spot:ageSpot,fx:ageFx,history:histState,
   cftc:quality.managedMoney||'unavailable',macroObservations:facts.length,
   news:'not_verified',priceComparison:compared},
  risk:{grade:riskGrade,volatility20AnnualizedPct:finite(volatility)?round(volatility,2):null,
   trend:tech.trend||'unavailable',explanation:'Gold prices and exchange rates can change in either direction. No risk grade guarantees an outcome.'},
  overview:{modelCount:5,horizonCount:horizons.length,validHistoricalWindows:validated,
   forwardVerified:outcomes.length,forwardPending:pending.length,
   forwardPassed:outcomes.filter(e=>e.verdict==='PASS').length,
   forwardFailed:outcomes.filter(e=>e.verdict==='FAIL').length},
  horizons,learning:{status:ledger?.learning?.status||'not_eligible',
   started:!!outcomes.length,
   forwardModelScorecards:ledger?.learning?.multiModelScorecards||[],
   correctionNote:'No automatic model change without later, unseen, forward-locked outcomes outperforming a baseline.'},
  recentPredictions:recent,events:events.slice(0,8),evidence,
  disclaimer:'Educational research only. No precise future gold price, outcome date, calibrated market probability, or buying/selling recommendation. For push notifications, use existing opt-in gold alert settings.',
  sources:[{label:'Gold research',url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-outlook-v54.json'},
   {label:'Independent model tests',url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-professional-v59.json'},
   {label:'Locked prediction ledger',url:'https://raw.githubusercontent.com/safnaz2196/safnas-market-intelligence/main/market-intelligence/gold-prediction-history-v57.json'}]};
}
module.exports={build,sourceState,spotAgreement,economy,candidateVotes,grams};
