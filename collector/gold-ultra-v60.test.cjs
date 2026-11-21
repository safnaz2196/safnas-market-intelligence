'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const ultra=require('./gold-ultra-v60.cjs');
const NOW=new Date('2026-11-21T12:00:00Z');
const TIME=NOW.toISOString(),DAY=86400000;
const history=Array.from({length:520},(_,i)=>({
 date:new Date(Date.UTC(2026,10,20)-(519-i)*DAY).toISOString().slice(0,10),
 usdOz:3150*Math.exp(.0002*i+.015*Math.sin(i/9))}));
const goldDay=history.at(-1).date;
const period=[1,3,7,14,30,90],session=[1,2,5,10,21,63];
function reports(){
 const current={version:'5.4',current:{usdOz:3600,asOf:TIME,source:'https://api.gold-api.com/price/XAU',
    historical:false,fx:{SAR:3.75,LKR:335,asOf:TIME}},
  macro:[{name:'U.S. 10-year inflation-adjusted yield',available:true,asOf:'2026-11-20',
   change5:.1,unit:'percentage points',source:'https://fred.stlouisfed.org'},
   {name:'Broad U.S. dollar index',available:true,asOf:'2026-11-20',
   change5:-.5,unit:'index points',source:'https://fred.stlouisfed.org'}],
  advanced:{technical:{asOf:goldDay,volatilityAnnualizedPct:17,trend:'range',
   source:'https://xaus.com/api/v1/history'},
    managedMoney:{available:true,asOf:'2026-11-17',weeklyChangeContracts:5000,source:'https://publicreporting.cftc.gov/'}}};
 const adaptive={version:'5.8',historyAsOf:goldDay,horizons:period.map((days,i)=>({
  days,sessions:session[i],models:['analogue','trend','reversion','regime'].map((id,j)=>({
   id,label:id,direction:j===0?'fall':'rise',referenceCases:60,probabilities:{rise:48,fall:42,range:10},
   scenarios:{lowPct:-2,midPct:1,highPct:3}}))
 }))};
 const professionalReport={version:'5.9',goldHistoryAsOf:goldDay,quality:{managedMoney:'dated_weekly'},
  horizons:period.map((days,i)=>({days,sessions:session[i],historicalConfidence:'NOT_PROVEN',
   scenario:{lowUsdOz:3450,midUsdOz:3600,highUsdOz:3800},
   currencyScenarios:{available:true,contexts:[{currency:'SAR',karat:22,constantFx:{low:380,middle:400,high:430}},
    {currency:'LKR',karat:22,constantFx:{low:35000,middle:40000,high:42000}}]},
   validation:{validated:false,laterChecks:0}}))};
 const ledger={summary:{recorded:6,pending:6,resolved:0},learning:{status:'learning_or_unproven',
   multiModelScorecards:[]},
  entries:period.map((days,i)=>({id:'f'+days,days,originDate:goldDay,referenceUsdOz:3600,
   predictedDirection:'range',remainingCloses:session[i],status:'pending'}))};
 return {outlook:current,adaptive,professionalReport,ledger,history};
}
test('v6 creates source dated market summary, 5 model votes, 6 windows without false reliability',()=>{
 const r=ultra.build(reports(),NOW);
 assert.equal(r.version,'6.0');assert.equal(r.status,'research_available');
 assert.equal(r.horizons.length,6);assert.ok(r.horizons.every(h=>h.modelCount===5));
 assert.ok(r.horizons.every(h=>h.reliability==='UNPROVEN'&&h.statisticalDirectionReliable===false));
 assert.equal(r.overview.forwardPending,6);assert.equal(r.overview.forwardPassed,0);
 assert.equal(r.learning.started,false);
 assert.equal(r.latestReference.localGramPrices.SAR.purity24,Number((3600/31.1034768*3.75).toFixed(2)));
 assert.ok(r.latestReference.localGramPrices.SAR.purity22<r.latestReference.localGramPrices.SAR.purity24);
 assert.equal(r.sourceIntegrity.news,'not_verified');
});
test('reference disagreement prompts evidence alert but never a new gold target',()=>{
 const sample=reports();sample.backupSpot={usdOz:3690,asOf:TIME,source:'https://xaus.com/api/v1/spot'};
 const r=ultra.build(sample,NOW);
 assert.equal(r.sourceIntegrity.priceComparison.status,'disagreement');
 assert.equal(r.risk.grade,'SOURCE_CONFLICT');
 assert.ok(r.events.some(e=>e.title.includes('disagree')));
 assert.ok(!('buySignal' in r));
});
test('stale FX or stale spot automatically hides nominal spot local prices',()=>{
 const sample=reports();sample.outlook.current.fx.asOf='2026-11-15T09:00:00Z';
 const r=ultra.build(sample,NOW);
 assert.equal(r.status,'limited');assert.equal(r.latestReference.localGramPrices,null);
 assert.equal(r.sourceIntegrity.fx.status,'stale');
 assert.ok(r.events.some(e=>e.level==='warning'));
});
test('forward settled historical failure is visible but not invented from pending records',()=>{
 const sample=reports();
 sample.ledger.entries[0]={id:'one',days:1,originDate:'2026-11-17',
  actualDate:'2026-11-20',referenceUsdOz:3600,actualUsdOz:3500,
  actualReturnPct:-2.78,predictedDirection:'rise',verdict:'FAIL',status:'resolved'};
 const r=ultra.build(sample,NOW);
 assert.equal(r.overview.forwardVerified,1);assert.equal(r.overview.forwardFailed,1);
 assert.equal(r.overview.forwardPending,5);assert.equal(r.recentPredictions.find(e=>e.id==='one').verdict,'FAIL');
 assert.equal(r.learning.started,true);
});
test('invalid historical period and incompatible research are rejected',()=>{
 const sample=reports();sample.professionalReport.horizons[0].days=999;
 assert.throws(()=>ultra.build(sample,NOW),/Unexpected forecast/);
 const sample2=reports();sample2.adaptive.historyAsOf='2026-01-01';
 assert.throws(()=>ultra.build(sample2,NOW),/Conflicting historical/);
});
test('quoted spot agreement compares only two fresh, time-aligned references',()=>{
 const a={usdOz:3600,asOf:TIME,source:'A'};
 const b={usdOz:3602,asOf:TIME,source:'B'};
 assert.equal(ultra.spotAgreement(a,b,NOW).status,'consistent');
 assert.equal(ultra.spotAgreement(a,{...b,asOf:'2026-11-19T00:00:00Z'},NOW).status,'not_comparable');
 assert.equal(ultra.spotAgreement(a,null,NOW).status,'not_checked');
});
test('historical scenarios never become calibrated probabilities',()=>{
 const sample=reports();
 const r=ultra.build(sample,NOW);
 assert.ok(r.horizons.every(h=>h.models.every(m=>/not\s+(a\s+)?calibrated/i.test(m.note))));
 assert.ok(r.horizons.every(h=>h.modelAgreement>=0&&h.modelAgreement<=100));
 assert.match(r.disclaimer,/No precise future gold price/);
});
