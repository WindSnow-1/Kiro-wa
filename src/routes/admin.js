const { Router } = require('express');
const path = require('path');
const fs = require('fs');
const { getConfig } = require('../config');
const { getCredentialStates, setCredentialDisabled, resetCredential, addCredential } = require('../kiro/provider');
const { getUsageStats } = require('../usage');
const router = Router();

router.use('/api/admin', (req, res, next) => {
  const cfg = getConfig();
  const key = req.headers['x-admin-key'] || req.headers['authorization']?.replace('Bearer ', '');
  if (cfg.adminApiKey && key !== cfg.adminApiKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

router.get('/api/admin/credentials', (req, res) => {
  const states = getCredentialStates();
  res.json(states.map((s, i) => ({
    index: i,
    id: s.credential.id,
    authMethod: s.credential.authMethod || 'social',
    disabled: s.disabled,
    failureCount: s.failureCount,
    lastFailure: s.lastFailure,
    hasToken: !!s.credential.accessToken,
    expiresAt: s.credential.expiresAt,
    profileArn: s.credential.profileArn,
  })));
});

router.post('/api/admin/credentials', async (req, res) => {
  try {
    const state = await addCredential(req.body || {});
    res.status(201).json({
      success: true,
      message: '凭证已添加',
      credentialId: state.credential.id,
      index: state.index,
      email: state.credential.email,
    });
  } catch (err) {
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

router.post('/api/admin/credentials/:index/disabled', (req, res) => {
  const idx = parseInt(req.params.index);
  setCredentialDisabled(idx, req.body.disabled !== false);
  res.json({ ok: true });
});

router.post('/api/admin/credentials/:index/reset', (req, res) => {
  const idx = parseInt(req.params.index);
  resetCredential(idx);
  res.json({ ok: true });
});

router.get('/api/admin/usage', (req, res) => {
  res.json(getUsageStats());
});

router.get('/admin', (req, res) => {
  const adminUiPath = path.join(__dirname, '../../admin-ui/dist/index.html');
  if (fs.existsSync(adminUiPath)) {
    res.sendFile(adminUiPath);
  } else {
    res.send(`<!DOCTYPE html><html><head><title>Kiro Node Admin</title><style>
body{font-family:system-ui;max-width:900px;margin:0 auto;padding:20px;background:#1a1a2e;color:#eee}
h1{color:#0ff}h2{color:#7bf;margin-top:30px}
pre{background:#16213e;padding:15px;border-radius:8px;overflow-x:auto;font-size:13px}
.card{background:#16213e;padding:15px;border-radius:8px;margin:10px 0}
.stat{display:inline-block;margin:0 20px 10px 0}
.stat-val{font-size:24px;font-weight:bold;color:#0ff}
.stat-label{font-size:12px;color:#888}
.quota-ok{color:#4f4}.quota-bad{color:#f44}
button{background:#0ff;color:#000;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;margin:2px}
button:hover{background:#0aa}
</style></head><body>
<h1>Kiro Node Admin</h1>
<div id="stats" class="card"></div>
<h2>Credentials</h2>
<div id="creds"></div>
<h2>Usage by Model</h2>
<pre id="models"></pre>
<h2>Daily Usage</h2>
<pre id="daily"></pre>
<script>
const key=localStorage.getItem('adminKey')||prompt('Admin API Key:');
if(key)localStorage.setItem('adminKey',key);
const h={'x-admin-key':key};
async function load(){
  const[creds,usage]=await Promise.all([
    fetch('/api/admin/credentials',{headers:h}).then(r=>r.json()),
    fetch('/api/admin/usage',{headers:h}).then(r=>r.json())
  ]);
  document.getElementById('stats').innerHTML=\`
    <div class="stat"><div class="stat-val">\${usage.totalRequests}</div><div class="stat-label">Total Requests</div></div>
    <div class="stat"><div class="stat-val">\${(usage.totalInputTokens/1000).toFixed(1)}k</div><div class="stat-label">Input Tokens</div></div>
    <div class="stat"><div class="stat-val">\${(usage.totalOutputTokens/1000).toFixed(1)}k</div><div class="stat-label">Output Tokens</div></div>
    <div class="stat"><div class="stat-val">\${usage.uptimeFormatted}</div><div class="stat-label">Uptime</div></div>
  \`;
  document.getElementById('creds').innerHTML=creds.map((c,i)=>\`<div class="card">
    <b>Credential #\${i}</b> [\${c.authMethod}]
    <span class="\${c.disabled?'quota-bad':'quota-ok'}">\${c.disabled?'DISABLED':'ACTIVE'}</span>
    \${usage.credentials['cred_'+i]?'| Requests: '+usage.credentials['cred_'+i].totalRequests:''}
    \${usage.credentials['cred_'+i]&&usage.credentials['cred_'+i].quotaExhausted?'<span class="quota-bad">QUOTA EXHAUSTED</span>':''}
    <br>Token expires: \${c.expiresAt||'N/A'}
    <br><button onclick="resetCred(\${i})">Reset</button>
    <button onclick="toggleCred(\${i},\${!c.disabled})">\${c.disabled?'Enable':'Disable'}</button>
  </div>\`).join('');
  let modelText='';
  for(const[k,v]of Object.entries(usage.credentials)){
    for(const[m,s]of Object.entries(v.models||{})){
      modelText+=m.padEnd(30)+' | '+String(s.requests).padStart(5)+' reqs | '+String(s.inputTokens).padStart(8)+' in | '+String(s.outputTokens).padStart(8)+' out\\n';
    }
  }
  document.getElementById('models').textContent=modelText||'No usage yet';
  document.getElementById('daily').textContent=JSON.stringify(usage.daily,null,2)||'{}';
}
async function resetCred(i){await fetch('/api/admin/credentials/'+i+'/reset',{method:'POST',headers:h});load();}
async function toggleCred(i,d){await fetch('/api/admin/credentials/'+i+'/disabled',{method:'POST',headers:{...h,'content-type':'application/json'},body:JSON.stringify({disabled:d})});load();}
load();setInterval(load,10000);
</script></body></html>`);
  }
});

router.use('/admin', (req, res, next) => {
  const adminUiDist = path.join(__dirname, '../../admin-ui/dist');
  if (fs.existsSync(adminUiDist)) {
    require('express').static(adminUiDist)(req, res, next);
  } else {
    next();
  }
});

module.exports = router;
