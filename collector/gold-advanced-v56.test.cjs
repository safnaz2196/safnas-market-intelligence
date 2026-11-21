'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const adv=require('./gold-advanced-v56.cjs');
const DAY='2026-11-21';
const NOW=new Date('2026-11-21T09:00:00Z');
function series(length=240){
 const start=Date.UTC(2026,0,1);
 return Array.from({length},(_,i)=>({date:new Date(start+i*86400000).toISOString().slice(0,10),
  usdOz:3100*Math.exp(i*.0009+Math.sin(i/8)*.035)}));
}
test('daily gold indicators calculate valid RSI MACD bands and no invented OHLC',()=>{
 const x=adv.technical(series(),new Date('2026-11-21T09:00:00Z'));
 assert.equal(x.available,true);assert.ok(x.rsi14>=0&&x.rsi14<=100);
 assert.ok(Number.isFinite(x.macd.histogram));
 assert.ok(x.bands.upper>=x.bands.middle && x.bands.middle>=x.bands.lower);
 assert.ok(['uptrend','downtrend','range_or_transition','high_volatility'].includes(x.regime));
 assert.equal(typeof x.warning,'string');
});
test('technical analysis skips stale/invalid data and never invents prices',()=>{
 assert.equal(adv.technical([],NOW).available,false);
 assert.equal(adv.technical([{date:'2026-01-01',usdOz:999999}],NOW).available,false);
});
test('weekly CFTC results show date, net change, and observation lag',()=>{
 const a=[{report_date_as_yyyy_mm_dd:'2026-11-17T00:00:00.000',
  m_money_positions_long_all:'250000',m_money_positions_short_all:'100000',open_interest_all:'550000'},
 {report_date_as_yyyy_mm_dd:'2026-11-10T00:00:00.000',
  m_money_positions_long_all:'240000',m_money_positions_short_all:'110000',open_interest_all:'560000'}];
 const x=adv.parseCot(a,NOW);assert.equal(x.available,true);
 assert.equal(x.managedMoneyNetContracts,150000);assert.equal(x.weeklyChangeContracts,20000);
 assert.equal(x.asOf,'2026-11-17');assert.match(x.interpretation,/weekly delayed/);
});
test('CFTC old or malformed figures cannot masquerade as current',()=>{
 assert.equal(adv.parseCot([
 {report_date_as_yyyy_mm_dd:'2026-07-01',m_money_positions_long_all:100,m_money_positions_short_all:80,open_interest_all:600},
 {report_date_as_yyyy_mm_dd:'2026-06-25',m_money_positions_long_all:100,m_money_positions_short_all:80,open_interest_all:600}],NOW).available,false);
 assert.equal(adv.parseCot([{report_date_as_yyyy_mm_dd:'2026-11-17',m_money_positions_long_all:'invalid',m_money_positions_short_all:80,open_interest_all:600}],NOW).available,false);
});
test('risk and context catalysts carry source links, not dates of future price moves',()=>{
 const t=adv.technical(series(),NOW),out=adv.catalysts(t,{available:false},[]);
 assert.ok(Array.isArray(out));
 assert.ok(out.every(x=>x.source.startsWith('https://') && !x.targetPrice));
});
