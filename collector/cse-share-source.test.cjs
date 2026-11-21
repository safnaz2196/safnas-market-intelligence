'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {recoverDatedShareQuotes}=require('./cse-share-source.cjs');
const NOW=new Date('2026-11-21T11:00:00Z');
const source=()=>({schemaVersion:1,generatedAt:'2026-11-21T07:35:01.955Z',companies:{
 'COMB.N0000':{quote:{value:214,asOf:'2026-11-20',verifiedTradeDate:true,turnoverLKR:15021422.5}},
 'DIAL.N0000':{quote:{value:48,asOf:'2026-11-20',verifiedTradeDate:true,turnoverLKR:10000320}},
 'BAD.N0000':{quote:{value:80,asOf:null,verifiedTradeDate:false}}
}});
test('recover official company quotes with original date, not a fabricated today price',()=>{
 const names={companies:[{ticker:'COMB.N0000',name:'Commercial Bank of Ceylon PLC'}]};
 const rows=recoverDatedShareQuotes(source(),names,NOW);
 assert.equal(rows.length,2);
 assert.equal(rows[0].name,'Commercial Bank of Ceylon PLC');
 assert.equal(rows[0].asOf,'2026-11-20');
 assert.equal(rows[0].archivedObservation,true);
 assert.equal(rows[0].verifiedTradeDate,true);
 assert.equal(rows[0].sourceURL,'https://www.cse.lk/api/tradeSummary');
});
test('do not backfill old or undated snapshots as current shares',()=>{
 const old=source();old.generatedAt='2026-08-01T07:35:01.955Z';
 assert.equal(recoverDatedShareQuotes(old,{},NOW).length,0);
 const malformed=source();malformed.companies['COMB.N0000'].quote.asOf='2027-01-01';
 const rows=recoverDatedShareQuotes(malformed,{},NOW);
 assert.equal(rows.length,1);
 assert.equal(rows[0].ticker,'DIAL.N0000');
});
test('fail safely on missing quote archive',()=>{
 assert.deepEqual(recoverDatedShareQuotes(null,null,NOW),[]);
 assert.deepEqual(recoverDatedShareQuotes({schemaVersion:1,generatedAt:'bad',companies:{}},{},NOW),[]);
});
