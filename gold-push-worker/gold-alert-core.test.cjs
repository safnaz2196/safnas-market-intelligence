'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const c = require('./gold-alert-core.cjs');
test('strict settings; only valid markets, purities, directions and thresholds',()=>{
 assert.deepEqual(c.normalizeSettings({markets:['SAR','SAR','LKR','INR'],karat:22,threshold:.5,direction:'fall'}), {markets:['SAR','LKR'],karat:22,threshold:.5,direction:'fall'});
 assert.throws(()=>c.normalizeSettings({karat:18}));
 assert.throws(()=>c.normalizeSettings({threshold:0}));
 assert.throws(()=>c.normalizeSettings({markets:['USD']}));
});
test('gold spot per gram matches on-screen formula',()=>{
 assert.ok(Math.abs(c.gramRate(3900,3.75,24) -3900/31.1034768*3.75)<1e-8);
 assert.ok(Math.abs(c.gramRate(3900,3.75,22)-c.gramRate(3900,3.75,24)*22/24)<1e-8);
});
test('move alerts require significant increase/decrease and correct direction',()=>{
 const settings={markets:['SAR','LKR'],threshold:1,direction:'both'};
 assert.deepEqual(c.moves({SAR:400,LKR:40000},{SAR:402,LKR:39800},settings),[]);
 assert.equal(c.moves({SAR:400,LKR:40000},{SAR:408,LKR:40000},settings).length,1);
 assert.equal(c.moves({SAR:400,LKR:40000},{SAR:408,LKR:39500},{...settings,direction:'fall'}).length,1);
 assert.equal(c.moves({SAR:400,LKR:40000},{SAR:408,LKR:39500},{...settings,direction:'rise'}).length,1);
 assert.deepEqual(c.moves({}, {SAR:408,LKR:40000},settings),[]);
});
test('skip stale, missing, impossible quote timestamps',()=>{
 const now=Date.now();
 assert.equal(c.isFresh({asOf:new Date(now-12e4).toISOString()},{asOf:new Date(now-3600e3).toISOString()},now),true);
 assert.equal(c.isFresh({asOf:new Date(now-4*3600e3).toISOString()},{asOf:new Date(now).toISOString()},now),false);
 assert.equal(c.isFresh({asOf:new Date(now).toISOString()},{asOf:new Date(now-50*3600e3).toISOString()},now),false);
});
test('block SSRF endpoints and only permit common push services',()=>{
 assert.equal(c.allowedPushEndpoint('https://web.push.apple.com/abc'),true);
 assert.equal(c.allowedPushEndpoint('https://fcm.googleapis.com/fcm/send/abcdef'),true);
 assert.equal(c.allowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/xyz'),true);
 for(const bad of ['http://web.push.apple.com/x','https://push.apple.com.evil.com/x','https://169.254.169.254/x','https://127.0.0.1/','https://u:pass@fcm.googleapis.com/x']) assert.equal(c.allowedPushEndpoint(bad),false);
});
test('notification includes observed actual market prices; no fabricated prediction',()=>{
 const settings=c.normalizeSettings({markets:['SAR','LKR'],threshold:1});
 const msg=c.makeNotification([{currency:'SAR',change:-1.3,price:459.01},{currency:'LKR',change:-1.02,price:41001.7}],settings,'2026-11-15T07:00:00Z','Gold API');
 assert.match(msg.title,/fell 1.30%/); assert.match(msg.body,/459.01\/g/); assert.match(msg.body,/41,001.70\/g/);
});
