'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildResearch,isDate}=require('./research-v5-publish.cjs');
const NOW=new Date('2026-11-21T10:00:00.000Z');
function sample(){
 const days=Array.from({length:25},(_,i)=>new Date(Date.UTC(2026,9,27+i)).toISOString().slice(0,10));
 return {schemaVersion:1,generatedAt:'2026-11-21T09:55:00Z',market:{aspi:{points:days.map((date,i)=>({date,close:20100+i*7})),sourceURL:'https://www.cse.lk/api/chartData',model5:{ok:true}}},
  shares:[{ticker:'DIAL.N0000',price:18.2}],headlines:[
   {title:'Sri Lanka central bank announces interest rate decision',url:'https://economynext.com/policy123/',date:'2026-11-20',publisher:'EconomyNext'}],
  economy:{gdpGrowth:{points:[{year:'2024',value:4.2}],sourceURL:'https://data.worldbank.org/country/sri-lanka'}},warnings:[]};
}
test('builds valid v5 report using only evidence and 16 mapped CSE companies',()=>{
 const report=buildResearch(sample(),NOW);
 assert.equal(report.schemaVersion,5);
 assert.match(report.engineVersion,/^5\./);
 assert.equal(report.market.status,'current');
 assert.equal(report.companies.length,16);
 assert.equal(report.quality.indicativeCompanyQuotes,1);
 assert.ok(report.evidence.some(x=>x.id==='aspi'));
 assert.ok(report.briefing.findings.some(x=>x.evidenceIds.includes('aspi')));
 assert.equal(report.ai.status,'not_configured');
});
test('never invents undated stock close or company financial statements',()=>{
 const c=buildResearch(sample(),NOW).companies.find(x=>x.ticker==='DIAL.N0000');
 assert.deepEqual(c.quote.verifiedTradeDate,false);
 assert.equal(c.quote.asOf,null);
 assert.equal(c.fundamentals.status,'not_available');
});
test('passes through source-linked dated news, not invented headlines',()=>{
 const report=buildResearch(sample(),NOW);
 assert.equal(report.news.length,1);
 assert.equal(report.news[0].topics[0],'Interest rates');
 assert.equal(report.news[0].impactNote.includes('unverified'),true);
 assert.equal(report.evidence.find(x=>x.id==='news-1').asOf,'2026-11-20');
});
test('old snapshot marked limited and market price hidden',()=>{
 const s=sample();s.generatedAt='2026-11-17T10:00:00Z';
 const r=buildResearch(s,NOW);
 assert.equal(r.status,'limited');
 assert.equal(r.market.close,null);
 assert.equal(r.quality.collector,'outdated');
});
test('invalid and future-dated points excluded and no false returns',()=>{
 const s=sample();s.market.aspi.points=[{date:'2026-02-31',close:999999},{date:'2027-02-01',close:9999}];
 const r=buildResearch(s,NOW);
 assert.equal(r.market.status,'unavailable');
 assert.equal(r.market.lastObservedClose,null);
 assert.equal(isDate('2026-02-31'),false);
});
test('requires a compatible source snapshot',()=>{
 assert.throws(()=>buildResearch({schemaVersion:5,generatedAt:'2026-11-21T00:00:00Z'},NOW));
});

test('verified current daily turnover removes old warning after source refresh',()=>{
 const s=sample();
 s.market.marketSummary={turnover:2330340350,asOf:'2026-11-20',currency:'LKR',
  verifiedTradeDate:true,sourceURL:'https://www.cse.lk/api/dailyMarketSummery',
  sharesTraded:121790416,trades:14416};
 s.sourceHealth={turnover:{status:'current',asOf:'2026-11-20'}};
 s.warnings=[];
 const r=buildResearch(s,NOW);
 assert.equal(r.market.turnover.status,'dated_observation');
 assert.equal(r.market.turnover.valueLKR,2330340350);
 assert.ok(r.evidence.some(x=>x.id==='cse-turnover'&&x.asOf==='2026-11-20'));
 assert.ok(r.briefing.findings.some(x=>x.id==='cse-turnover'));
 assert.equal(r.quality.sourceWarnings.some(x=>String(x).includes('turnover:')),false);
});
test('old, undated, or unverified market turnover is not called current',()=>{
 const s=sample();s.market.marketSummary={turnover:2330340350,currency:'LKR',
  asOf:'2026-11-20',verifiedTradeDate:false,sourceURL:'https://www.cse.lk/api/dailyMarketSummery'};
 assert.equal(buildResearch(s,NOW).market.turnover.status,'unavailable');
 s.market.marketSummary.verifiedTradeDate=true;
 s.market.marketSummary.asOf='2026-10-15';
 assert.equal(buildResearch(s,NOW).market.turnover.status,'unavailable');
});
