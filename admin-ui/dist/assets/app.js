const state = {
  adminKey: localStorage.getItem('kiroAdminKey') || '',
  credentials: [],
  usage: null,
  filter: 'all',
  modelSearch: '',
  timer: null,
};

const $ = (id) => document.getElementById(id);
const fmt = new Intl.NumberFormat('zh-CN');

function compact(value) {
  const num = Number(value || 0);
  if (num >= 100_000_000) return `${(num / 100_000_000).toFixed(1)}亿`;
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)}万`;
  return fmt.format(num);
}

function mask(value) {
  if (!value) return '无';
  if (value.length <= 14) return value;
  return `${value.slice(0, 10)}...${value.slice(-6)}`;
}

function timeText(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN');
}

function uptimeText(usage = {}) {
  const seconds = Number(usage.uptime);
  if (!Number.isFinite(seconds)) return usage.uptimeFormatted || '--';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时 ${m}分钟`;
  if (h > 0) return `${h}小时 ${m}分钟`;
  return `${m}分钟`;
}

function authText(value) {
  if (!value) return '社交登录';
  const map = {
    social: '社交登录',
    oauth: 'OAuth',
    bearer: 'Bearer 令牌',
    apiKey: 'API 密钥',
    api_key: 'API 密钥',
  };
  return map[value] || value;
}

function headers(extra = {}) {
  return { 'x-admin-key': state.adminKey, ...extra };
}

function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(el._timer);
  el._timer = window.setTimeout(() => el.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: headers(options.headers || {}),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const parsed = JSON.parse(text);
      message = parsed.error || parsed.message || text;
    } catch {}
    throw new Error(message || `HTTP ${response.status}`);
  }
  return response.json();
}

async function loadData({ silent = false } = {}) {
  if (!state.adminKey) return showAuth();
  try {
    const [credentials, usage] = await Promise.all([
      api('/api/admin/credentials'),
      api('/api/admin/usage'),
    ]);
    state.credentials = Array.isArray(credentials) ? credentials : [];
    state.usage = usage || {};
    localStorage.setItem('kiroAdminKey', state.adminKey);
    hideAuth();
    render();
    if (!silent) toast('控制台已刷新');
  } catch (error) {
    $('authError').textContent = '管理密钥不正确';
    showAuth();
    if (!silent) toast('无法加载管理数据');
  }
}

function showAuth() {
  $('authOverlay').classList.remove('hidden');
  $('adminKey').value = state.adminKey;
  window.setTimeout(() => $('adminKey').focus(), 50);
}

function hideAuth() {
  $('authOverlay').classList.add('hidden');
  $('authError').textContent = '';
}

function health() {
  const total = state.credentials.length;
  const active = state.credentials.filter((item) => !item.disabled).length;
  const exhausted = Object.values(state.usage?.credentials || {}).filter((item) => item.quotaExhausted).length;
  const score = total ? Math.max(0, Math.round(((active - exhausted) / total) * 100)) : 0;
  return { total, active, exhausted, score };
}

function render() {
  renderStatus();
  renderMetrics();
  renderCredentials();
  renderDaily();
  renderModels();
  renderQuota();
}

function renderUrls() {
  const origin = window.location.origin;
  const urls = {
    baseUrl: origin,
    messagesUrl: `${origin}/v1/messages`,
    claudeCodeUrl: `${origin}/cc/v1/messages`,
    adminUrl: `${origin}/admin`,
  };

  for (const [id, value] of Object.entries(urls)) {
    const el = $(id);
    if (!el) continue;
    el.textContent = value;
    el.title = value;
  }
}

