'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseOfficialTurnover}=require('./update.cjs');
const NOW=new Date('2026-11-21T10:40:00Z'),EOD='https://www.cse.lk/api/dailyMarketSummery',LIVE='https://www.cse.lk/api/marketSummery';
test('CSE end-of-day nested dailyMarketSummery yields genuine LKR equity turnover with dated observation',()=>{
 const raw=[[{tradeDate:1795113000000,marketTurnover:2330340350,equityTurnover:2330340350,
  volumeOfTurnOverNumber:121790416,marketTrades:14416},
 {tradeDate:1795026600000,marketTurnover:1100000000,equityTurnover:1100000000}]];
 const result=parseOfficialTurnover(raw,EOD,NOW);
 assert.equal(result.turnover,2330340350);
 assert.equal(result.currency,'LKR');assert.equal(result.asOf,'2026-11-20');
 assert.equal(result.trades,14416);assert.equal(result.sharesTraded,121790416);
 assert.equal(result.sourceURL,EOD);assert.equal(result.verifiedTradeDate,true);
});
test('CSE current marketSummery reports rupee turnover via tradeVolume (not shareVolume)',()=>{
 const raw={tradeVolume:2330402119.05,shareVolume:121796532,tradeDate:1795166820322,trades:14029};
 const result=parseOfficialTurnover(raw,LIVE,NOW);
 assert.equal(result.turnover,2330402119.05);
 assert.equal(result.sharesTraded,121796532);
 assert.equal(result.asOf,'2026-11-20');
});
test('reject unavailable, zero, undated and future reports rather than relabeling as current',()=>{
 assert.throws(()=>parseOfficialTurnover({tradeVolume:1200000000,tradeDate:null},LIVE,NOW),/No official/);
 assert.throws(()=>parseOfficialTurnover({tradeVolume:0,tradeDate:1795166820322},LIVE,NOW),/No official/);
 assert.throws(()=>parseOfficialTurnover({tradeVolume:1200000000,tradeDate:1995166820322},LIVE,NOW),/No official/);
 assert.throws(()=>parseOfficialTurnover({},EOD,NOW),/No official/);
});
