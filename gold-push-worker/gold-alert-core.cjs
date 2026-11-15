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
function makeNotification(movements, settings, observedAt, source) {
  if (!movements.length) throw new Error('No alert-worthy price moves');
  const focus = movements.reduce((best, item) => Math.abs(item.change) > Math.abs(best.change) ? item : best, movements[0]);
  const label = focus.change >= 0 ? 'rose' : 'fell';
  const lines = movements.map(m => `${m.currency} ${settings.karat}K: ${new Intl.NumberFormat('en-US', {minimumFractionDigits:2,maximumFractionDigits:2}).format(m.price)}/g (${m.change >= 0?'+':''}${m.change.toFixed(2)}%)`);
  return {
    title: `Gold ${label} ${Math.abs(focus.change).toFixed(2)}% · Safnas Finance`,
    body: lines.join(' · '),
    tag: 'safnas-gold-market-alert',
    url: '/',
    source,
    observedAt,
  };
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
module.exports={GRAMS_PER_TROY_OUNCE,MIN_COOLDOWN_MS,normalizeSettings,gramRate,sampleMarket,pctChange,moves,makeNotification,isFresh,allowedPushEndpoint};