function renderStatus() {
  const h = health();
  const online = h.active > 0;
  document.querySelector('.pulse').classList.toggle('online', online);
  $('serviceState').textContent = online ? '运行中' : '需要处理';
  $('heroTitle').textContent = online ? `${h.active} 个可用凭证` : '没有可用凭证';
  $('heroSubtext').textContent = h.exhausted
    ? `${h.exhausted} 个凭证已标记为配额耗尽。`
    : '流量、Token 用量和凭证状态正在从代理服务实时更新。';
  $('healthScore').textContent = `${h.score}%`;
  $('healthRing').style.setProperty('--p', `${h.score}%`);
  $('healthDetail').textContent = `${h.active}/${h.total || 0} 可用`;
}

function renderMetrics() {
  const usage = state.usage || {};
  $('totalRequests').textContent = compact(usage.totalRequests);
  $('inputTokens').textContent = compact(usage.totalInputTokens);
  $('outputTokens').textContent = compact(usage.totalOutputTokens);
  $('uptime').textContent = uptimeText(usage);
}

function renderCredentials() {
  const list = $('credentialList');
  const credentials = state.credentials.filter((item) => {
    if (state.filter === 'active') return !item.disabled;
    if (state.filter === 'disabled') return item.disabled;
    return true;
  });

  if (!credentials.length) {
    list.innerHTML = '<div class="empty">当前视图没有匹配的凭证</div>';
    return;
  }

  list.innerHTML = credentials.map((item) => {
    const usage = state.usage?.credentials?.[`cred_${item.index}`] || {};
    const disabled = Boolean(item.disabled);
    const statusClass = disabled ? 'disabled' : 'active';
    const statusText = disabled ? '已停用' : '可用';
    const auth = authText(item.authMethod);
    return `
      <article class="credential-card">
        <div>
          <div class="credential-title">
            <span>凭证 #${item.index}</span>
            <span class="badge ${statusClass}">${statusText}</span>
            <span class="badge neutral">${auth}</span>
          </div>
          <div class="meta-grid">
            <div class="meta-item"><div class="meta-label">请求数</div><div class="meta-value">${compact(usage.totalRequests)}</div></div>
            <div class="meta-item"><div class="meta-label">失败次数</div><div class="meta-value">${compact(item.failureCount)}</div></div>
            <div class="meta-item"><div class="meta-label">Token 过期</div><div class="meta-value">${timeText(item.expiresAt)}</div></div>
            <div class="meta-item"><div class="meta-label">输入 Token</div><div class="meta-value">${compact(usage.totalInputTokens)}</div></div>
            <div class="meta-item"><div class="meta-label">输出 Token</div><div class="meta-value">${compact(usage.totalOutputTokens)}</div></div>
            <div class="meta-item"><div class="meta-label">档案 ARN</div><div class="meta-value">${mask(item.profileArn)}</div></div>
          </div>
        </div>
        <div class="credential-actions">
          <button class="action-button" data-action="reset" data-index="${item.index}">
            <svg viewBox="0 0 24 24"><path d="M17.7 6.3A8 8 0 1 0 20 12h-2.5a5.5 5.5 0 1 1-1.6-3.9L13 11h8V3l-3.3 3.3Z"/></svg>
            重置
          </button>
          <button class="action-button ${disabled ? '' : 'danger'}" data-action="toggle" data-index="${item.index}" data-disabled="${!disabled}">
            <svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3a7 7 0 0 1 5.3 11.6L7.4 6.7A7 7 0 0 1 12 5ZM5 12c0-1.3.4-2.5 1-3.5l9.5 9.5A7 7 0 0 1 5 12Z"/></svg>
            ${disabled ? '启用' : '停用'}
          </button>
        </div>
      </article>
    `;
  }).join('');
}

function dailyRows() {
  const entries = Object.entries(state.usage?.daily || {}).sort(([a], [b]) => a.localeCompare(b)).slice(-9);
  const max = Math.max(1, ...entries.map(([, item]) => item.requests || 0));
  return entries.map(([day, item]) => ({ day, item, pct: Math.max(4, ((item.requests || 0) / max) * 100) }));
}

