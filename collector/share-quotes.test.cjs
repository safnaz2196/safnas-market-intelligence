'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseCSETradeSummary}=require('./update.cjs');
const NOW=new Date('2026-11-21T07:00:00Z');
const cseRow=(symbol,price,time)=>({symbol,price,lastTradedTime:time,turnover:2000000,companyName:symbol+' Company'});
test('CSE official tradeSummary rows map to dated share quotes, not retrieved-only guesses',()=>{
 const raw={reqTradeSummery:[
  cseRow('COMB.N0000',214,Date.parse('2026-11-20T08:10:00Z')),
  cseRow('DIAL.N0000',48,Date.parse('2026-11-20T06:10:00Z'))
 ]};
 const quotes=parseCSETradeSummary(raw,NOW);
 assert.equal(quotes.length,2);
 assert.equal(quotes[0].ticker,'COMB.N0000');
 assert.equal(quotes[0].asOf,'2026-11-20');
 assert.equal(quotes[0].verifiedTradeDate,true);
 assert.equal(quotes[1].price,48);
 assert.equal(quotes[0].sourceURL,'https://www.cse.lk/api/tradeSummary');
});
test('invalid prices and missing/future trade timestamps cannot be promoted as dated',()=>{
 const raw={reqTradeSummery:[
  cseRow('BAD.N0000',NaN,Date.parse('2026-11-20T07:00:00Z')),
  cseRow('FUTURE.N0000',100,Date.parse('2026-11-23T00:00:00Z')),
  cseRow('MISSING.N0000',35,undefined),
  cseRow('DIAL.N0000',48,Date.parse('2026-11-20T07:00:00Z'))
 ]};
 const quotes=parseCSETradeSummary(raw,NOW);
 assert.deepEqual(quotes.map(x=>x.ticker),['DIAL.N0000']);
 assert.throws(()=>parseCSETradeSummary({reqTradeSummery:[]},NOW),/no valid dated/);
});
test('missing official API response is not treated as current share coverage',()=>{
 assert.throws(()=>parseCSETradeSummary({error:'HTTP 400'},NOW),/no valid dated/);
});
