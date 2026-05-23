(function attachBackgroundPlusSuccessSessionUpload(root, factory) {
  root.MultiPageBackgroundPlusSuccessSessionUpload = factory();
})(typeof self !== 'undefined' ? self : globalThis, function createBackgroundPlusSuccessSessionUploadModule() {
  const PAY_OPENAI_CHECKOUT_URL_PATTERN = /^https:\/\/pay\.openai\.com\/c\/pay(?:\/|$)/i;
  const PAYMENTS_SUCCESS_URL_PATTERN = /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)\/(?:backend-api\/)?payments\/success(?:[/?#]|$)/i;
  const CHATGPT_REFRESH_URL = 'https://chatgpt.com/';
  const PAY_OPENAI_EARLY_CLOSE_REFRESH_COUNT = 3;
  const PAY_OPENAI_EARLY_CLOSE_REFRESH_INTERVAL_MS = 1500;

  function createPlusSuccessSessionUploadManager(deps = {}) {
    const {
      addLog: rawAddLog = async () => {},
      chrome = null,
      completeNodeFromBackground = null,
      failNodeFromBackground = null,
      getState = async () => ({}),
      setState = async () => {},
      delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0))),
    } = deps;

    const activeTabIds = new Set();
    const activePayOpenAiCloseTabIds = new Set();

    function addLog(message, level = 'info', options = {}) {
      return rawAddLog(message, level, {
        step: 6,
        stepKey: 'plus-checkout-create',
        ...(options && typeof options === 'object' ? options : {}),
      });
    }

    function normalizeString(value = '') {
      return String(value || '').trim();
    }

    function isPaymentsSuccessUrl(url = '') {
      return PAYMENTS_SUCCESS_URL_PATTERN.test(String(url || ''));
    }

    function isPayOpenAiCheckoutUrl(url = '') {
      return PAY_OPENAI_CHECKOUT_URL_PATTERN.test(String(url || ''));
    }

    function normalizeOauthDelaySeconds(value = 0) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        return 0;
      }
      return Math.min(3600, Math.max(0, Math.floor(numeric)));
    }

    function isHostedCheckoutSuccessWaitActive(state = {}, tabId = null) {
      if (normalizeString(state?.plusPaymentMethod).toLowerCase() !== 'paypal') {
        return false;
      }
      if (state?.plusHostedCheckoutIsFinalStep === false) {
        return false;
      }
      const nodeStatus = normalizeString(state?.nodeStatuses?.['plus-checkout-create']).toLowerCase();
      if (nodeStatus && nodeStatus !== 'running' && nodeStatus !== 'pending') {
        return false;
      }
      const checkoutTabId = Number(state?.plusCheckoutTabId);
      if (!Number.isInteger(checkoutTabId) || checkoutTabId <= 0) {
        return false;
      }
      return tabId === null || checkoutTabId === Number(tabId);
    }

    function hasChromeTabsApi() {
      return Boolean(chrome?.tabs?.get && chrome?.tabs?.query && chrome?.tabs?.create && chrome?.tabs?.reload);
    }

    async function findOrCreateChatGptTab() {
      if (!hasChromeTabsApi()) {
        return null;
      }
      const tabs = await chrome.tabs.query({}).catch(() => []);
      const existing = (Array.isArray(tabs) ? tabs : [])
        .find((tab) => Number.isInteger(tab?.id) && /^https:\/\/(?:chatgpt\.com|www\.chatgpt\.com|chat\.openai\.com)(?:\/|$)/i.test(normalizeString(tab?.url)));
      if (existing?.id) {
        await chrome.tabs.update(existing.id, { active: true }).catch(() => {});
        return existing.id;
      }
      const created = await chrome.tabs.create({ url: CHATGPT_REFRESH_URL, active: true }).catch(() => null);
      return Number.isInteger(created?.id) ? created.id : null;
    }

    async function refreshChatGptTabSeveralTimes() {
      const chatGptTabId = await findOrCreateChatGptTab();
      if (!Number.isInteger(chatGptTabId) || chatGptTabId <= 0 || !chrome?.tabs?.reload) {
        await addLog('步骤 6：未能自动定位 ChatGPT 网页标签，请手动打开 chatgpt.com 并刷新几次确认 Plus 状态。', 'warn');
        return 0;
      }

      let refreshCount = 0;
      for (let index = 0; index < PAY_OPENAI_EARLY_CLOSE_REFRESH_COUNT; index += 1) {
        await delay(index === 0 ? 500 : PAY_OPENAI_EARLY_CLOSE_REFRESH_INTERVAL_MS);
        await chrome.tabs.reload(chatGptTabId).catch(() => {});
        refreshCount += 1;
      }
      return refreshCount;
    }

    async function processPayOpenAiEarlyCloseTab(tabId, payOpenAiUrl = '') {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || activePayOpenAiCloseTabIds.has(numericTabId)) {
        return null;
      }

      const initialState = await getState();
      if (!isHostedCheckoutSuccessWaitActive(initialState, numericTabId)) {
        return null;
      }

      activePayOpenAiCloseTabIds.add(numericTabId);
      try {
        const latestState = await getState();
        if (!isHostedCheckoutSuccessWaitActive(latestState, numericTabId)) {
          return null;
        }

        const normalizedPayOpenAiUrl = normalizeString(payOpenAiUrl);
        await setState({
          plusReturnUrl: normalizedPayOpenAiUrl,
          plusPayOpenAiEarlyCloseApplied: true,
        });
        await addLog('步骤 6：检测到已跳转 pay.openai.com 支付确认页，按经验策略立即关闭该页面，避免等待绿色订阅成功页。', 'warn');

        if (chrome?.tabs?.remove) {
          await chrome.tabs.remove(numericTabId).catch(() => {});
        } else {
          await addLog('步骤 6：当前浏览器不支持自动关闭标签页，请手动关闭 pay.openai.com 页面。', 'warn');
        }

        const refreshCount = await refreshChatGptTabSeveralTimes();
        if (refreshCount > 0) {
          await addLog(`步骤 6：已回到 ChatGPT 网页并自动刷新 ${refreshCount} 次，准备继续后续导出 / OAuth 流程。`, 'ok');
        }

        if (typeof completeNodeFromBackground === 'function') {
          await completeNodeFromBackground('plus-checkout-create', {
            plusReturnUrl: normalizedPayOpenAiUrl,
            plusHostedCheckoutCompleted: true,
            plusPayOpenAiEarlyCloseApplied: true,
            plusPayOpenAiRefreshCount: refreshCount,
          });
        }

        return {
          completed: true,
          plusReturnUrl: normalizedPayOpenAiUrl,
          earlyClosedPayOpenAi: true,
          refreshCount,
        };
      } catch (error) {
        const message = normalizeString(error?.message) || 'unknown error';
        await addLog(`pay.openai.com 提前关闭策略执行失败：${message}`, 'error');
        if (typeof failNodeFromBackground === 'function') {
          await failNodeFromBackground('plus-checkout-create', message);
          return {
            completed: false,
            failed: true,
            message,
          };
        }
        throw error;
      } finally {
        activePayOpenAiCloseTabIds.delete(numericTabId);
      }
    }

    async function processPaymentsSuccessTab(tabId, successUrl = '') {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || activeTabIds.has(numericTabId)) {
        return null;
      }

      const initialState = await getState();
      if (!isHostedCheckoutSuccessWaitActive(initialState, numericTabId)) {
        return null;
      }

      activeTabIds.add(numericTabId);
      try {
        const latestState = await getState();
        if (!isHostedCheckoutSuccessWaitActive(latestState, numericTabId)) {
          return null;
        }

        const normalizedSuccessUrl = normalizeString(successUrl);
        await setState({
          plusReturnUrl: normalizedSuccessUrl,
        });
        await addLog('步骤 6：检测到 ChatGPT 支付成功页，准备继续 OAuth 流程。', 'ok');

        const oauthDelaySeconds = normalizeOauthDelaySeconds(latestState?.plusHostedCheckoutOauthDelaySeconds);
        if (oauthDelaySeconds > 0) {
          await addLog(`步骤 6：已按设置等待 ${oauthDelaySeconds} 秒，之后再进入 OAuth 登录。`, 'info');
          await delay(oauthDelaySeconds * 1000);
          const delayedState = await getState();
          if (!isHostedCheckoutSuccessWaitActive(delayedState, numericTabId)) {
            return null;
          }
        }

        if (typeof completeNodeFromBackground === 'function') {
          await completeNodeFromBackground('plus-checkout-create', {
            plusReturnUrl: normalizedSuccessUrl,
            plusHostedCheckoutCompleted: true,
            plusHostedCheckoutOauthDelaySeconds: oauthDelaySeconds,
          });
        }

        return {
          completed: true,
          plusReturnUrl: normalizedSuccessUrl,
          oauthDelaySeconds,
        };
      } catch (error) {
        const message = normalizeString(error?.message) || 'unknown error';
        await addLog(`支付成功页收尾失败：${message}`, 'error');
        if (typeof failNodeFromBackground === 'function') {
          await failNodeFromBackground('plus-checkout-create', message);
          return {
            completed: false,
            failed: true,
            message,
          };
        }
        throw error;
      } finally {
        activeTabIds.delete(numericTabId);
      }
    }

    async function handleTabUpdated(tabId, changeInfo = {}, tab = {}) {
      const nextUrl = normalizeString(changeInfo?.url || tab?.url);
      if (isPayOpenAiCheckoutUrl(nextUrl)) {
        return processPayOpenAiEarlyCloseTab(Number(tabId), nextUrl);
      }
      if (changeInfo?.status !== 'complete') {
        return null;
      }
      if (!isPaymentsSuccessUrl(nextUrl)) {
        return null;
      }
      return processPaymentsSuccessTab(Number(tabId), nextUrl);
    }

    return {
      isPayOpenAiCheckoutUrl,
      isPaymentsSuccessUrl,
      isHostedCheckoutSuccessWaitActive,
      processPayOpenAiEarlyCloseTab,
      processPaymentsSuccessTab,
      handleTabUpdated,
    };
  }

  return {
    createPlusSuccessSessionUploadManager,
  };
});