function renderDaily() {
  const rows = dailyRows();
  $('dailyChart').innerHTML = rows.length
    ? rows.map(({ day, item, pct }) => `
      <div class="day-row">
        <strong>${day.slice(5)}</strong>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <span>${compact(item.requests)}</span>
      </div>
    `).join('')
    : '<div class="empty">暂无每日流量</div>';
}

function modelRows() {
  const merged = new Map();
  for (const cred of Object.values(state.usage?.credentials || {})) {
    for (const [model, data] of Object.entries(cred.models || {})) {
      const current = merged.get(model) || { model, requests: 0, inputTokens: 0, outputTokens: 0 };
      current.requests += data.requests || 0;
      current.inputTokens += data.inputTokens || 0;
      current.outputTokens += data.outputTokens || 0;
      merged.set(model, current);
    }
  }
  return [...merged.values()]
    .filter((item) => item.model.toLowerCase().includes(state.modelSearch.toLowerCase()))
    .sort((a, b) => b.requests - a.requests);
}

function renderModels() {
  const rows = modelRows();
  const total = Math.max(1, rows.reduce((sum, item) => sum + item.requests, 0));
  $('modelTable').innerHTML = rows.length
    ? rows.map((item) => {
      const share = Math.round((item.requests / total) * 100);
      return `
        <tr>
          <td><strong>${item.model}</strong></td>
          <td>${compact(item.requests)}</td>
          <td>${compact(item.inputTokens)}</td>
          <td>${compact(item.outputTokens)}</td>
          <td><div class="share-track"><span style="width:${Math.max(3, share)}%"></span></div></td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="5"><div class="empty">暂无模型用量</div></td></tr>';
}

function renderQuota() {
  const items = Object.entries(state.usage?.credentials || {}).filter(([, item]) => item.quotaExhausted);
  $('quotaList').innerHTML = items.length
    ? items.map(([key, item]) => `
      <div class="quota-item">
        <strong>${key.replace('cred_', '凭证 #')}</strong>
        <span>配额耗尽时间：${timeText(item.quotaExhaustedAt)}</span>
      </div>
    `).join('')
    : '<div class="empty">暂无配额告警</div>';
}

async function handleCredentialAction(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const index = button.dataset.index;
  const action = button.dataset.action;
  try {
    if (action === 'reset') {
      await api(`/api/admin/credentials/${index}/reset`, { method: 'POST' });
      toast(`凭证 #${index} 已重置`);
    } else {
      await api(`/api/admin/credentials/${index}/disabled`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ disabled: button.dataset.disabled === 'true' }),
      });
      toast(`凭证 #${index} 状态已更新`);
    }
    await loadData({ silent: true });
  } catch {
    toast('操作失败');
  }
}

function fieldValue(id) {
  return ($(id)?.value || '').trim();
}

function setCredentialFormBusy(busy) {
  const submit = $('submitCredentialButton');
  submit.disabled = busy;
  submit.textContent = busy ? '添加中...' : '添加';
}

function toggleCredentialFields() {
  const method = fieldValue('credentialAuthMethod');
  $('refreshTokenField').classList.toggle('hidden', method === 'api_key');
  $('apiKeyField').classList.toggle('hidden', method !== 'api_key');
  $('idcFields').classList.toggle('hidden', method !== 'idc');
}

function resetCredentialForm() {
  $('credentialForm').reset();
  $('credentialPriority').value = '0';
  $('credentialError').textContent = '';
  toggleCredentialFields();
  setCredentialFormBusy(false);
}

function openCredentialModal() {
  resetCredentialForm();
  $('credentialModal').classList.remove('hidden');
  window.setTimeout(() => $('credentialAuthMethod').focus(), 30);
}

function closeCredentialModal() {
  $('credentialModal').classList.add('hidden');
  resetCredentialForm();
}

function optionalField(body, id, key) {
  const value = fieldValue(id);
  if (value) body[key] = value;
}

