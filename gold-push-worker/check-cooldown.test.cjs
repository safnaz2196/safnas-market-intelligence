'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const webpush=require('web-push');
const policy=require('./gold-alert-core.cjs');
const worker=require('./check.cjs');

test('Saudi movement cooldown never hides a qualifying Sri Lankan gold-price movement',async()=>{
 const now=Date.parse('2026-11-21T11:00:00Z');
 const settings=policy.normalizeSettings({markets:['SAR','LKR'],karat:22,threshold:.5,direction:'both'});
 const spot={usdOz:3539,asOf:'2026-11-21T10:59:00Z',source:'Gold API'};
 const fx={SAR:3.75,LKR:332.63,asOf:'2026-11-21T00:00:00Z'};
 const latest=policy.sampleMarket(spot,fx,settings);
 const baseline={SAR:latest.SAR/1.02,LKR:latest.LKR/1.02};
 const record={uid:'test-user',enabled:true,
  subscription:{endpoint:'https://web.push.apple.com/Q/test',keys:{p256dh:'test',auth:'test'}},
  settings,settingsFingerprint:worker.checksum(settings),baseline,
  lastSummaryDay:policy.localDayKey(now),
  lastAlertAtByMarket:{SAR:now-10*60000,LKR:now-120*60000},
  lastAlertAt:now-10*60000};
 const doc={id:'test-doc',data:()=>record,ref:{async update(patch){Object.assign(record,patch)},async delete(){throw Error('Unexpected delete')}}};
 const sent=[];
 const actual=webpush.sendNotification;
 webpush.sendNotification=async(_sub,message)=>{sent.push(JSON.parse(message));return {};};
 try{
   const first=await worker.deliverOne(doc,spot,fx,now);
   assert.equal(first.kind,'movement_sent');
   assert.equal(first.sent,1);
   assert.deepEqual(sent.map(x=>x.title),['🇱🇰 Sri Lanka 22K gold']);
   assert.equal(record.baseline.SAR,baseline.SAR);
   assert.equal(record.baseline.LKR,latest.LKR);
   assert.equal(record.lastAlertAtByMarket.SAR,now-10*60000);
   assert.equal(record.lastAlertAtByMarket.LKR,now);
   // Once the Saudi cooldown expires, its pending move can be sent without
   // triggering a second Sri Lankan alert.
   const second=await worker.deliverOne(doc,spot,fx,now+61*60000);
   assert.equal(second.sent,1);
   assert.equal(second.kind,'movement_sent');
   assert.equal(sent.at(-1).title,'🇸🇦 Saudi 22K gold');
   assert.equal(record.lastAlertAtByMarket.SAR,now+61*60000);
 }finally{webpush.sendNotification=actual;}
});

test('no changed price means no false movement push',async()=>{
 const now=Date.parse('2026-11-21T11:00:00Z');
 const settings=policy.normalizeSettings({markets:['SAR'],karat:24,threshold:.5,direction:'both'});
 const spot={usdOz:3500,asOf:'2026-11-21T10:59:00Z',source:'Gold API'};
 const fx={SAR:3.75,LKR:330,asOf:'2026-11-21T00:00:00Z'};
 const baseline=policy.sampleMarket(spot,fx,settings);
 const d={id:'test',data:()=>({uid:'a',enabled:true,settings,baseline,
  lastSummaryDay:policy.localDayKey(now),settingsFingerprint:worker.checksum(settings),
  subscription:{endpoint:'https://web.push.apple.com/Q/test',keys:{p256dh:'test',auth:'test'}}}),
  ref:{async update(){throw Error('Unexpected write')}}};
 const r=await worker.deliverOne(d,spot,fx,now);
 assert.equal(r.kind,'unchanged');assert.equal(r.sent,undefined);
});
