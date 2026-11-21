'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('./gold-alert-core.cjs');
const settings=c.normalizeSettings({markets:['SAR','LKR'],karat:22,threshold:.5});
const data={SAR:462.15,LKR:42301.12};
const old={SAR:460.00,LKR:43000.00};
const when='2026-11-21T09:12:00Z';
test('Saudi iPhone notification is compact with readable price first',()=>{
 const m=c.makeMobileMarketNotification('SAR',settings,data,old,'summary',when,'Gold API');
 assert.equal(m.title,'🇸🇦 Saudi 22K gold');
 assert.equal(m.body,'SAR 462.15/gram  ▲ UP 0.47%');
 assert.ok(m.title.length<35 && m.body.length<45);
 assert.equal(m.url,'/#gold-prices');
});
test('Sri Lanka has its own notification tag so it cannot replace Saudi on the lock screen',()=>{
 const a=c.makeMobileMarketNotification('SAR',settings,data,old,'summary',when,'Gold API');
 const b=c.makeMobileMarketNotification('LKR',settings,data,old,'summary',when,'Gold API');
 assert.equal(b.title,'🇱🇰 Sri Lanka 22K gold');
 assert.equal(b.body,'LKR 42,301.12/gram  ▼ DOWN 1.63%');
 assert.notEqual(a.tag,b.tag);
});
test('first sample never invents a rise or fall',()=>{
 const m=c.makeMobileMarketNotification('SAR',settings,data,null,'test',when,'Gold API');
 assert.equal(m.body,'SAR 462.15/gram');
});
test('rejects unsupported or unselected market',()=>{
 assert.throws(()=>c.makeMobileMarketNotification('USD',settings,data,old,'test',when,'Gold API'));
 assert.throws(()=>c.makeMobileMarketNotification('LKR',{...settings,markets:['SAR']},data,old,'test',when,'Gold API'));
});
