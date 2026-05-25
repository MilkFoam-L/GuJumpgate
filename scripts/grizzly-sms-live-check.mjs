import '../phone-sms/providers/grizzly-sms.js';

const apiKey = String(process.env.GRIZZLY_SMS_API_KEY || '').trim();
const serviceCode = String(process.env.GRIZZLY_SMS_SERVICE_CODE || 'dr').trim() || 'dr';
const countryId = String(process.env.GRIZZLY_SMS_COUNTRY_ID || 'any').trim() || 'any';
const maxPrice = String(process.env.GRIZZLY_SMS_MAX_PRICE || '').trim();
const allowBuy = process.argv.includes('--buy') || process.env.GRIZZLY_SMS_BUY === '1';

if (!apiKey) {
  console.error('GRIZZLY_SMS_API_KEY is required.');
  process.exit(2);
}

const provider = globalThis.PhoneSmsGrizzlySmsProvider.createProvider({
  fetchImpl: fetch,
  sleepWithStop: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  throwIfStopped: () => {},
});

const state = {
  grizzlySmsApiKey: apiKey,
  grizzlySmsServiceCode: serviceCode,
  grizzlySmsCountryId: countryId,
  grizzlySmsCountryLabel: countryId === 'any' ? '任意 (any)' : `Country ${countryId}`,
  grizzlySmsMaxPrice: maxPrice,
};

async function requestRaw(query = {}) {
  const url = new URL('https://api.grizzlysms.com/stubs/handler_api.php');
  url.searchParams.set('api_key', apiKey);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  const response = await fetch(url);
  return { status: response.status, text: await response.text() };
}

function maskPhoneNumber(value = '') {
  const digits = String(value || '').replace(/\D+/g, '');
  if (!digits) return '';
  if (digits.length <= 4) return '****';
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

try {
  const balance = await provider.fetchBalance(state);
  console.log(JSON.stringify({ ok: true, step: 'balance', balance }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, step: 'balance', error: error.message }, null, 2));
  process.exit(1);
}

try {
  const prices = await requestRaw({ action: 'getPrices' });
  let stock = null;
  try {
    const parsed = JSON.parse(prices.text);
    stock = parsed?.[state.grizzlySmsCountryId]?.[state.grizzlySmsServiceCode] || null;
  } catch {
    stock = null;
  }
  console.log(JSON.stringify({
    ok: true,
    step: 'prices',
    serviceCode: state.grizzlySmsServiceCode,
    countryId: state.grizzlySmsCountryId,
    stock,
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, step: 'prices', error: error.message }, null, 2));
  process.exit(1);
}

if (!allowBuy) {
  console.log(JSON.stringify({
    ok: true,
    step: 'skip-buy',
    message: 'Pass --buy or GRIZZLY_SMS_BUY=1 to request a real number.',
  }, null, 2));
  process.exit(0);
}

try {
  const activation = await provider.requestActivation(state);
  console.log(JSON.stringify({
    ok: true,
    step: 'getNumber',
    activation: {
      ...activation,
      phoneNumber: maskPhoneNumber(activation.phoneNumber),
    },
  }, null, 2));
  try {
    const cancelled = await provider.cancelActivation(state, activation);
    console.log(JSON.stringify({ ok: true, step: 'cancel', result: cancelled }, null, 2));
  } catch (cancelError) {
    console.error(JSON.stringify({ ok: false, step: 'cancel', error: cancelError.message }, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, step: 'getNumber', error: error.message }, null, 2));
  process.exit(1);
}
