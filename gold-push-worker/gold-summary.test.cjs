'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('./gold-alert-core.cjs');
const settings=c.normalizeSettings({markets:['SAR','LKR'],karat:22,threshold:.5,direction:'both'});
const prices={SAR:456.25,LKR:41800.89};
const baseline={SAR:455.00,LKR:42000.00};
test('daily summary shows actual SAR and LKR rates, movements, and gold view link',()=>{
  const m=c.makeSummaryNotification(settings,prices,baseline,'2026-11-21T06:00:00Z','Gold API');
  assert.match(m.title,/22K/);
  assert.match(m.body,/SAR 22K 456.25\/g ▲0.27%/);
  assert.match(m.body,/LKR 22K 41,800.89\/g ▼0.47%/);
  assert.equal(m.url,'/#gold-prices');
});
test('a significant move includes both selected market rates',()=>{
  const now={SAR:463,LKR:41800.89};
  const moves=c.moves(baseline,now,settings);
  assert.equal(moves.length,1);
  const m=c.makeNotification(moves,settings,'2026-11-21T07:00:00Z','Gold API',now,baseline);
  assert.match(m.body,/SAR 22K 463.00\/g/);
  assert.match(m.body,/LKR 22K 41,800.89\/g/);
});
test('first observation does not fabricate price movement',()=>{
  const m=c.makeSummaryNotification(settings,prices,null,'2026-11-21T07:00:00Z','Gold API');
  assert.doesNotMatch(m.body,/[▲▼]/);
});
test('daily summary only after 08:00 Riyadh and only once per local day',()=>{
  const after=Date.parse('2026-11-21T06:00:00Z');
  const before=Date.parse('2026-11-21T04:00:00Z');
  assert.equal(c.summaryDue('2026-11-20',after),true);
  assert.equal(c.summaryDue('2026-11-21',after),false);
  assert.equal(c.summaryDue('2026-11-20',before),false);
  assert.equal(c.localDayKey(after),'2026-11-21');
});
