'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('./gold-alert-core.cjs');
// Importing check.cjs requires npm install for dependencies; pure tests run without dependencies.
test('22K SAR uses exactly 22/24 of 24K',()=>{
 const a=policy.gramRate(3100,3.75,24),b=policy.gramRate(3100,3.75,22);
 assert.ok(Math.abs(b/a - 22/24)<1e-10);
});
test('cumulative rise and fall respect 1% settings',()=>{
 const s=policy.normalizeSettings({markets:['SAR'],karat:24,threshold:1,direction:'both'});
 assert.equal(policy.moves({SAR:400},{SAR:403},s).length,0);
 assert.equal(policy.moves({SAR:400},{SAR:404},s).length,1);
 assert.equal(policy.moves({SAR:400},{SAR:396},s).length,1);
});
test('reject unsupported push provider URL',()=>{
 assert.equal(policy.allowedPushEndpoint('https://example.com/collect'),false);
 assert.equal(policy.allowedPushEndpoint('http://web.push.apple.com/test'),false);
 assert.equal(policy.allowedPushEndpoint('https://web.push.apple.com/test'),true);
});
