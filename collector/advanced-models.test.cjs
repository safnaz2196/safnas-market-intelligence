const test=require('node:test'),assert=require('node:assert/strict');
const m=require('./advanced-models.cjs'),learner=require('./ml-core.cjs');
const records=Array.from({length:125},(_,i)=>({x:[Math.sin(i/7),Math.cos(i/19),i%9/9],y:i%11<6?1:0}));
test('random forest deterministic and bounded',()=>{const a=m.forestFit(records),b=m.forestFit(records);assert.equal(m.forestPredict(a,[.2,.3,.4]),m.forestPredict(b,[.2,.3,.4]));assert.ok(m.forestPredict(a,[.2,.3,.4])>0)});
test('boosted model returns finite bounded diagnostic',()=>{const b=m.boostFit(records);const p=m.boostPredict(b,[.1,.8,.3]);assert.ok(Number.isFinite(p)&&p>0&&p<1)});
test('walk-forward folds purge labels ahead of feature dates',()=>{const items=Array.from({length:230},(_,i)=>({date:String(i),x:[i],y:i%2}));for(const h of [5,20])for(const f of learner.makeFolds(items,h))assert.ok(f.train.length+h<=f.start)});
test('model abstains on stale data',()=>{const rows=Array.from({length:260},(_,i)=>({date:new Date(Date.UTC(2021,0,1+i*2)).toISOString().slice(0,10),close:1000+Math.sin(i/5)*20+i}));assert.equal(learner.trainAndValidate(rows,5,new Date('2026-11-12')).ok,false)});
