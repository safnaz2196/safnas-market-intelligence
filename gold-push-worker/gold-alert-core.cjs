'use strict';
/** Pure financial calculations and alert policy. Values are indicative metal spot equivalents. */
const GRAMS_PER_TROY_OUNCE = 31.1034768;
const MIN_COOLDOWN_MS = 60 * 60 * 1000;
const COUNTRIES = ['SAR', 'LKR'];
function finitePositive(value) { return typeof value === 'number' && Number.isFinite(value) && value > 0; }
function normalizeSettings(input = {}) {
  const markets = Array.isArray(input.markets) ? [...new Set(input.markets.filter(x => COUNTRIES.includes(x)))] : ['SAR', 'LKR'];
  if (!markets.length) throw new Error('Select at least one market');
  const karat = Number(input.karat ?? 24);
  const threshold = Number(input.threshold ?? 1);
  if (![22, 24].includes(karat)) throw new Error('Unsupported karat');
  if (![0.5, 1, 2, 3, 5].includes(threshold)) throw new Error('Unsupported notification threshold');
  const direction = String(input.direction ?? 'both');
  if (!['both', 'rise', 'fall'].includes(direction)) throw new Error('Unsupported direction');
  return {markets, karat, threshold, direction};
}
function gramRate(usdPerTroyOunce, fxRate, karat) {
  if (![usdPerTroyOunce, fxRate].every(finitePositive) || ![22, 24].includes(karat)) throw new Error('Invalid gold/FX rate');
  return usdPerTroyOunce / GRAMS_PER_TROY_OUNCE * fxRate * karat / 24;
}
function sampleMarket(spot, fx, settings) {
  const result = {};
  for (const currency of settings.markets) result[currency] = gramRate(spot.usdOz, fx[currency], settings.karat);
  return result;
}
function pctChange(previous, current) {
  if (![previous, current].every(finitePositive)) return null;
  return (current / previous - 1) * 100;
}
function moves(baseline, rates, settings) {
  return settings.markets.flatMap(currency => {
    const change = pctChange(baseline?.[currency], rates[currency]);
    if (change === null || Math.abs(change) < settings.threshold - 1e-8) return [];
    if (settings.direction === 'rise' && change <= 0) return [];
    if (settings.direction === 'fall' && change >= 0) return [];
    return [{currency, change, price: rates[currency]}];
  });
}
function displayRate(amount) {
  if (!finitePositive(amount)) throw new Error('Invalid current gold price');
  return new Intl.NumberFormat('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}).format(amount);
}
function goldPriceLines(settings, latest, baseline = {}) {
  return settings.markets.map(currency => {
    const current=latest?.[currency];
    const previous=baseline?.[currency];
    const change=pctChange(previous,current);
    const movement=change === null ? '' : change > 0.005 ? ` ▲${change.toFixed(2)}%` : change < -0.005 ? ` ▼${Math.abs(change).toFixed(2)}%` : ' →0.00%';
    const flag=currency==='SAR'?'🇸🇦':'🇱🇰';
    return `${flag} ${currency} ${settings.karat}K ${displayRate(current)}/g${movement}`;
  });
}
function makeNotification(movements, settings, observedAt, source, latest = null, baseline = null) {
  if(!movements.length) throw new Error('No alert-worthy price moves');
  const focus=movements.reduce((best, item) => Math.abs(item.change) > Math.abs(best.change) ? item : best, movements[0]);
  const label=focus.change>=0?'rose':'fell';
  const priceMap=latest || Object.fromEntries(movements.map(m=>[m.currency,m.price]));
  const markets=settings.markets.filter(currency=>finitePositive(priceMap[currency]));
  const lines=goldPriceLines({...settings,markets},priceMap,baseline||{});
  return {
    title:`Gold ${label} ${Math.abs(focus.change).toFixed(2)}% · Safnas Finance`,
    body:lines.join(' · '),
    tag:'safnas-gold-movement-alert',
    url:'/#gold-prices',
    kind:'movement',
    source,observedAt
  };
}
function makeSummaryNotification(settings, latest, baseline, observedAt, source) {
  return {
    title:`Gold price update · ${settings.karat}K · Safnas Finance`,
    body:goldPriceLines(settings,latest,baseline||{}).join(' · '),
    tag:'safnas-gold-price-summary',
    url:'/#gold-prices',
    kind:'summary',
    source,observedAt
  };
}
function localDayKey(now = Date.now()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const get=(type)=>parts.find(p=>p.type===type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function localHour(now = Date.now()) {
  return Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));
}
function summaryDue(lastSummaryDay, now = Date.now()) {
  // One price summary per Riyadh calendar day after 08:00; scheduled jobs may run late.
  return localHour(now)>=8 && lastSummaryDay!==localDayKey(now);
}
function isFresh(spot, fx, now = Date.now()) {
  const spotTime = Date.parse(spot?.asOf);
  const fxTime = Date.parse(fx?.asOf);
  return Number.isFinite(spotTime) && Number.isFinite(fxTime)
    && spotTime <= now + 3*60e3 && spotTime >= now - 3*3600e3
    && fxTime <= now + 3*3600e3 && fxTime >= now - 48*3600e3;
}
function allowedPushEndpoint(urlText) {
  try {
    const url = new URL(urlText);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) return false;
    const host = url.hostname.toLowerCase();
    return /(^|\.)push\.apple\.com$/.test(host) || host === 'fcm.googleapis.com'
      || host === 'updates.push.services.mozilla.com' || host === 'push.services.mozilla.com';
  } catch {return false;}
}
module.exports={GRAMS_PER_TROY_OUNCE,MIN_COOLDOWN_MS,normalizeSettings,gramRate,sampleMarket,pctChange,moves,makeNotification,makeSummaryNotification,goldPriceLines,localDayKey,summaryDue,isFresh,allowedPushEndpoint};
