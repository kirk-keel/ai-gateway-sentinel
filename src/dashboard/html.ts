export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Gateway Sentinel — Enterprise Management Console</title>
  <style>
    :root {
      --bg: #090d16;
      --surface: #111827;
      --surface-border: #1f2937;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font);
      line-height: 1.5;
      padding: 24px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--surface-border);
      margin-bottom: 24px;
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: -0.5px;
    }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-status::before {
      content: "";
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
      box-shadow: 0 0 8px var(--success);
    }
    .tabs {
      display: flex;
      gap: 8px;
      margin-bottom: 24px;
      border-bottom: 1px solid var(--surface-border);
      padding-bottom: 12px;
    }
    .tab-btn {
      background: none;
      border: none;
      color: var(--text-muted);
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
    }
    .tab-btn.active {
      color: #fff;
      background: var(--primary);
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--surface-border);
      border-radius: 10px;
      padding: 20px;
    }
    .card-title {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .card-value {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
    }
    .card-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .panel {
      display: none;
    }
    .panel.active {
      display: block;
    }
    .playground-container {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    @media (max-width: 900px) {
      .playground-container { grid-template-columns: 1fr; }
    }
    textarea {
      width: 100%;
      height: 180px;
      background: #0d131f;
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      color: var(--text);
      padding: 12px;
      font-family: inherit;
      font-size: 14px;
      resize: vertical;
      margin-bottom: 12px;
    }
    textarea:focus {
      outline: none;
      border-color: var(--primary);
    }
    .btn {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn:hover { background: var(--primary-hover); }
    .result-box {
      background: #0d131f;
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 16px;
      font-family: monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
      min-height: 180px;
      max-height: 400px;
      overflow-y: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 14px;
    }
    th, td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--surface-border);
    }
    th {
      color: var(--text-muted);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.02);
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
    }
    .pill-green { background: rgba(16, 185, 129, 0.2); color: var(--success); }
    .pill-yellow { background: rgba(245, 158, 11, 0.2); color: var(--warning); }
    .pill-red { background: rgba(239, 68, 68, 0.2); color: var(--danger); }
    .pill-blue { background: rgba(59, 130, 246, 0.2); color: var(--primary); }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-title">
      <span>🛡️</span>
      <span>AI Gateway Sentinel</span>
      <span class="badge-status" id="system-status">Healthy</span>
    </div>
    <div>
      <a href="/metrics" target="_blank" class="btn" style="background:#1f2937; text-decoration:none;">Prometheus /metrics</a>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab-btn active" onclick="switchTab('overview')">Overview & FinOps</button>
    <button class="tab-btn" onclick="switchTab('playground')">Guardrails Playground</button>
    <button class="tab-btn" onclick="switchTab('providers')">Providers & Circuits</button>
    <button class="tab-btn" onclick="switchTab('keys')">API Keys & RBAC</button>
    <button class="tab-btn" onclick="switchTab('alerts')">Security Incidents</button>
  </nav>

  <!-- OVERVIEW TAB -->
  <main id="tab-overview" class="panel active">
    <div class="stats-grid">
      <div class="card">
        <div class="card-title">Gateway Version</div>
        <div class="card-value" id="stat-version">v1.2.0</div>
        <div class="card-sub">Enterprise Edition</div>
      </div>
      <div class="card">
        <div class="card-title">Token Vault & Guardrails</div>
        <div class="card-value" style="color:var(--success);">Active</div>
        <div class="card-sub">Reversible Anonymization Enabled</div>
      </div>
      <div class="card">
        <div class="card-title">Intelligent Router</div>
        <div class="card-value" style="color:var(--primary);">sentinel-auto</div>
        <div class="card-sub">Dynamic Cost Tiering</div>
      </div>
      <div class="card">
        <div class="card-title">Daily Budget Status</div>
        <div class="card-value" id="stat-budget">Enforced</div>
        <div class="card-sub" id="stat-budget-sub">Soft Warning at 80%</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">Active Enterprise Models</h3>
      <table id="models-table">
        <thead>
          <tr>
            <th>Model ID</th>
            <th>Type</th>
            <th>Provider / Owner</th>
          </tr>
        </thead>
        <tbody id="models-tbody">
          <tr><td colspan="3">Loading models catalog...</td></tr>
        </tbody>
      </table>
    </div>
  </main>

  <!-- PLAYGROUND TAB -->
  <main id="tab-playground" class="panel">
    <div class="playground-container">
      <div class="card">
        <h3 style="margin-bottom:12px;">Prompt Inspection Input</h3>
        <textarea id="prompt-input" placeholder="Enter an engineering prompt containing confidential well coordinates, API numbers, or adversarial instructions to test the security guardrails..."></textarea>
        <button class="btn" onclick="runGuardrailTest()">Run Inspection Pass</button>
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px;">Sentinel Inspection Report</h3>
        <div class="result-box" id="playground-result">Click 'Run Inspection Pass' to test the prompt against prompt injection and sensitive operational PII guardrails.</div>
      </div>
    </div>
  </main>

  <!-- PROVIDERS TAB -->
  <main id="tab-providers" class="panel">
    <div class="card">
      <h3 style="margin-bottom:12px;">Upstream LLM Providers & Circuit Breakers</h3>
      <table>
        <thead>
          <tr>
            <th>Provider Target</th>
            <th>Target URL</th>
            <th>Priority</th>
            <th>Circuit State</th>
            <th>Failures</th>
            <th>Last Status</th>
          </tr>
        </thead>
        <tbody id="providers-tbody">
          <tr><td colspan="6">Loading providers status...</td></tr>
        </tbody>
      </table>
    </div>
  </main>

  <!-- API KEYS TAB -->
  <main id="tab-keys" class="panel">
    <div class="card" style="margin-bottom: 20px;">
      <h3 style="margin-bottom:12px;">Create Scoped API Key</h3>
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <input type="text" id="new-key-name" placeholder="Application / Service Name" style="background:#0d131f; border:1px solid var(--surface-border); border-radius:6px; color:#fff; padding:8px 12px; flex:1; min-width:200px;">
        <input type="text" id="new-key-tenant" placeholder="Tenant / Dept (e.g. drilling)" style="background:#0d131f; border:1px solid var(--surface-border); border-radius:6px; color:#fff; padding:8px 12px; flex:1; min-width:200px;">
        <button class="btn" onclick="createKey()">Generate Key</button>
      </div>
      <div id="key-created-alert" style="display:none; padding:12px; background:rgba(16,185,129,0.15); border:1px solid var(--success); border-radius:6px; color:var(--success); font-family:monospace;"></div>
    </div>

    <div class="card">
      <h3 style="margin-bottom:12px;">Registered API Keys</h3>
      <table>
        <thead>
          <tr>
            <th>Key ID</th>
            <th>Name</th>
            <th>Prefix</th>
            <th>Tenant</th>
            <th>Allowed Models</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody id="keys-tbody">
          <tr><td colspan="7">Loading registered keys...</td></tr>
        </tbody>
      </table>
    </div>
  </main>

  <!-- ALERTS TAB -->
  <main id="tab-alerts" class="panel">
    <div class="card">
      <h3 style="margin-bottom:12px;">Recent Security & Compliance Incidents</h3>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Severity</th>
            <th>Event Type</th>
            <th>Tenant</th>
            <th>Incident Title</th>
          </tr>
        </thead>
        <tbody id="alerts-tbody">
          <tr><td colspan="5">Loading security incidents log...</td></tr>
        </tbody>
      </table>
    </div>
  </main>

  <script>
    function switchTab(name) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const activeBtn = Array.from(document.querySelectorAll('.tab-btn')).find(b => b.getAttribute('onclick').includes(name));
      if (activeBtn) activeBtn.classList.add('active');
      const activePanel = document.getElementById('tab-' + name);
      if (activePanel) activePanel.classList.add('active');

      if (name === 'overview') loadOverview();
      if (name === 'providers') loadProviders();
      if (name === 'keys') loadKeys();
      if (name === 'alerts') loadAlerts();
    }

    async function loadOverview() {
      try {
        const res = await fetch('/v1/models');
        const data = await res.json();
        const tbody = document.getElementById('models-tbody');
        tbody.innerHTML = (data.data || []).map(m => \`
          <tr>
            <td><strong>\${m.id}</strong></td>
            <td><span class="pill pill-blue">\${m.id.startsWith('sentinel') ? 'Virtual Route' : 'Foundation LLM'}</span></td>
            <td>\${m.owned_by}</td>
          </tr>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadProviders() {
      try {
        const res = await fetch('/v1/providers');
        const data = await res.json();
        const tbody = document.getElementById('providers-tbody');
        tbody.innerHTML = (data.data || []).map(p => {
          const pillClass = p.circuitState === 'CLOSED' ? 'pill-green' : p.circuitState === 'HALF_OPEN' ? 'pill-yellow' : 'pill-red';
          return \`
            <tr>
              <td><strong>\${p.name}</strong> (\${p.id})</td>
              <td style="font-family:monospace;">\${p.url}</td>
              <td>Priority \${p.priority}</td>
              <td><span class="pill \${pillClass}">\${p.circuitState}</span></td>
              <td>\${p.consecutiveFailures}</td>
              <td style="color:var(--text-muted); font-size:12px;">\${p.lastSuccessTime ? 'Online' : 'Pending'}</td>
            </tr>
          \`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadKeys() {
      try {
        const res = await fetch('/v1/keys');
        const data = await res.json();
        const tbody = document.getElementById('keys-tbody');
        tbody.innerHTML = (data.data || []).map(k => {
          const statusPill = k.revoked ? '<span class="pill pill-red">REVOKED</span>' : '<span class="pill pill-green">ACTIVE</span>';
          return \`
            <tr>
              <td style="font-family:monospace;">\${k.id}</td>
              <td>\${k.name}</td>
              <td style="font-family:monospace;">\${k.prefix}...</td>
              <td>\${k.tenant}</td>
              <td><span class="pill pill-blue">\${k.allowedModels.join(', ')}</span></td>
              <td>\${statusPill}</td>
              <td>
                \${k.revoked ? '-' : \`<button class="btn" style="background:var(--danger); padding:4px 8px; font-size:11px;" onclick="revokeKey('\${k.id}')">Revoke</button>\`}
              </td>
            </tr>
          \`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function createKey() {
      const name = document.getElementById('new-key-name').value.trim();
      const tenant = document.getElementById('new-key-tenant').value.trim();
      if (!name || !tenant) {
        alert('Please provide name and tenant');
        return;
      }

      const res = await fetch('/v1/keys', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, tenant, allowedModels: ['*'] })
      });
      const data = await res.json();
      const alertBox = document.getElementById('key-created-alert');
      alertBox.style.display = 'block';
      alertBox.innerHTML = '<strong>Generated API Key:</strong> ' + data.apiKey + '<br><small>Copy this secret now. It will not be shown again.</small>';
      loadKeys();
    }

    async function revokeKey(id) {
      if (!confirm('Are you sure you want to revoke key ' + id + '?')) return;
      await fetch('/v1/keys/' + id, { method: 'DELETE' });
      loadKeys();
    }

    async function loadAlerts() {
      try {
        const res = await fetch('/v1/alerts');
        const data = await res.json();
        const tbody = document.getElementById('alerts-tbody');
        if (!data.data || data.data.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-muted);">No security alerts recorded. Clean operational state.</td></tr>';
          return;
        }

        tbody.innerHTML = data.data.map(a => {
          const pillClass = a.severity === 'CRITICAL' ? 'pill-red' : a.severity === 'HIGH' ? 'pill-yellow' : 'pill-blue';
          return \`
            <tr>
              <td style="font-size:12px; color:var(--text-muted);">\${a.timestamp}</td>
              <td><span class="pill \${pillClass}">\${a.severity}</span></td>
              <td>\${a.eventType}</td>
              <td>\${a.tenant}</td>
              <td><strong>\${a.title}</strong></td>
            </tr>
          \`;
        }).join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function runGuardrailTest() {
      const text = document.getElementById('prompt-input').value.trim();
      const resBox = document.getElementById('playground-result');
      if (!text) {
        resBox.textContent = 'Please enter text in the prompt box.';
        return;
      }

      resBox.textContent = 'Analyzing prompt through Guardrail Pipeline...';
      try {
        const res = await fetch('/v1/guardrails/check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text })
        });
        const data = await res.json();
        resBox.textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        resBox.textContent = 'Error executing guardrail inspection: ' + err.message;
      }
    }

    // Auto-load overview on start
    loadOverview();
  </script>
</body>
</html>`;
}
