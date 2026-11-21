'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {assemble}=require('./research-desk-v62.cjs');
const now=new Date('2026-11-21T13:00:00Z');
const stub=()=>({cse:{generatedAt:'2026-11-21T11:00:00Z',market:{
 asOf:'2026-11-20',close:21369.72,changePct:-.8,turnover:{valueLKR:2330340350,asOf:'2026-11-20'}},
 companies:[{ticker:'DIAL.N0000',name:'Dialog Axiata PLC',quote:{verifiedTradeDate:true,value:48,
 asOf:'2026-11-20',changePct:-2.041},filings:[{title:'Q3 financial report',
 url:'https://cdn.cse.lk/cmt/upload_report_file/q3.pdf',published:'2026-11-11'}]},
 {ticker:'COMB.N0000',name:'Commercial Bank PLC',quote:{verifiedTradeDate:false,value:214,
 asOf:'2026-11-20'},filings:[]}],news:[]},
 latest:{generatedAt:'2026-11-21T12:00:00Z'},
 gold:{generatedAt:'2026-11-21T12:00:00Z',latestReference:{asOf:'2026-11-21T11:00:00Z',
 usdOz:3539},overview:{validHistoricalWindows:0,forwardPending:6,forwardVerified:0}},
 ledger:{},previous:null});
test('initial report publishes only observed dates and verified CSE company prices',()=>{
 const r=assemble(stub(),now);
 assert.equal(r.version,'6.2');assert.equal(r.status,'observed_public_research');
 assert.equal(r.coverage.cseQuotes,'1 / 2');
 assert.equal(r.market.turnoverAsOf,'2026-11-20');
 assert.equal(r.history.length,3);
 assert.equal(r.gold.historicalWindowsValidated,0);
 assert.ok(r.history.some(x=>x.kind==='gold'));
});
test('same observations create no duplicate published research changes',()=>{
 const first=assemble(stub(),now),input=stub();input.previous=first;
 const next=assemble(input,now);
 assert.equal(next.changes.length,0);
 assert.deepEqual(next.history,first.history);
});
test('new exchange date and independently completed forecasts create changes without rewriting old history',()=>{
 const old=assemble(stub(),now),input=stub();
 input.previous=old;
 input.cse.market.asOf='2026-11-21';
 input.gold.overview.forwardVerified=2;
 input.cse.companies[0].quote.asOf='2026-11-21';
 const next=assemble(input,now);
 assert.ok(next.changes.some(x=>x.kind==='audit'));
 assert.ok(next.changes.some(x=>x.kind==='market'));
 assert.ok(next.changes.some(x=>x.kind==='company'));
 assert.ok(next.history.length>old.history.length);
});
test('missing evidence cannot masquerade as real-time streaming or suggest a trading target',()=>{
 const input=stub();input.cse=null;
 const r=assemble(input,now);
 assert.equal(r.status,'partial');assert.equal(r.verifiedCompanies,0);
 assert.match(r.disclaimer,/No LLM inference/);
 assert.equal(r.changes.some(x=>x.kind==='company'),false);
});
