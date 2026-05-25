const assert = require('node:assert/strict');
const test = require('node:test');

require('../phone-sms/providers/grizzly-sms.js');
require('../phone-sms/providers/registry.js');

test('GrizzlySMS provider buys and polls Codex/OpenAI phone activation', async () => {
  const requestedUrls = [];
  const provider = globalThis.PhoneSmsGrizzlySmsProvider.createProvider({
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      const parsed = new URL(String(url));
      const action = parsed.searchParams.get('action');
      if (action === 'getNumber') {
        assert.equal(parsed.searchParams.get('api_key'), 'codex-grizzly-key');
        assert.equal(parsed.searchParams.get('service'), 'dr');
        assert.equal(parsed.searchParams.get('maxPrice'), '0.25');
        return { ok: true, text: async () => 'ACCESS_NUMBER:12345:15551234567' };
      }
      if (action === 'getStatus') {
        assert.equal(parsed.searchParams.get('id'), '12345');
        return { ok: true, text: async () => 'STATUS_OK:654321' };
      }
      if (action === 'setStatus') {
        assert.equal(parsed.searchParams.get('id'), '12345');
        assert.equal(parsed.searchParams.get('status'), '6');
        return { ok: true, text: async () => 'ACCESS_ACTIVATION' };
      }
      throw new Error(`unexpected action: ${action}`);
    },
    sleepWithStop: async () => {},
    throwIfStopped: () => {},
  });
  const state = {
    grizzlySmsApiKey: 'codex-grizzly-key',
    grizzlySmsServiceCode: 'dr',
    grizzlySmsCountryId: 'any',
    grizzlySmsMaxPrice: '0.25',
  };

  const activation = await provider.requestActivation(state);
  const code = await provider.pollActivationCode(state, activation, { maxRounds: 1 });
  const status = await provider.finishActivation(state, activation);

  assert.equal(activation.provider, 'grizzlysms');
  assert.equal(activation.activationId, '12345');
  assert.equal(activation.phoneNumber, '15551234567');
  assert.equal(activation.maxUses, 1);
  assert.equal(code, '654321');
  assert.equal(status, 'ACCESS_ACTIVATION');
  assert.ok(requestedUrls.some((url) => url.includes('action=getNumber')));
  assert.ok(requestedUrls.some((url) => url.includes('action=getStatus')));
  assert.ok(requestedUrls.some((url) => url.includes('action=setStatus')));
  await assert.rejects(
    () => provider.reuseActivation(state, activation),
    /不支持复用手机号订单/
  );
});

test('phone SMS registry includes only GrizzlySMS and 5sim providers', () => {
  assert.deepEqual(globalThis.PhoneSmsProviderRegistry.getProviderIds(), ['grizzlysms', '5sim']);
  assert.equal(globalThis.PhoneSmsProviderRegistry.normalizeProviderId('grizzlysms'), 'grizzlysms');
  assert.equal(globalThis.PhoneSmsProviderRegistry.normalizeProviderId('5sim'), '5sim');
  assert.equal(globalThis.PhoneSmsProviderRegistry.normalizeProviderId('hero-sms'), 'grizzlysms');
  assert.equal(globalThis.PhoneSmsProviderRegistry.normalizeProviderId('nexsms'), 'grizzlysms');
  assert.equal(globalThis.PhoneSmsProviderRegistry.getProviderLabel('grizzlysms'), 'GrizzlySMS');
  assert.equal(globalThis.PhoneSmsProviderRegistry.getProviderLabel('5sim'), '5sim');
});