function credentialPayload() {
  const authMethod = fieldValue('credentialAuthMethod');
  const body = { authMethod };

  if (authMethod === 'api_key') {
    const kiroApiKey = fieldValue('credentialApiKey');
    if (!kiroApiKey) throw new Error('请输入 Kiro API Key');
    body.kiroApiKey = kiroApiKey;
  } else {
    const refreshToken = fieldValue('credentialRefreshToken');
    if (!refreshToken) throw new Error('请输入 Refresh Token');
    body.refreshToken = refreshToken;
    if (authMethod === 'idc') {
      const clientId = fieldValue('credentialClientId');
      const clientSecret = fieldValue('credentialClientSecret');
      if (!clientId || !clientSecret) throw new Error('IdC 需要 Client ID 和 Client Secret');
      body.clientId = clientId;
      body.clientSecret = clientSecret;
    }
  }

  optionalField(body, 'credentialAuthRegion', 'authRegion');
  optionalField(body, 'credentialApiRegion', 'apiRegion');
  optionalField(body, 'credentialMachineId', 'machineId');
  optionalField(body, 'credentialEndpoint', 'endpoint');
  optionalField(body, 'credentialProxyUrl', 'proxyUrl');
  optionalField(body, 'credentialProxyUsername', 'proxyUsername');
  optionalField(body, 'credentialProxyPassword', 'proxyPassword');

  const priority = Number(fieldValue('credentialPriority') || 0);
  body.priority = Number.isFinite(priority) ? priority : 0;
  return body;
}

async function handleCredentialSubmit(event) {
  event.preventDefault();
  $('credentialError').textContent = '';
  try {
    const body = credentialPayload();
    setCredentialFormBusy(true);
    const result = await api('/api/admin/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    closeCredentialModal();
    toast(result.message || '凭证已添加');
    await loadData({ silent: true });
  } catch (error) {
    $('credentialError').textContent = error.message || '添加失败';
    setCredentialFormBusy(false);
  }
}

async function copyText(text) {
  if (!text || text === '--') return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    input.remove();
  }
  toast('已复制 URL');
}

function setActiveNav() {
  const hash = window.location.hash || '#overview';
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('href') === hash);
  });
}

function bind() {
  renderUrls();
  setActiveNav();
  window.addEventListener('hashchange', setActiveNav);
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => window.setTimeout(setActiveNav, 0));
  });

  $('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.adminKey = $('adminKey').value.trim();
    await loadData({ silent: true });
  });

  $('showKey').addEventListener('click', () => {
    const input = $('adminKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  $('refreshButton').addEventListener('click', () => loadData());
  $('lockButton').addEventListener('click', () => {
    localStorage.removeItem('kiroAdminKey');
    state.adminKey = '';
    showAuth();
  });

  $('addCredentialButton').addEventListener('click', openCredentialModal);
  $('closeCredentialModal').addEventListener('click', closeCredentialModal);
  $('cancelCredentialButton').addEventListener('click', closeCredentialModal);
  $('credentialAuthMethod').addEventListener('change', toggleCredentialFields);
  $('credentialForm').addEventListener('submit', handleCredentialSubmit);
  $('credentialModal').addEventListener('click', (event) => {
    if (event.target === $('credentialModal')) closeCredentialModal();
  });

  $('credentialList').addEventListener('click', handleCredentialAction);
  document.querySelectorAll('.copy-url').forEach((button) => {
    button.addEventListener('click', () => {
      const target = $(button.dataset.copyTarget);
      copyText(target?.textContent || '');
    });
  });

  document.querySelectorAll('.segment').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.segment').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.filter = button.dataset.filter;
      renderCredentials();
    });
  });

  $('modelSearch').addEventListener('input', (event) => {
    state.modelSearch = event.target.value;
    renderModels();
  });
}

bind();
if (state.adminKey) {
  loadData({ silent: true });
} else {
  showAuth();
}
state.timer = window.setInterval(() => loadData({ silent: true }), 10000);
