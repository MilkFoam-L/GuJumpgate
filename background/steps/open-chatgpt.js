(function attachBackgroundStep1(root, factory) {
  root.MultiPageBackgroundStep1 = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundStep1Module() {
  const STEP1_COOKIE_CLEAR_DOMAINS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'paypal.com',
    'stripe.com',
    'checkout.stripe.com',
    'meiguodizhi.com',
    'mail-api.yuecheng.shop',
    'yuecheng.shop',
  ];
  const STEP1_COOKIE_CLEAR_ORIGINS = [
    'https://chatgpt.com',
    'https://chat.openai.com',
    'https://pay.openai.com',
    'https://auth.openai.com',
    'https://auth0.openai.com',
    'https://accounts.openai.com',
    'https://openai.com',
    'https://www.paypal.com',
    'https://paypal.com',
    'https://checkout.stripe.com',
    'https://www.meiguodizhi.com',
    'https://meiguodizhi.com',
    'https://mail-api.yuecheng.shop',
  ];
  const STEP1_TAB_CLOSE_HOSTS = [
    'chatgpt.com',
    'chat.openai.com',
    'pay.openai.com',
    'openai.com',
    'auth.openai.com',
    'auth0.openai.com',
    'accounts.openai.com',
    'paypal.com',
    'stripe.com',
    'checkout.stripe.com',
  ];
  const STEP1_BROWSING_DATA_TYPES = {
    appcache: true,
    cache: true,
    cacheStorage: true,
    cookies: true,
    fileSystems: true,
    indexedDB: true,
    localStorage: true,
    serviceWorkers: true,
    webSQL: true,
  };

  function normalizeCookieDomainForStep1(domain) {
    return String(domain || '').trim().replace(/^\.+/, '').toLowerCase();
  }

  function shouldClearStep1Cookie(cookie) {
    const domain = normalizeCookieDomainForStep1(cookie?.domain);
    if (!domain) return false;
    return STEP1_COOKIE_CLEAR_DOMAINS.some((target) => (
      domain === target || domain.endsWith(`.${target}`)
    ));
  }

  function buildStep1CookieRemovalUrl(cookie) {
    const host = normalizeCookieDomainForStep1(cookie?.domain);
    const rawPath = String(cookie?.path || '/');
    const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    return `https://${host}${path}`;
  }

  function getStep1ErrorMessage(error) {
    return error?.message || String(error || '未知错误');
  }

  function isStep1ManagedHost(hostname = '') {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host) return false;
    return STEP1_TAB_CLOSE_HOSTS.some((target) => host === target || host.endsWith(`.${target}`));
  }

  function isStep1ManagedUrl(rawUrl = '') {
    try {
      const parsed = new URL(String(rawUrl || ''));
      return /^https?:$/i.test(parsed.protocol) && isStep1ManagedHost(parsed.hostname);
    } catch {
      return false;
    }
  }

  async function collectStep1Cookies(chromeApi) {
    if (!chromeApi.cookies?.getAll) {
      return [];
    }

    const stores = chromeApi.cookies.getAllCookieStores
      ? await chromeApi.cookies.getAllCookieStores()
      : [{ id: undefined }];
    const cookies = [];
    const seen = new Set();

    for (const store of stores) {
      const storeId = store?.id;
      const batch = await chromeApi.cookies.getAll(storeId ? { storeId } : {});
      for (const cookie of batch || []) {
        if (!shouldClearStep1Cookie(cookie)) continue;
        const key = [
          cookie.storeId || storeId || '',
          cookie.domain || '',
          cookie.path || '',
          cookie.name || '',
          cookie.partitionKey ? JSON.stringify(cookie.partitionKey) : '',
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        cookies.push(cookie);
      }
    }

    return cookies;
  }

  async function removeStep1Cookie(chromeApi, cookie) {
    const details = {
      url: buildStep1CookieRemovalUrl(cookie),
      name: cookie.name,
    };
    if (cookie.storeId) {
      details.storeId = cookie.storeId;
    }
    if (cookie.partitionKey) {
      details.partitionKey = cookie.partitionKey;
    }

    try {
      const result = await chromeApi.cookies.remove(details);
      return Boolean(result);
    } catch (error) {
      console.warn('[MultiPage:step1] remove cookie failed', {
        domain: cookie?.domain,
        name: cookie?.name,
        message: getStep1ErrorMessage(error),
      });
      return false;
    }
  }

  async function closeManagedTabsBeforeStep1(chromeApi, addLog) {
    if (!chromeApi?.tabs?.query || !chromeApi.tabs?.remove) {
      await addLog('步骤 1：当前浏览器不支持 tabs API，跳过旧 GPT / 支付网页清理。', 'warn');
      return 0;
    }

    const tabs = await chromeApi.tabs.query({}).catch(() => []);
    const tabIds = (tabs || [])
      .filter((tab) => Number.isInteger(tab?.id) && isStep1ManagedUrl(tab.url || ''))
      .map((tab) => tab.id);

    if (!tabIds.length) {
      await addLog('步骤 1：未检测到需要关闭的旧 GPT / 支付网页。', 'info');
      return 0;
    }

    await addLog(`步骤 1：正在关闭 ${tabIds.length} 个旧 GPT / OpenAI / 支付相关网页...`, 'info');
    await chromeApi.tabs.remove(tabIds).catch((error) => {
      throw new Error(`关闭旧 GPT / 支付网页失败：${getStep1ErrorMessage(error)}`);
    });
    await addLog(`步骤 1：已关闭 ${tabIds.length} 个旧 GPT / OpenAI / 支付相关网页。`, 'ok');
    return tabIds.length;
  }

  async function clearManagedBrowsingDataBeforeStep1(chromeApi, addLog) {
    if (!chromeApi?.browsingData?.remove) {
      await addLog('步骤 1：当前浏览器不支持 browsingData.remove，跳过站点内容数据清理。', 'warn');
      return;
    }

    await addLog('步骤 1：正在清理 ChatGPT / OpenAI 相关站点内容数据（缓存、LocalStorage、IndexedDB、ServiceWorker 等）...', 'info');
    await chromeApi.browsingData.remove(
      {
        since: 0,
        origins: STEP1_COOKIE_CLEAR_ORIGINS,
      },
      STEP1_BROWSING_DATA_TYPES
    ).catch((error) => {
      throw new Error(`清理 ChatGPT / OpenAI 站点内容数据失败：${getStep1ErrorMessage(error)}`);
    });
    await addLog('步骤 1：ChatGPT / OpenAI 相关站点内容数据已清理完成。', 'ok');
  }

  function createStep1Executor(deps = {}) {
    const {
      addLog,
      chrome: chromeApi = globalThis.chrome,
      completeNodeFromBackground,
      openSignupEntryTab,
    } = deps;

    async function clearOpenAiCookiesBeforeStep1() {
      if (!chromeApi?.cookies?.getAll || !chromeApi.cookies?.remove) {
        await addLog('步骤 1：当前浏览器不支持 cookies API，跳过打开官网前 cookie 清理。', 'warn');
        return;
      }

      await addLog('步骤 1：打开 ChatGPT 官网前清理 ChatGPT / OpenAI cookies...', 'info');
      const cookies = await collectStep1Cookies(chromeApi);
      let removedCount = 0;
      for (const cookie of cookies) {
        if (await removeStep1Cookie(chromeApi, cookie)) {
          removedCount += 1;
        }
      }

      if (chromeApi.browsingData?.removeCookies) {
        try {
          await chromeApi.browsingData.removeCookies({
            since: 0,
            origins: STEP1_COOKIE_CLEAR_ORIGINS,
          });
        } catch (error) {
          await addLog(`步骤 1：browsingData 补扫 cookies 失败：${getStep1ErrorMessage(error)}`, 'warn');
        }
      }

      await addLog(`步骤 1：已清理 ${removedCount} 个 ChatGPT / OpenAI cookies。`, 'ok');
    }

    async function executeStep1() {
      await closeManagedTabsBeforeStep1(chromeApi, addLog);
      await clearManagedBrowsingDataBeforeStep1(chromeApi, addLog);
      await clearOpenAiCookiesBeforeStep1();
      await addLog('步骤 1：正在打开 ChatGPT 官网...');
      await openSignupEntryTab(1);
      await completeNodeFromBackground('open-chatgpt', {});
    }

    return { clearOpenAiCookiesBeforeStep1, executeStep1 };
  }

  return { createStep1Executor };
});
