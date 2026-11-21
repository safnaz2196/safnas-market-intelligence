'use strict';
/** Safnas Finance v5.0.3: Spark-compatible, scheduled FREE Web Push sender.
 * Runs on GitHub Actions. Requires secrets at execution time only.
 * No Firebase Cloud Functions, billing, or private key in browser/git.
 */
const admin = require('firebase-admin');
const webpush = require('web-push');
const crypto = require('node:crypto');
const policy = require('./gold-alert-core.cjs');

const COLLECTION = 'goldPushSubscriptions';
const MAX_DEVICES_PER_RUN = 300;
const TEST_MODE = process.env.GOLD_ALERT_MODE === 'test';
const GAS = 'https://api.gold-api.com/price/XAU';
const GAS_BACKUP = 'https://xaus.com/api/v1/spot';
const FX = 'https://open.er-api.com/v6/latest/USD';

function readSecrets(env = process.env) {
  const required = ['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOLD_PUSH_VAPID_PUBLIC_KEY', 'GOLD_PUSH_VAPID_PRIVATE_KEY'];
  for (const k of required) if (!env[k]) throw new Error(`Required GitHub Actions secret is missing: ${k}`);
  // Windows PowerShell 5.1 may save UTF-8 service-account JSON with a BOM (U+FEFF).
  // GitHub Actions passes those bytes through the secret unchanged. Strip the BOM
  // and surrounding whitespace before parsing; never print the credential value.
  let cred;
  try { cred = JSON.parse(String(env.FIREBASE_SERVICE_ACCOUNT_JSON).replace(/^\uFEFF/, '').trim()); }
  catch { throw new Error('Firebase service-account secret contains invalid JSON. Recreate the secret with UTF-8 without BOM.'); }
  if (!cred || cred.project_id !== 'safnas-finance' || typeof cred.private_key !== 'string') throw new Error('Invalid Firebase service account for safnas-finance');
  return {cred, vapidPublic:env.GOLD_PUSH_VAPID_PUBLIC_KEY.trim(), vapidPrivate:env.GOLD_PUSH_VAPID_PRIVATE_KEY.trim()};
}
function checksum(input) { return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
async function fetchJson(url) {
  const response = await fetch(url, {signal:AbortSignal.timeout(18000), headers:{Accept:'application/json','User-Agent':'SafnasFinanceGoldAlert/5.0.3'}});
  if (!response.ok) throw new Error(`Market feed unavailable (HTTP ${response.status})`);
  return response.json();
}
async function spotQuote() {
  try {
    const d=await fetchJson(GAS);
    const amount=Number(d.price); const asOf=d.updatedAt || d.updated_at;
    if (!(Number.isFinite(amount) && amount>0) || !asOf || (d.currency && d.currency!=='USD')) throw new Error('Invalid spot response');
    return {usdOz:amount, asOf, source:'Gold API'};
  } catch(primaryError) {
    const d=await fetchJson(GAS_BACKUP);
    const amount=Number(d.spot_usd_oz ?? d.xau?.price); const asOf=d.data_state?.as_of || d.updated_at;
    if (!(Number.isFinite(amount) && amount>0) || !asOf) throw primaryError;
    return {usdOz:amount, asOf, source:'XAUS'};
  }
}
async function fxQuote() {
  const d=await fetchJson(FX); const SAR=Number(d.rates?.SAR); const LKR=Number(d.rates?.LKR);
  const unix=Number(d.time_last_update_unix);
  if(d.result!=='success'||d.base_code!=='USD'||![SAR,LKR,unix].every(Number.isFinite)||SAR<=0||LKR<=0||unix<=0) throw new Error('FX reference unavailable');
  return {SAR,LKR,asOf:new Date(unix*1000).toISOString()};
}
function normalizeDoc(d) {
  if (!d || !d.enabled || !d.uid || !d.subscription || !policy.allowedPushEndpoint(d.subscription.endpoint)) return null;
  try{return {settings:policy.normalizeSettings(d.settings), subscription:d.subscription}}catch{return null;}
}
function makePayload(p) {
  return JSON.stringify({title:p.title,body:p.body,tag:p.tag,source:p.source||null,observedAt:p.observedAt||null,url:p.url||'/#gold-prices',kind:p.kind||null,icon:'/icons/moneytrack-192.png',badge:'/icons/moneytrack-192.png'});
}
async function deliverOne(doc, spot, fx, now) {
  const d=doc.data(), norm=normalizeDoc(d);
  if(!norm) return {kind:'invalid'};
  const {settings,subscription}=norm;
  const settingHash=checksum(settings);
  const latest=policy.sampleMarket(spot,fx,settings);
  const changedSettings=!d.baseline || d.settingsFingerprint!==settingHash;
  const baseline=changedSettings?latest:d.baseline;
  if(changedSettings) {
    await doc.ref.update({baseline:latest,settingsFingerprint:settingHash,lastObservedAt:spot.asOf});
  }
  const movements=policy.moves(baseline,latest,settings);
  const cooldown=now-Number(d.lastAlertAt||0)<policy.MIN_COOLDOWN_MS;
  const canSendMovement=movements.length>0&&!cooldown;
  const summaryDue=policy.summaryDue(d.lastSummaryDay,now);
  if(!canSendMovement && !summaryDue) return {kind:changedSettings?'baseline':movements.length?'cooldown':'unchanged'};
  const isMovement=canSendMovement;
  const payload=isMovement
    ? policy.makeNotification(movements,settings,spot.asOf,spot.source,latest,baseline)
    : policy.makeSummaryNotification(settings,latest,baseline,spot.asOf,spot.source);
  const signature=checksum([payload.kind,spot.asOf,fx.asOf,settings,payload.body]);
  if(signature===d.lastNotificationSignature)return {kind:'duplicate'};
  try {
    await webpush.sendNotification(subscription,makePayload(payload),{TTL:7200,urgency:'normal'});
    const patch={lastNotificationSignature:signature,lastObservedAt:spot.asOf};
    if(isMovement){patch.baseline=latest;patch.lastAlertAt=now;}
    if(summaryDue) {patch.lastSummaryDay=policy.localDayKey(now);patch.lastSummaryAt=now;}
    await doc.ref.update(patch);
    return {kind:isMovement?'movement_sent':'summary_sent'};
  } catch(e) {
    if([404,410].includes(Number(e.statusCode))) {await doc.ref.delete();return {kind:'expired'};}
    console.warn('Push provider rejected an alert for device',doc.id.slice(-8),'status',e.statusCode||'network error');
    return {kind:'failed'};
  }
}
async function main() {
  const sec=readSecrets();
  admin.initializeApp({credential:admin.credential.cert(sec.cred),projectId:'safnas-finance'});
  const db=admin.firestore();
  webpush.setVapidDetails('mailto:safnas-finance@users.noreply.github.com',sec.vapidPublic,sec.vapidPrivate);
  const subscriptionDocs=await db.collection(COLLECTION).limit(MAX_DEVICES_PER_RUN).get();
  if(subscriptionDocs.empty) {console.log('Gold push: no devices subscribed yet.');return;}
  if(subscriptionDocs.size===MAX_DEVICES_PER_RUN) console.warn('Subscription limit reached: raise MAX_DEVICES_PER_RUN if needed.');
  console.log('Registered devices:',subscriptionDocs.size);
  if(TEST_MODE) {
    const [spot,fx]=await Promise.all([spotQuote(),fxQuote()]);
    if(!policy.isFresh(spot,fx))throw new Error('Cannot send gold-price test: current market/FX quotes are stale.');
    let sent=0;
    for(const doc of subscriptionDocs.docs) {
      const d=normalizeDoc(doc.data()); if(!d) continue;
      try {
        const latest=policy.sampleMarket(spot,fx,d.settings);
        const payload=policy.makeSummaryNotification(d.settings,latest,doc.data().baseline,spot.asOf,spot.source);
        payload.title='Gold price test · '+d.settings.karat+'K · Safnas Finance';
        payload.tag='safnas-gold-price-test';
        await webpush.sendNotification(d.subscription,makePayload(payload),{TTL:3600});
        sent++;
      } catch(e) {console.warn('Test push failed for',doc.id.slice(-8),Number(e.statusCode)||'network');}
    }
    console.log(`Gold price TEST notifications accepted by push providers: ${sent}`);return;
  }
  const [spot,fx]=await Promise.all([spotQuote(),fxQuote()]);
  if(!policy.isFresh(spot,fx)) {
    console.warn('Market/FX data is not fresh enough; no notifications sent.',{spotTime:spot.asOf,fxTime:fx.asOf});
    return;
  }
  const tally={};
  for (const doc of subscriptionDocs.docs) {
    try {const r=await deliverOne(doc,spot,fx,Date.now());tally[r.kind]=(tally[r.kind]||0)+1;}
    catch(e){console.warn('Device check failed',doc.id.slice(-8),e.message);tally.error=(tally.error||0)+1;}
  }
  console.log(JSON.stringify({market:spot.source,observedAt:spot.asOf,checks:tally}));
}
if (require.main===module) main().catch(err=>{console.error('Gold push worker failed:',err.message);process.exitCode=1;});
module.exports={readSecrets,normalizeDoc,checksum,makePayload,spotQuote,fxQuote};
