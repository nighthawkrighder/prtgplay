(function () {
  const grid = document.getElementById('grid');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  const VIEWER_URLS = {
    companyDeviceHealthGraph: '/reports/company-device-health-graph',
    alertsTrend:              '/reports/alerts-trend?hours=24&bucketMinutes=60',
    slaUptime:                '/reports/sla-uptime',
    flappingDevices:          '/reports/flapping-devices',
    sensorTypeDistribution:   '/reports/sensor-type-distribution',
    alertAckLatency:          '/reports/alert-ack-latency'
  };

  const JSON_URLS = {
    companyDeviceHealthGraph: '/api/reports/company-device-health-graph',
    alertsTrend:              '/api/reports/alerts-trend?hours=24&bucketMinutes=60',
    slaUptime:                '/api/reports/sla-uptime?hours=720',
    flappingDevices:          '/api/reports/flapping-devices?hours=24',
    sensorTypeDistribution:   '/api/reports/sensor-type-distribution',
    alertAckLatency:          '/api/reports/alert-ack-latency?hours=168'
  };

  function viewerUrlFor(report) {
    return (report && VIEWER_URLS[report.id]) || null;
  }

  function jsonUrlFor(report) {
    return (report && JSON_URLS[report.id]) || null;
  }

  async function load() {
    setStatus('Fetching catalog…');
    const resp = await fetch('/api/reports/catalog', { credentials: 'include' });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status} ${resp.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('application/json')) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Expected JSON, got ${contentType || 'unknown content-type'}${text ? `: ${text.slice(0, 200)}` : ''}`);
    }

    const data = await resp.json();
    const reports = Array.isArray(data.reports) ? data.reports : [];
    const generatedAt = data.generatedAt || null;

    metaEl.textContent = `${reports.length} reports${generatedAt ? ` • generated ${new Date(generatedAt).toLocaleString()}` : ''}`;

    grid.innerHTML = reports.map((r) => {
      const viewer = viewerUrlFor(r);
      const json = jsonUrlFor(r);

      const pill = viewer ? '<span class="pill">GUI</span>' : '<span class="pill">JSON</span>';

      return `
        <div class="card">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div class="cardTitle">${escapeHtml(r.title || r.id)}</div>
            ${pill}
          </div>
          <div class="cardDesc">${escapeHtml(r.description || '')}</div>
          <div class="cardBtns">
            ${viewer ? `<button class="btn" onclick="window.location.href='${viewer}'">Open Viewer</button>` : ''}
            ${json ? `<button class="btn" onclick="window.open('${json}','_blank','noopener')">Open JSON</button>` : ''}
          </div>
        </div>
      `.trim();
    }).join('');

    setStatus('Loaded.');
  }

  (async function boot() {
    try {
      await load();
    } catch (e) {
      console.error(e);
      if (metaEl) metaEl.textContent = 'Failed to load reports';
      setStatus(`Error: ${e.message || e}`);
    }
  })();
})();
