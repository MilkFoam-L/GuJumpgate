// phone-sms/providers/grizzly-sms.js - GrizzlySMS provider for Codex/OpenAI phone verification
(function attachGrizzlySmsProvider(root, factory) {
  root.PhoneSmsGrizzlySmsProvider = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createGrizzlySmsProviderModule() {
  const PROVIDER_ID = 'grizzlysms';
  const DEFAULT_BASE_URL = 'https://api.grizzlysms.com/stubs/handler_api.php';
  const DEFAULT_SERVICE_CODE = 'dr';
  const DEFAULT_SERVICE_LABEL = 'OpenAI';
  const DEFAULT_COUNTRY_ID = 'any';
  const DEFAULT_COUNTRY_LABEL = '任意 (any)';
  const DEFAULT_REQUEST_TIMEOUT_MS = 20000;

  function normalizeGrizzlySmsServiceCode(value = '', fallback = DEFAULT_SERVICE_CODE) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '') || fallback;
  }

  function normalizeGrizzlySmsCountryId(value = '', fallback = DEFAULT_COUNTRY_ID) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '') || fallback;
  }

  function normalizeGrizzlySmsCountryLabel(value = '', fallback = DEFAULT_COUNTRY_LABEL) {
    return String(value || '').trim() || fallback;
  }

  function normalizeGrizzlySmsCountryFallback(value = []) {
    const source = Array.isArray(value)
      ? value
      : String(value || '')
        .split(/[\r\n,，;；]+/)
        .map((entry) => String(entry || '').trim())
        .filter(Boolean);
    const seen = new Set();
    const normalized = [];
    for (const entry of source) {
      const id = normalizeGrizzlySmsCountryId(
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? (entry.id ?? entry.countryId ?? entry.country ?? '')
          : entry,
        ''
      );
      if (!id || seen.has(id)) continue;
      seen.add(id);
      normalized.push({ id, label: id === 'any' ? DEFAULT_COUNTRY_LABEL : `Country ${id}` });
      if (normalized.length >= 20) break;
    }
    return normalized;
  }

  function normalizeGrizzlySmsMaxPrice(value = '') {
    const rawValue = String(value ?? '').trim();
    if (!rawValue) return '';
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) return '';
    return String(Math.round(numeric * 10000) / 10000);
  }

  function normalizeBaseUrl(value = '') {
    const trimmed = String(value || '').trim() || DEFAULT_BASE_URL;
    try {
      return new URL(trimmed).toString();
    } catch {
      return DEFAULT_BASE_URL;
    }
  }

  function buildUrl(config = {}, query = {}) {
    const url = new URL(normalizeBaseUrl(config.baseUrl));
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      if (key === 'country' && String(value).trim().toLowerCase() === 'any') return;
      url.searchParams.set(key, String(value));
    });
    return url.toString();
  }

  function parsePayload(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.parse(trimmed); } catch { return trimmed; }
    }
    return trimmed;
  }

  function describePayload(raw) {
    if (typeof raw === 'string') return raw.trim();
    if (raw && typeof raw === 'object') {
      const direct = String(raw.message || raw.msg || raw.error || raw.title || raw.status || '').trim();
      if (direct) return direct;
      try { return JSON.stringify(raw); } catch { return String(raw); }
    }
    return String(raw || '').trim();
  }

  function resolveConfig(state = {}, deps = {}) {
    return {
      apiKey: String(state.grizzlySmsApiKey || '').trim(),
      baseUrl: state.grizzlySmsBaseUrl || DEFAULT_BASE_URL,
      serviceCode: normalizeGrizzlySmsServiceCode(state.grizzlySmsServiceCode),
      countryId: normalizeGrizzlySmsCountryId(state.grizzlySmsCountryId),
      maxPrice: normalizeGrizzlySmsMaxPrice(state.grizzlySmsMaxPrice),
      fetchImpl: deps.fetchImpl || (typeof fetch === 'function' ? fetch.bind(globalThis) : null),
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
  }

  async function fetchPayload(config, query, actionLabel = 'GrizzlySMS request') {
    if (!config.apiKey) throw new Error('GrizzlySMS API Key 缺失，请先在侧边栏保存接码 API Key。');
    if (!config.fetchImpl) throw new Error('GrizzlySMS 网络请求实现不可用。');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => controller.abort(), Number(config.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS) : null;
    try {
      const response = await config.fetchImpl(buildUrl(config, { api_key: config.apiKey, ...query }), {
        method: 'GET',
        signal: controller?.signal,
      });
      const text = await response.text();
      const payload = parsePayload(text);
      if (!response.ok) {
        const error = new Error(`${actionLabel}失败：${describePayload(payload) || response.status}`);
        error.payload = payload;
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`${actionLabel}超时。`);
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  function normalizeActivation(payload, fallback = {}) {
    const text = describePayload(payload);
    const match = text.match(/^ACCESS_NUMBER:([^:]+):(.+)$/i);
    if (!match) return null;
    return {
      activationId: String(match[1] || '').trim(),
      phoneNumber: String(match[2] || '').trim(),
      provider: PROVIDER_ID,
      serviceCode: fallback.serviceCode || DEFAULT_SERVICE_CODE,
      countryId: fallback.countryId || DEFAULT_COUNTRY_ID,
      ...(fallback.countryLabel ? { countryLabel: fallback.countryLabel } : {}),
      successfulUses: 0,
      maxUses: 1,
    };
  }

  function resolveCountryCandidates(state = {}) {
    const primary = {
      id: normalizeGrizzlySmsCountryId(state.grizzlySmsCountryId),
      label: normalizeGrizzlySmsCountryLabel(state.grizzlySmsCountryLabel),
    };
    const seen = new Set([primary.id]);
    const candidates = [primary];
    normalizeGrizzlySmsCountryFallback(state.grizzlySmsCountryFallback).forEach((entry) => {
      if (!entry.id || seen.has(entry.id)) return;
      seen.add(entry.id);
      candidates.push(entry);
    });
    return candidates;
  }

  async function requestActivation(state = {}, _options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const service = config.serviceCode;
    for (const country of resolveCountryCandidates(state)) {
      const payload = await fetchPayload(config, {
        action: 'getNumber',
        service,
        country: normalizeGrizzlySmsCountryId(country.id),
        maxPrice: config.maxPrice,
      }, 'GrizzlySMS 获取手机号');
      const activation = normalizeActivation(payload, {
        serviceCode: service,
        countryId: country.id,
        countryLabel: country.label,
      });
      if (activation) return activation;
      const text = describePayload(payload);
      if (/NO_NUMBERS|NO_BALANCE|BAD_KEY|WRONG_SERVICE|BANNED/i.test(text)) {
        if (/NO_NUMBERS/i.test(text)) continue;
        throw new Error(`GrizzlySMS 获取手机号失败：${text}`);
      }
    }
    throw new Error('GrizzlySMS 暂无可用号码。');
  }

  async function pollActivationCode(state = {}, activation, options = {}, deps = {}) {
    const config = resolveConfig(state, deps);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 180000);
    const intervalMs = Math.max(1000, Number(options.intervalMs) || 5000);
    const maxRoundsRaw = Math.floor(Number(options.maxRounds));
    const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? maxRoundsRaw : 0;
    const start = Date.now();
    let pollCount = 0;
    let lastResponse = '';
    while (Date.now() - start < timeoutMs) {
      if (maxRounds > 0 && pollCount >= maxRounds) break;
      deps.throwIfStopped?.();
      const payload = await fetchPayload(config, {
        action: 'getStatus',
        id: activation.activationId,
      }, 'GrizzlySMS 查询验证码');
      pollCount += 1;
      lastResponse = describePayload(payload);
      if (typeof options.onStatus === 'function') {
        await options.onStatus({ activation, elapsedMs: Date.now() - start, pollCount, statusText: lastResponse || 'PENDING', timeoutMs });
      }
      const match = lastResponse.match(/^STATUS_OK:(\d{4,8})/i) || lastResponse.match(/\b(\d{4,8})\b/);
      if (match) return match[1];
      if (/STATUS_CANCEL|STATUS_BANNED|NO_ACTIVATION/i.test(lastResponse)) {
        throw new Error(`GrizzlySMS 查询验证码失败：${lastResponse}`);
      }
      if (typeof options.onWaitingForCode === 'function') {
        await options.onWaitingForCode({ activation, elapsedMs: Date.now() - start, pollCount, statusText: lastResponse || 'PENDING', timeoutMs });
      }
      await deps.sleepWithStop(intervalMs);
    }
    throw new Error(`PHONE_CODE_TIMEOUT::等待手机验证码超时。GrizzlySMS 最后状态：${lastResponse || '未知'}`);
  }

  async function setActivationStatus(state = {}, activation, status, deps = {}) {
    if (!activation?.activationId) return '';
    const payload = await fetchPayload(resolveConfig(state, deps), {
      action: 'setStatus',
      id: activation.activationId,
      status,
    }, 'GrizzlySMS 更新订单状态');
    return describePayload(payload);
  }

  async function reuseActivation() {
    throw new Error('GrizzlySMS 当前流程不支持复用手机号订单。');
  }

  async function fetchBalance(state = {}, deps = {}) {
    const payload = await fetchPayload(resolveConfig(state, deps), { action: 'getBalance' }, 'GrizzlySMS 查询余额');
    return { balance: Number(describePayload(payload).replace(/^ACCESS_BALANCE:/i, '').trim()), raw: payload };
  }

  function createProvider(deps = {}) {
    const providerDeps = {
      fetchImpl: deps.fetchImpl,
      sleepWithStop: deps.sleepWithStop,
      throwIfStopped: deps.throwIfStopped,
      requestTimeoutMs: deps.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS,
    };
    return {
      id: PROVIDER_ID,
      label: 'GrizzlySMS',
      defaultCountryId: DEFAULT_COUNTRY_ID,
      defaultCountryLabel: DEFAULT_COUNTRY_LABEL,
      defaultProduct: DEFAULT_SERVICE_LABEL,
      normalizeCountryId: normalizeGrizzlySmsCountryId,
      normalizeCountryLabel: normalizeGrizzlySmsCountryLabel,
      normalizeCountryFallback: normalizeGrizzlySmsCountryFallback,
      normalizeMaxPrice: normalizeGrizzlySmsMaxPrice,
      resolveCountryCandidates,
      requestActivation: (state, options) => requestActivation(state, options, providerDeps),
      reuseActivation: (state, activation) => reuseActivation(state, activation, providerDeps),
      finishActivation: (state, activation) => setActivationStatus(state, activation, 6, providerDeps),
      cancelActivation: (state, activation) => setActivationStatus(state, activation, 8, providerDeps),
      banActivation: (state, activation) => setActivationStatus(state, activation, 8, providerDeps),
      pollActivationCode: (state, activation, options) => pollActivationCode(state, activation, options, providerDeps),
      fetchBalance: (state) => fetchBalance(state, providerDeps),
      describePayload,
    };
  }

  return {
    PROVIDER_ID,
    DEFAULT_BASE_URL,
    DEFAULT_COUNTRY_ID,
    DEFAULT_COUNTRY_LABEL,
    DEFAULT_SERVICE_CODE,
    DEFAULT_SERVICE_LABEL,
    createProvider,
    normalizeGrizzlySmsCountryFallback,
    normalizeGrizzlySmsCountryId,
    normalizeGrizzlySmsCountryLabel,
    normalizeGrizzlySmsMaxPrice,
    normalizeGrizzlySmsServiceCode,
  };
});
