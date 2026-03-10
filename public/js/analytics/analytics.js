/* Analytics module – PRTG Unified Dashboard
 * Tabs: Health forecast · Alerts trend · Company breakdown · AI Insights
 * Charts: line, stacked-bar, horizontal-bar, donut
 * Auto-refresh: 5 min
 */
(function () {
  'use strict';

  // ─── DOM refs ─────────────────────────────────────────────────────────────
  const $ = id => document.getElementById(id);
  const statusBar  = $('statusBar');
  const kpiStrip   = $('kpiStrip');
  const mainCanvas = $('mainCanvas');
  const legendEl   = $('chartLegend');
  const sidePanel  = $('sidePanel');
  const riskPanel  = $('riskPanel');
  const hoursEl    = $('hours');
  const bucketEl   = $('bucketMinutes');
  const forecastEl = $('forecastHours');
  const metaEl     = $('meta');
  const mainGrid   = $('mainGrid');
  const aiPanel    = $('aiPanel');

  let activeTab = 'health';
  let lastData  = {};
  let refreshTimer = null;

  // ─── Utilities ────────────────────────────────────────────────────────────
  function setStatus(text, busy) {
    if (!statusBar) return;
    statusBar.innerHTML = busy
      ? `<span class="spinner"></span>${esc(text)}`
      : esc(text);
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function healthColor(pct) {
    if (pct >= 90) return '#2ecc71';
    if (pct >= 70) return '#f39c12';
    return '#e74c3c';
  }

  function riskColor(risk) {
    if (risk === 'high')   return '#e74c3c';
    if (risk === 'medium') return '#f39c12';
    return '#2ecc71';
  }

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${t.slice(0, 200)}`);
    }
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      const t = await r.text().catch(() => '');
      throw new Error(`Expected JSON, got "${ct}": ${t.slice(0, 120)}`);
    }
    return r.json();
  }

  // ─── Canvas setup ─────────────────────────────────────────────────────────
  function setupCanvas(canvas) {
    const dpr  = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const lw   = Math.max(1, Math.floor(rect.width));
    const lh   = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== lw * dpr || canvas.height !== lh * dpr) {
      canvas.width  = lw * dpr;
      canvas.height = lh * dpr;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: lw, h: lh };
  }

  // ─── Chart helpers ────────────────────────────────────────────────────────
  function drawGrid(ctx, pad, pw, ph, yDivs, maxY, minY, fmt) {
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(230,238,247,0.35)';
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= yDivs; i++) {
      const y = pad.top + Math.round((ph * i) / yDivs);
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + pw, y);
      ctx.stroke();
      const val = maxY - (maxY - minY) * (i / yDivs);
      ctx.fillText(fmt ? fmt(val) : val.toFixed(0), pad.left - 4, y + 3);
    }
    ctx.textAlign = 'left';
  }

  function drawXLabels(ctx, pad, ph, timestamps, pw) {
    const n = timestamps.length;
    if (!n) return;
    const step = Math.max(1, Math.floor(n / 6));
    ctx.fillStyle = 'rgba(230,238,247,0.35)';
    ctx.font = '9px system-ui, sans-serif';
    for (let i = 0; i < n; i += step) {
      const x = pad.left + (n > 1 ? (i / (n - 1)) * pw : 0);
      const d = new Date(timestamps[i]);
      const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      ctx.save();
      ctx.translate(x, pad.top + ph + 14);
      ctx.rotate(-0.45);
      ctx.textAlign = 'center';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  // ─── Chart: Line (health over time + forecast) ────────────────────────────
  function drawLineChart(canvas, actual, predicted) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const pad  = { top: 28, right: 20, bottom: 44, left: 46 };
    const pw   = w - pad.left - pad.right;
    const ph   = h - pad.top  - pad.bottom;
    const minY = 0, maxY = 100;

    if (!actual.length && !predicted.length) {
      ctx.fillStyle = 'rgba(230,238,247,0.3)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No snapshot data – run a collection cycle first', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const allPts = [...actual, ...predicted];
    const xs     = allPts.map(p => new Date(p.timestamp).getTime());
    const minX   = Math.min(...xs);
    const maxX   = Math.max(...xs);
    const rangeX = maxX - minX || 1;

    function px(t) { return pad.left + ((t - minX) / rangeX) * pw; }
    function py(v) { return pad.top + ph - ((v - minY) / (maxY - minY)) * ph; }

    drawGrid(ctx, pad, pw, ph, 5, maxY, minY, v => v.toFixed(0) + '%');
    drawXLabels(ctx, pad, ph, allPts.map(p => p.timestamp), pw);

    // Forecast confidence band
    if (predicted.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#3498db';
      ctx.beginPath();
      ctx.moveTo(px(new Date(predicted[0].timestamp).getTime()), py(Math.min(100, predicted[0].value + 6)));
      predicted.forEach(p => ctx.lineTo(px(new Date(p.timestamp).getTime()), py(Math.min(100, p.value + 6))));
      for (let i = predicted.length - 1; i >= 0; i--)
        ctx.lineTo(px(new Date(predicted[i].timestamp).getTime()), py(Math.max(0, predicted[i].value - 6)));
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // "now" separator
    if (actual.length && predicted.length) {
      const sepX = px(new Date(actual[actual.length - 1].timestamp).getTime());
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sepX, pad.top); ctx.lineTo(sepX, pad.top + ph); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.font = '9px system-ui, sans-serif';
      ctx.fillText('now', sepX + 3, pad.top + 10);
      ctx.restore();
    }

    // Actual area fill
    if (actual.length > 1) {
      const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ph);
      grad.addColorStop(0, 'rgba(46,204,113,0.18)');
      grad.addColorStop(1, 'rgba(46,204,113,0.00)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(px(new Date(actual[0].timestamp).getTime()), py(actual[0].value));
      actual.forEach(p => ctx.lineTo(px(new Date(p.timestamp).getTime()), py(p.value)));
      ctx.lineTo(px(new Date(actual[actual.length - 1].timestamp).getTime()), pad.top + ph);
      ctx.lineTo(px(new Date(actual[0].timestamp).getTime()), pad.top + ph);
      ctx.closePath();
      ctx.fill();
    }

    // Actual line
    if (actual.length > 1) {
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      actual.forEach((p, i) => {
        const x = px(new Date(p.timestamp).getTime()), y = py(p.value);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      if (actual.length <= 60) {
        ctx.fillStyle = '#2ecc71';
        actual.forEach(p => {
          ctx.beginPath();
          ctx.arc(px(new Date(p.timestamp).getTime()), py(p.value), 2.5, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // Predicted line (dashed blue)
    if (predicted.length > 1) {
      ctx.strokeStyle = 'rgba(52,152,219,0.85)';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      predicted.forEach((p, i) => {
        const x = px(new Date(p.timestamp).getTime()), y = py(p.value);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = 'rgba(230,238,247,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Network Health %', pad.left + 4, pad.top - 9);
  }

  // ─── Chart: Stacked Bar (alerts / sensor events) ──────────────────────────
  function drawStackedBar(canvas, points, sevList) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const pad  = { top: 28, right: 20, bottom: 44, left: 46 };
    const pw   = w - pad.left - pad.right;
    const ph   = h - pad.top  - pad.bottom;

    if (!points.length) {
      ctx.fillStyle = 'rgba(230,238,247,0.3)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No alert/event data in this window', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const SEV_COLORS = {
      Down: '#e74c3c', down: '#e74c3c',
      Warning: '#f39c12', warning: '#f39c12',
      Paused: '#7f8c8d', paused: '#7f8c8d',
      error: '#c0392b', info: '#3498db', unknown: '#34495e'
    };
    function sevColor(s) { return SEV_COLORS[s] || SEV_COLORS[String(s).toLowerCase()] || '#3498db'; }

    const maxVal = Math.max(1, ...points.map(pt => sevList.reduce((acc, s) => acc + (pt.values[s] || 0), 0)));

    drawGrid(ctx, pad, pw, ph, 4, maxVal, 0);
    drawXLabels(ctx, pad, ph, points.map(p => p.timestamp), pw);

    const barTotal = pw / points.length;
    const barW     = Math.max(1, barTotal * 0.82);
    const barOff   = (barTotal - barW) / 2;

    points.forEach((pt, i) => {
      const bx = pad.left + i * barTotal + barOff;
      let curY = pad.top + ph;
      for (const s of sevList) {
        const val = pt.values[s] || 0;
        if (!val) continue;
        const barH = (val / maxVal) * ph;
        curY -= barH;
        ctx.fillStyle = sevColor(s);
        ctx.fillRect(bx, curY, barW, barH);
      }
    });

    ctx.fillStyle = 'rgba(230,238,247,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Alerts / Events over time', pad.left + 4, pad.top - 9);

    return sevList.map(s => ({ label: s, color: sevColor(s) }));
  }

  // ─── Chart: Horizontal Bar (company health) ───────────────────────────────
  function drawHBar(canvas, companies) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    if (!companies.length) {
      ctx.fillStyle = 'rgba(230,238,247,0.3)';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No company snapshot data available', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const labelW = 160;
    const valW   = 42;
    const pad    = { top: 22, right: valW + 8, bottom: 8, left: labelW };
    const pw     = w - pad.left - pad.right;
    const ph     = h - pad.top  - pad.bottom;
    const rowH   = Math.min(30, Math.floor(ph / Math.max(1, companies.length)));

    ctx.fillStyle = 'rgba(230,238,247,0.55)';
    ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('Company Health Scores (avg %)', pad.left + 4, 15);

    [0, 25, 50, 75, 100].forEach(v => {
      const x = pad.left + (v / 100) * pw;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, pad.top - 8); ctx.lineTo(x, pad.top + companies.length * rowH); ctx.stroke();
      ctx.fillStyle = 'rgba(230,238,247,0.25)';
      ctx.font = '9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(v + '%', x, pad.top - 2);
    });

    companies.forEach((co, i) => {
      const y    = pad.top + i * rowH;
      const barW = (Math.max(0, Math.min(100, co.avgHealth)) / 100) * pw;
      const barH = Math.max(4, rowH - 6);

      const label = co.companyName.length > 22 ? co.companyName.slice(0, 21) + '…' : co.companyName;
      ctx.fillStyle = 'rgba(230,238,247,0.70)';
      ctx.font = `${Math.min(11, Math.max(9, rowH - 8))}px system-ui, sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(label, labelW - 8, y + rowH * 0.65);

      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(pad.left, y + 4, pw, barH);

      const grad = ctx.createLinearGradient(pad.left, 0, pad.left + barW, 0);
      const col  = healthColor(co.avgHealth);
      grad.addColorStop(0, col + 'cc');
      grad.addColorStop(1, col + '55');
      ctx.fillStyle = grad;
      ctx.fillRect(pad.left, y + 4, barW, barH);

      // Min/max ticks
      const xMin = pad.left + (co.minHealth / 100) * pw;
      const xMax = pad.left + (co.maxHealth / 100) * pw;
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 1.5;
      [xMin, xMax].forEach(x => {
        ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 4 + barH); ctx.stroke();
      });

      ctx.fillStyle = 'rgba(230,238,247,0.55)';
      ctx.font = '10px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(co.avgHealth.toFixed(0) + '%', pad.left + pw + 6, y + rowH * 0.65);
    });

    ctx.textAlign = 'left';
  }

  // ─── Chart: Donut (sensor status distribution) ────────────────────────────
  function drawDonut(canvas, segments) {
    const { ctx, w, h } = setupCanvas(canvas);
    ctx.clearRect(0, 0, w, h);

    const total = segments.reduce((s, seg) => s + seg.value, 0);
    if (!total) {
      ctx.fillStyle = 'rgba(230,238,247,0.3)';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No sensor data', w / 2, h / 2);
      ctx.textAlign = 'left';
      return;
    }

    const cx = w / 2, cy = h / 2;
    const r  = Math.min(cx, cy) * 0.72;
    const ri = r * 0.52;
    let angle = -Math.PI / 2;

    segments.forEach(seg => {
      const sweep = (seg.value / total) * Math.PI * 2;
      ctx.fillStyle = seg.color;
      ctx.beginPath();
      ctx.arc(cx, cy, r, angle, angle + sweep);
      ctx.arc(cx, cy, ri, angle + sweep, angle, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#0b0f14';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (seg.value / total > 0.05) {
        const mid = angle + sweep / 2;
        const lx  = cx + Math.cos(mid) * (r + 14);
        const ly  = cy + Math.sin(mid) * (r + 14);
        ctx.fillStyle = 'rgba(230,238,247,0.6)';
        ctx.font = '9px system-ui, sans-serif';
        ctx.textAlign = (mid > Math.PI / 2 && mid < Math.PI * 1.5) ? 'right' : 'left';
        ctx.fillText(seg.label, lx, ly);
      }
      angle += sweep;
    });

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(230,238,247,0.85)';
    ctx.font = `bold ${Math.floor(r * 0.32)}px system-ui, sans-serif`;
    ctx.fillText(total.toLocaleString(), cx, cy + 5);
    ctx.font = `${Math.floor(r * 0.18)}px system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(230,238,247,0.40)';
    ctx.fillText('sensors', cx, cy + 18);
    ctx.textAlign = 'left';
  }

  // ─── KPI Cards ────────────────────────────────────────────────────────────
  function renderKPIs(summary) {
    const d = summary.devices || {};
    const s = summary.sensors || {};
    const a = summary.alerts  || {};
    const total     = d.total || 0;
    const devUp     = d.up    || 0;
    const healthPct = total > 0 ? Math.round((devUp / total) * 100) : 0;

    const cards = [
      { val: summary.servers || 0, label: 'PRTG Servers', sub: 'active', color: '#3498db' },
      { val: total, label: 'Devices', sub: `${devUp} up  ·  ${d.down || 0} down`, color: (d.down > 0) ? '#e74c3c' : '#2ecc71' },
      { val: healthPct + '%', label: 'Device Health', sub: 'by device count', color: healthColor(healthPct) },
      { val: `${d.warning || 0} / ${d.down || 0}`, label: 'Warn / Down', sub: 'devices', color: (d.down > 0) ? '#e74c3c' : (d.warning > 0) ? '#f39c12' : '#2ecc71' },
      { val: s.total || 0, label: 'Sensors', sub: `${s.down || 0} down · ${s.warning || 0} warn · ${s.paused || 0} paused`, color: (s.down > 0) ? '#e74c3c' : '#2ecc71' },
      { val: a.last24h ?? '—', label: 'Alerts (24 h)', sub: `${a.unacknowledged ?? '—'} unacknowledged`, color: (a.unacknowledged > 0) ? '#e74c3c' : 'rgba(230,238,247,0.6)' }
    ];

    kpiStrip.innerHTML = cards.map(c => `
      <div class="kpi-card">
        <div class="kpi-val" style="color:${esc(c.color)}">${esc(String(c.val))}</div>
        <div class="kpi-label">${esc(c.label)}</div>
        <div class="kpi-sub">${esc(c.sub)}</div>
      </div>
    `).join('');
  }

  // ─── Risk table ────────────────────────────────────────────────────────────
  function renderRiskTable(devices) {
    if (!riskPanel) return;
    if (!devices.length) {
      riskPanel.innerHTML = `
        <div class="pill">At-Risk Devices</div>
        <div class="empty-state" style="padding:20px 8px;">
          <div class="empty-icon">✓</div>
          No at-risk devices detected<br>
          <span style="font-size:10px;color:rgba(230,238,247,.35);">Need ≥6 snapshots per device</span>
        </div>`;
      return;
    }

    const rows = devices.slice(0, 14).map(r => {
      const delta = Number(r.deltaHealth);
      const rc    = riskColor(r.risk);
      const trend = delta < -1 ? '↘' : delta > 1 ? '↗' : '→';
      return `<tr>
        <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            title="${esc(r.deviceName || '')}">${esc(r.deviceName || String(r.deviceId || ''))}</td>
        <td style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(230,238,247,.55);"
            title="${esc(r.companyName || '')}">${esc(r.companyName || '—')}</td>
        <td style="color:${delta < 0 ? '#e74c3c' : '#2ecc71'}">${trend} ${Number.isFinite(delta) ? delta.toFixed(1) : '—'}</td>
        <td><span class="badge" style="background:${rc}22;color:${rc};border-color:${rc}44;">${esc(r.risk)}</span></td>
      </tr>`;
    }).join('');

    riskPanel.innerHTML = `
      <div class="pill">At-Risk Devices</div>
      <div style="font-size:10px;color:rgba(230,238,247,.40);margin:6px 0 8px;">
        Heuristic: slope + current health from snapshots
      </div>
      <table class="table">
        <thead><tr><th>Device</th><th>Company</th><th>Δ Health</th><th>Risk</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ─── Sensor donut side-panel ───────────────────────────────────────────────
  function renderSensorDonut(summary) {
    if (!sidePanel) return;
    const s = summary.sensors || {};
    const segments = [
      { label: 'Up',      value: s.up      || 0, color: '#2ecc71' },
      { label: 'Warning', value: s.warning  || 0, color: '#f39c12' },
      { label: 'Down',    value: s.down     || 0, color: '#e74c3c' },
      { label: 'Paused',  value: s.paused   || 0, color: '#7f8c8d' },
      { label: 'Unusual', value: s.unusual  || 0, color: '#9b59b6' },
      { label: 'Unknown', value: s.unknown  || 0, color: '#34495e' }
    ].filter(seg => seg.value > 0);

    const legendHtml = segments.map(seg =>
      `<span class="badge" style="margin:2px;background:${seg.color}22;color:${seg.color};border-color:${seg.color}44;">
         ${esc(seg.label)} <strong>${seg.value.toLocaleString()}</strong>
       </span>`
    ).join('');

    sidePanel.innerHTML = `
      <div class="pill">Sensor Distribution</div>
      <canvas id="donutCanvas" style="width:100%;height:180px;display:block;margin-top:10px;"></canvas>
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:2px;">${legendHtml}</div>
    `;
    requestAnimationFrame(() => {
      const dc = $('donutCanvas');
      if (dc) drawDonut(dc, segments);
    });
  }

  // ─── Alerts sidebar ────────────────────────────────────────────────────────
  function renderAlertsSidebar(alertsData) {
    if (!sidePanel) return;
    const series = alertsData.series || {};
    const pts    = series.points  || [];
    const sevs   = series.severities || [];
    const totals = {};
    for (const s of sevs) totals[s] = 0;
    pts.forEach(pt => sevs.forEach(s => { totals[s] = (totals[s] || 0) + (pt.values[s] || 0); }));

    const SEV_COLORS = { Down: '#e74c3c', Warning: '#f39c12', Paused: '#7f8c8d', error: '#c0392b', info: '#3498db', unknown: '#34495e' };
    const rows = sevs.map(s => {
      const col = SEV_COLORS[s] || SEV_COLORS[String(s).toLowerCase()] || '#3498db';
      return `<tr>
        <td><span class="badge" style="background:${col}22;color:${col};border-color:${col}44;">${esc(s)}</span></td>
        <td style="text-align:right;font-weight:600;">${(totals[s] || 0).toLocaleString()}</td>
      </tr>`;
    }).join('');

    const totalAll = Object.values(totals).reduce((a, b) => a + b, 0);
    sidePanel.innerHTML = `
      <div class="pill">Event Totals</div>
      <div style="font-size:10px;color:rgba(230,238,247,.40);margin:5px 0 8px;">
        source: <code style="font-size:10px;">${esc(alertsData.source || '?')}</code> · unit: ${esc(alertsData.unit || 'count')}
      </div>
      <table class="table">
        <thead><tr><th>Severity</th><th style="text-align:right;">Total</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="border-top:1px solid rgba(255,255,255,.12);">
            <td style="font-weight:600;color:rgba(230,238,247,.65);">All</td>
            <td style="text-align:right;font-weight:700;">${totalAll.toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  // ─── Companies sidebar ─────────────────────────────────────────────────────
  function renderCompaniesSidebar(companiesData) {
    if (!sidePanel) return;
    const cos = (companiesData.companies || []).slice(0, 6);
    if (!cos.length) {
      sidePanel.innerHTML = `<div class="pill">Company Summary</div>
        <div class="empty-state" style="padding:20px 8px;"><div class="empty-icon">🏢</div>No company data</div>`;
      return;
    }
    const rows = cos.map(co => {
      const col = healthColor(co.avgHealth);
      return `<tr>
        <td style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(co.companyName)}">${esc(co.companyName)}</td>
        <td style="color:${col};font-weight:600;">${co.avgHealth.toFixed(0)}%</td>
        <td style="color:rgba(230,238,247,.5);">${co.deviceCount}</td>
        <td style="color:#e74c3c;">${co.totalDown}</td>
      </tr>`;
    }).join('');

    sidePanel.innerHTML = `
      <div class="pill">Company Summary</div>
      <div style="font-size:10px;color:rgba(230,238,247,.40);margin:5px 0 8px;">Sorted by lowest health first</div>
      <table class="table">
        <thead><tr><th>Company</th><th>Health</th><th>Devs</th><th>Down</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  // ─── Tab redraw ────────────────────────────────────────────────────────────
  function redraw() {
    legendEl.innerHTML = '';

    if (activeTab === 'health') {
      const net = lastData.net;
      if (net) {
        drawLineChart(mainCanvas, net.series.actual || [], net.series.predicted || []);
        const m = net.model;
        legendEl.innerHTML = `
          <span class="badge" style="background:#2ecc7122;color:#2ecc71;border-color:#2ecc7144;">● Actual</span>
          <span class="badge" style="background:#3498db22;color:#3498db;border-color:#3498db44;">- - Predicted</span>
          ${m ? `<span class="subtle">R² ${m.r2.toFixed(3)} · slope ${m.slopePerBucket.toFixed(3)}/bucket · confidence ${Math.round((m.confidence || 0) * 100)}%</span>` : ''}
        `;
      } else {
        clearCanvas('No health data');
      }
      if (lastData.summary) renderSensorDonut(lastData.summary);

    } else if (activeTab === 'alerts') {
      const alerts = lastData.alerts;
      if (alerts) {
        const legend = drawStackedBar(mainCanvas, alerts.series.points || [], alerts.series.severities || []);
        if (legend) {
          legendEl.innerHTML = legend.map(l =>
            `<span class="badge" style="background:${l.color}22;color:${l.color};border-color:${l.color}44;">${esc(l.label)}</span>`
          ).join(' ') + `<span class="subtle" style="margin-left:8px;">source: ${esc(alerts.source)} · unit: ${esc(alerts.unit)}</span>`;
        }
        renderAlertsSidebar(alerts);
      } else {
        clearCanvas('No alerts data');
      }

    } else if (activeTab === 'companies') {
      const companies = lastData.companies;
      if (companies) {
        const sorted = [...(companies.companies || [])].sort((a, b) => b.avgHealth - a.avgHealth);
        drawHBar(mainCanvas, sorted);
        legendEl.innerHTML = `<span class="subtle">${sorted.length} companies · avg health · min–max tick lines shown</span>`;
        renderCompaniesSidebar(companies);
      } else {
        clearCanvas('No company data');
      }
    }
  }

  function clearCanvas(msg) {
    const { ctx, w, h } = setupCanvas(mainCanvas);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(230,238,247,0.25)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(msg || 'No data', w / 2, h / 2);
    ctx.textAlign = 'left';
  }

  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.tab-btn').forEach(btn =>
      btn.classList.toggle('active', btn.dataset.tab === name)
    );
    if (name === 'ai') {
      if (mainGrid)  mainGrid.style.display  = 'none';
      if (aiPanel)   aiPanel.style.display   = 'block';
      loadAIInsights();
    } else {
      if (mainGrid)  mainGrid.style.display  = '';
      if (aiPanel)   aiPanel.style.display   = 'none';
      redraw();
    }
  }

  // ─── AI Insights ────────────────────────────────────────────────────────────

  function severityColor(sev) {
    if (sev === 'critical') return '#ef4444';
    if (sev === 'warning')  return '#f59e0b';
    return '#3b82f6';
  }

  function etaText(isoTime) {
    const ms  = new Date(isoTime).getTime() - Date.now();
    if (ms < 0) return 'Overdue';
    const h   = Math.floor(ms / 3600000);
    if (h < 24) return `in ${h}h`;
    const d   = Math.floor(h / 24);
    return `in ${d}d ${h % 24}h`;
  }

  function renderAIInsights(data) {
    const s = data.summary || {};

    // Hero
    const scoreEl = $('aiHealthScore');
    if (scoreEl) {
      const col = s.overallHealth >= 90 ? '#10b981' : s.overallHealth >= 70 ? '#f59e0b' : '#ef4444';
      scoreEl.style.color = col;
      scoreEl.innerHTML = `${Math.round(s.overallHealth)}<span class="unit">%</span>`;
    }
    const sumEl = $('aiSummaryText');
    if (sumEl) sumEl.textContent = s.text || 'Analysis complete.';

    const heroStats = $('aiHeroStats');
    if (heroStats) {
      const trend = s.trendSlope < -0.1 ? '↘ Declining' : s.trendSlope > 0.1 ? '↗ Recovering' : '→ Stable';
      const trendCol = s.trendSlope < -0.1 ? '#ef4444' : s.trendSlope > 0.1 ? '#10b981' : '#6b7280';
      heroStats.innerHTML = [
        { val: s.networkDown,       lbl: 'Devices Down',   col: s.networkDown   > 0 ? '#ef4444' : '#10b981' },
        { val: s.networkWarning,    lbl: 'Warnings',       col: s.networkWarning > 0 ? '#f59e0b' : '#10b981' },
        { val: s.anomalyCount,      lbl: 'Anomalies',      col: s.anomalyCount  > 0 ? '#f59e0b' : '#10b981' },
        { val: s.predictionCount,   lbl: 'Predictions',    col: s.predictionCount > 0 ? '#a78bfa' : '#10b981' },
        { val: s.flappingCount,     lbl: 'Flapping',       col: s.flappingCount > 0 ? '#f59e0b' : '#10b981' },
        { val: trend,               lbl: '24h Trend',      col: trendCol }
      ].map(st =>
        `<div class="ai-hero-stat"><div class="val" style="color:${st.col}">${esc(String(st.val))}</div><div class="lbl">${esc(st.lbl)}</div></div>`
      ).join('');
    }

    // Live anomalies
    const anomList = $('aiAnomalyList');
    if (anomList) {
      const all = [...(data.liveAnomalies || []), ...(data.storedAnomalies || [])]
        .sort((a, b) => {
          const order = { critical: 0, warning: 1, info: 2 };
          return (order[a.severity] || 2) - (order[b.severity] || 2);
        });
      if (!all.length) {
        anomList.innerHTML = `<div class="ai-empty">✅ No anomalies detected</div>`;
      } else {
        anomList.innerHTML = all.slice(0, 8).map(a => `
          <div class="anomaly-card ${esc(a.severity)}">
            <div class="anomaly-device">${esc(a.deviceName || a.entityName || 'Unknown')}</div>
            <div class="anomaly-company">${esc(a.companyName || 'Unassigned')}</div>
            <div class="anomaly-msg">${esc(a.message || '')}</div>
            <span class="anomaly-badge ${esc(a.severity)}">${esc(a.severity)}</span>
          </div>`).join('');
        if (all.length > 8) {
          anomList.innerHTML += `<div class="ai-empty" style="padding:8px;">+${all.length - 8} more anomalies</div>`;
        }
      }
    }

    // Predictions
    const predList = $('aiPredList');
    if (predList) {
      const preds = data.predictions || [];
      if (!preds.length) {
        predList.innerHTML = `<div class="ai-empty">✅ No predictive alarms active</div>`;
      } else {
        predList.innerHTML = preds.slice(0, 6).map(p => {
          const conf = Math.round(Number(p.confidenceScore) * 100);
          return `
          <div class="pred-card">
            <div class="pred-entity">${esc(p.entityName || 'Unknown')}</div>
            <div class="pred-company">${esc(p.companyName || 'Unassigned')}</div>
            <div class="pred-eta">⏰ ${esc(etaText(p.predictedTime))}</div>
            <div class="pred-conf">Type: ${esc(p.predictionType)} · Confidence: ${conf}%</div>
          </div>`;
        }).join('');
      }
    }

    // Recommendations
    const recList = $('aiRecList');
    if (recList) {
      const recs = data.recommendations || [];
      recList.innerHTML = recs.map(r =>
        `<li class="rec-item ${esc(r.priority)}">
           <span class="rec-icon">${esc(r.icon)}</span>
           <span class="rec-text">${esc(r.text)}</span>
         </li>`
      ).join('');
    }

    // At-risk companies
    const riskComp = $('aiRiskCompanies');
    if (riskComp) {
      const companies = data.atRiskCompanies || [];
      if (!companies.length) {
        riskComp.innerHTML = `<div class="ai-empty">✅ All companies healthy</div>`;
      } else {
        riskComp.innerHTML = companies.slice(0, 8).map(c => {
          const col = c.riskLevel === 'critical' ? '#ef4444' : c.riskLevel === 'high' ? '#f59e0b' : '#3b82f6';
          const pct = Math.max(0, Math.min(100, c.avgHealth));
          return `<div class="risk-row">
            <span class="risk-name" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.companyName)}">${esc(c.companyName)}</span>
            <div class="risk-bar-wrap"><div class="risk-bar" style="width:${pct}%;background:${col};"></div></div>
            <span class="risk-pct" style="color:${col};">${pct.toFixed(0)}%</span>
          </div>`;
        }).join('');
      }
    }

    // Flapping
    const flapList = $('aiFlapList');
    if (flapList) {
      const flaps = data.flapping || [];
      if (!flaps.length) {
        flapList.innerHTML = `<div class="ai-empty">✅ No flapping devices detected</div>`;
      } else {
        flapList.innerHTML = flaps.map(f =>`
          <div class="flap-row">
            <span class="flap-name" title="${esc(f.deviceName)}">${esc(f.deviceName.length > 22 ? f.deviceName.slice(0,21)+'…' : f.deviceName)}</span>
            <span class="flap-std">σ ${f.stdHealth}%</span>
          </div>`).join('');
      }
    }

    // Trend model
    const trendMod = $('aiTrendModel');
    if (trendMod) {
      const m = data.models?.trend || {};
      const slope = m.slope || 0;
      const r2    = m.r2    || 0;
      const arrow = slope < -0.15 ? '↘' : slope > 0.15 ? '↗' : '→';
      const arrowCl = slope < -0.15 ? 'trend-down' : slope > 0.15 ? 'trend-up' : 'trend-flat';
      const description = slope < -0.5  ? 'Rapid decline — urgent' :
                          slope < -0.1  ? 'Gradual decline — watch' :
                          slope >  0.3  ? 'Recovering well' :
                          slope >  0.05 ? 'Slight improvement' :
                                          'Stable — no significant change';
      trendMod.innerHTML = `
        <div style="text-align:center;margin-bottom:12px;">
          <span class="ai-trend-arrow ${arrowCl}">${arrow}</span>
        </div>
        <table class="table">
          <tbody>
            <tr><td style="color:rgba(230,238,247,.55);">Model</td><td>Linear Regression (24h)</td></tr>
            <tr><td style="color:rgba(230,238,247,.55);">Slope</td><td style="color:${slope < 0 ? '#ef4444' : '#10b981'}">${slope.toFixed(4)}/hr</td></tr>
            <tr><td style="color:rgba(230,238,247,.55);">R²</td><td>${r2.toFixed(3)}</td></tr>
            <tr><td style="color:rgba(230,238,247,.55);">Anomaly</td><td>Z-score ≥ 2.0σ</td></tr>
            <tr><td style="color:rgba(230,238,247,.55);">Window</td><td>${(data.models?.anomaly?.windowHours || '?')}h</td></tr>
          </tbody>
        </table>
        <div style="font-size:11px;margin-top:10px;color:rgba(230,238,247,.60);">${esc(description)}</div>
      `;
    }

    const tsEl = $('aiTimestamp');
    if (tsEl) tsEl.textContent = `Generated: ${new Date(data.generatedAt || Date.now()).toLocaleString()}`;
  }

  let aiLoading = false;
  async function loadAIInsights() {
    if (aiLoading) return;
    aiLoading = true;
    setStatus('Loading AI analysis…', true);
    try {
      const hours = Number.parseInt(hoursEl.value, 10) || 48;
      const d = await fetchJson(`/api/analytics/ai-insights?hours=${hours}`);
      renderAIInsights(d);
      setStatus('AI analysis ready · auto-refreshes every 5 min', false);
    } catch (e) {
      console.error('AI insights error:', e);
      setStatus('AI insights error: ' + e.message, false);
      const heroSum = $('aiSummaryText');
      if (heroSum) heroSum.textContent = 'Failed to load AI analysis: ' + e.message;
    } finally {
      aiLoading = false;
    }
  }

  // ─── Main data load ────────────────────────────────────────────────────────
  async function run() {
    const hours         = Number.parseInt(hoursEl.value,    10) || 24;
    const bucketMinutes = Number.parseInt(bucketEl.value,   10) || 60;
    const forecastHours = Number.parseInt(forecastEl.value, 10) || 24;

    setStatus('Loading analytics…', true);

    const [summary, net, risk, alerts, companies] = await Promise.allSettled([
      fetchJson('/api/dashboard/summary'),
      fetchJson(`/api/analytics/network-health?hours=${hours}&bucketMinutes=${bucketMinutes}&forecastHours=${forecastHours}`),
      fetchJson(`/api/analytics/device-risk?hours=${Math.min(hours, 720)}&limit=15`),
      fetchJson(`/api/reports/alerts-trend?hours=${hours}&bucketMinutes=${bucketMinutes}`),
      fetchJson(`/api/analytics/company-health?hours=${hours}`)
    ]);

    const errors = [];

    if (summary.status === 'fulfilled') {
      lastData.summary = summary.value;
      renderKPIs(summary.value);
    } else {
      errors.push('summary: ' + (summary.reason?.message || '?'));
    }

    lastData.net       = net.status       === 'fulfilled' ? net.value       : null;
    lastData.risk      = risk.status      === 'fulfilled' ? risk.value      : null;
    lastData.alerts    = alerts.status    === 'fulfilled' ? alerts.value    : null;
    lastData.companies = companies.status === 'fulfilled' ? companies.value : null;

    if (net.status       === 'rejected') errors.push('network-health: '  + (net.reason?.message || '?'));
    if (risk.status      === 'rejected') errors.push('device-risk: '     + (risk.reason?.message || '?'));
    if (alerts.status    === 'rejected') errors.push('alerts-trend: '    + (alerts.reason?.message || '?'));
    if (companies.status === 'rejected') errors.push('company-health: '  + (companies.reason?.message || '?'));

    renderRiskTable(lastData.risk?.devices || []);
    redraw();

    if (metaEl) {
      metaEl.textContent = `${hours}h lookback · ${bucketMinutes}m buckets · +${forecastHours}h forecast · updated ${new Date().toLocaleTimeString()}`;
    }

    if (errors.length) {
      setStatus(`Partial load (${errors.length} error${errors.length > 1 ? 's' : ''}): ${errors[0]}`, false);
    } else {
      setStatus('Ready · auto-refreshes every 5 min', false);
    }
  }

  // ─── Auto-refresh ──────────────────────────────────────────────────────────
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(async () => {
      try { await run(); } catch (e) { console.error('Auto-refresh error:', e); }
      scheduleRefresh();
    }, 5 * 60 * 1000);
  }

  // ─── Event wiring ──────────────────────────────────────────────────────────
  $('run').addEventListener('click', () => {
    clearTimeout(refreshTimer);
    if (activeTab === 'ai') {
      loadAIInsights()
        .catch(e => { console.error(e); setStatus('Error: ' + e.message, false); })
        .finally(() => scheduleRefresh());
    } else {
      run()
        .catch(e => { console.error(e); setStatus('Error: ' + e.message, false); })
        .finally(() => scheduleRefresh());
    }
  });

  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab))
  );

  $('openJson').addEventListener('click', () => {
    const hours   = Number.parseInt(hoursEl.value,    10) || 24;
    const bucket  = Number.parseInt(bucketEl.value,   10) || 60;
    const fcast   = Number.parseInt(forecastEl.value, 10) || 24;
    const url = activeTab === 'ai'
      ? `/api/analytics/ai-insights?hours=${hours}`
      : `/api/analytics/network-health?hours=${hours}&bucketMinutes=${bucket}&forecastHours=${fcast}`;
    window.open(url, '_blank', 'noopener');
  });

  window.addEventListener('resize', () => requestAnimationFrame(redraw));

  // ─── Boot ──────────────────────────────────────────────────────────────────
  (async function boot() {
    try {
      await run();
      scheduleRefresh();
    } catch (e) {
      console.error('Analytics boot error:', e);
      setStatus('Failed to load: ' + e.message, false);
      if (metaEl) metaEl.textContent = 'Failed to load analytics';
    }
  })();

})();
