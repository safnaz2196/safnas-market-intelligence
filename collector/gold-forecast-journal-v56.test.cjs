'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {updateJournal}=require('./gold-forecast-journal-v56.cjs');
const start=Date.UTC(2026,0,1);
const hist=Array.from({length:200},(_,i)=>({date:new Date(start+i*86400000).toISOString().slice(0,10),usdOz:3000+i*2}));
const h=[{days:1,sessions:1,direction:'rise',probUp:55,validation:{edgeDemonstrated:false}},
 {days:7,sessions:5,direction:'range',probUp:45,validation:{edgeDemonstrated:false}}];
test('logs today as pending rather than claiming unobserved results',()=>{
 const first=updateJournal({},hist.slice(0,185),h,new Date('2026-07-04T00:00:00Z'));
 assert.equal(first.summary.resolved,0);assert.equal(first.summary.pending,2);
 assert.equal(first.summary.overallDirectionHitRate,null);
 assert.equal(first.entries[0].actualReturnPct,undefined);
});
test('only resolves later after actual future dated market closes arrive',()=>{
 let first=updateJournal({},hist.slice(0,185),h);
 const next=updateJournal(first,hist.slice(0,192),h);
 assert.equal(next.summary.resolved,2);
 assert.equal(next.summary.pending,2);
 const r=next.entries.filter(x=>x.status==='resolved');
 assert.equal(r.find(x=>x.days===1).actualDate,hist[185].date);
 assert.equal(r.find(x=>x.days===1).directionMatch,true);
 assert.equal(r.find(x=>x.days===7).directionMatch,false);
});
test('does not duplicate same-day locked forecasts',()=>{
 let first=updateJournal({},hist,h);
 const again=updateJournal(first,hist,h);
 assert.equal(again.newCount,0);
 assert.equal(again.entries.length,2);
});
test('missing original observation cannot be used for fabricated resolution',()=>{
 const first=updateJournal({},hist.slice(0,185),h);
 const broken=hist.slice(0,192).filter(x=>x.date!==hist[184].date);
 const result=updateJournal(first,broken,h);
 assert.equal(result.summary.resolved,0);
});
