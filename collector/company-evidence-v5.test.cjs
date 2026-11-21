'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const c=require('./company-evidence-v5.cjs');
const now=new Date('2026-11-21T10:00:00Z');
const row={symbol:'COMB.N0000',price:214,previousClose:215.25,lastTradedTime:1795165186994,
 sharevolume:70139,tradevolume:201,turnover:15021422.5,marketCap:333336721006,high:216,low:213};
test('official dated trade snapshot becomes a dated quote (not a real-time claim)',()=>{
 const q=c.quoteFromTrade(row,now);
 assert.equal(q.value,214);
 assert.equal(q.asOf,'2026-11-20');
 assert.equal(q.verifiedTradeDate,true);
 assert.equal(q.currency,'LKR');
 assert.ok(q.changePct<0);
 assert.equal(q.volume,70139);
});
test('missing quote and unknown codes never fabricate a price',()=>{
 assert.equal(c.quoteFromTrade({...row,price:null},now),null);
 assert.equal(c.quoteFromTrade({...row,symbol:'FAKE.N0000'},now),null);
 assert.equal(c.quoteFromTrade({...row,lastTradedTime:null},now),null);
});
test('market stats are sourced from real summary fields',()=>{
 const f=c.factsFromSummary({reqSymbolInfo:{p12HiPrice:235.25,p12LowPrice:170,marketCap:333336721006,quantityIssued:1557648229,isin:'LK0053N00005'},reqSymbolBetaInfo:{triASIBetaValue:1.15}});
 assert.equal(f.high52Week,235.25);
 assert.equal(f.low52Week,170);
 assert.equal(f.marketCapLKR,333336721006);
});
test('filings are matched by bare issuer code and restricted to CSE PDF host',()=>{
 const f=c.filingsFromRows([
  {symbol:'COMB',fileText:'Annual Report 2025',path:'cmt/upload_report_file/123.pdf',uploadedDate:'20 Nov 2026 07:08:45 AM'},
  {symbol:'HNB',fileText:'Other report',path:'cmt/upload_report_file/xyz.pdf'},
  {symbol:'COMB',fileText:'Phishing',path:'https://attacker.invalid/payload.pdf'}
 ],'COMB.N0000');
 assert.equal(f.length,1);
 assert.equal(f[0].url,'https://cdn.cse.lk/cmt/upload_report_file/123.pdf');
 assert.equal(f[0].published,'2026-11-20');
});
test('universe contains exactly 16 unique tickers',()=>{
 assert.equal(c.CODES.length,16);
 assert.equal(new Set(c.CODES).size,16);
});

test('annual and interim PDF archives for every symbol are selected without fabricated figures',()=>{
 const input={
  infoQuarterlyData:[
   {path:'cmt/upload_report_file/369_1794482282493.pdf',fileText:'Interim Financial Statements for the Quarter ended 30th September 2026',uploadedDate:1794482282493},
   {path:'cmt/upload_report_file/369_1791216000000.pdf',fileText:'Financial Statements Q2 2026',uploadedDate:1791216000000}
  ],
  infoAnnualData:[{path:'cmt/upload_report_file/369_1773048532050.pdf',fileText:'Annual Report 2025',uploadedDate:1773048532050}],
  infoOtherData:[{path:'cmt/upload_report_file/misc.pdf',fileText:'Other'}]
 };
 const files=c.filingsFromArchive(input);
 assert.equal(files.length,3);
 assert.equal(files[0].kind,'interim_report');
 assert.equal(files[2].kind,'annual_report');
 assert.ok(files.every(x=>x.url.startsWith('https://cdn.cse.lk/cmt/upload_report_file/')));
 assert.match(files[0].published,/^2026-/);
});
