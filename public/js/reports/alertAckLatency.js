/* Alert Acknowledgment Latency report viewer */
(function () {
  'use strict';

  const hoursEl    = document.getElementById('hours');
  const runBtn     = document.getElementById('run');
  const openJson   = document.getElementById('openJson');
  const kpiRow     = document.getElementById('kpiRow');
  const latTbody   = document.getElementById('latencyTable');
  const staleTbody = document.getElementById('staleTable');
  const trendCanvas= document.getElementById('trendCanvas');
  const metaEl     = document.getElementById('meta');
  const statusBar  = document.getElementById('statusBar');

  function setStatus(html, busy) {
    statusBar.innerHTML = busy
      ? '<span class="spinner"></span>' + html
      : html;
  }

  function fmt(n, d) { return typeof n === 'number' ? n.toFixed(d ?? 1) : '—'; }

  function minStr(mins) {
    if (mins == null) return '—';
    if (mins < 60)  return Math.round(mins) + ' min';
    if (mins < 1440) return (mins / 60).toFixed(1) + ' hr';
    return (mins / 1440).toFixed(1) + ' d';
  }

  function kpi(label, val, unit, color) {
    return `<div class="kpi">
      <div class="label">${label}</div>
      <div class="val" style="color:${color||'#e6eef7'}">${val}</div>
      ${unit ? `<div class="unit">${unit}</div>` : ''}
    </div>`;
  }

  /* severity → pill class */
  function sevPill(sev) {
    const cls = sev === 'critical' ? 'critical'
              : sev === 'warning'  ? 'warning'
              : sev === 'info'     ? 'info' : 'ok';
    return `<span class="pill ${cls}">${sev || 'unknown'}</span>`;
  }

  /* ── trend line chart ────────────────────────────────────── */
  function drawTrend(hourly) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W   = trendCanvas.clientWidth  || 700;
    const H   = trendCanvas.clientHeight || 220;
    trendCanvas.width  = W * dpr;
    trendCanvas.height = H * dpr;
    const ctx = trendCanvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 16, right: 20, bottom: 38, left: 52 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!hourly.length) {
      ctx.fillStyle = 'rgba(230,238,247,.35)';
      ctx.font = '12px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No trend data', W / 2, H / 2);
      return;
    }

    const maxCount = Math.max(...hourly.map(h => h.alertCount || 0), 1);
    const n = hourly.length;

    function xp(i) { return PAD.left + (i / (n - 1 || 1)) * cW; }
    function yp(v) { return PAD.top  + cH - (v / maxCount) * cH; }

    /* grid */
    [0, 0.25, 0.5, 0.75, 1.0].forEach(f => {
      const y = PAD.top + (1 - f) * cH;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(PAD.left + cW, y); ctx.stroke();
      ctx.fillStyle = 'rgba(230,238,247,.30)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      ctx.fillText(Math.round(f * maxCount), PAD.left - 5, y + 4);
    });

    /* area fill */
    const fillGrad = ctx.createLinearGradient(0, PAD.top, 0, PAD.top + cH);
    fillGrad.addColorStop(0,   'rgba(52,152,219,.30)');
    fillGrad.addColorStop(1,   'rgba(52,152,219,.02)');
    ctx.fillStyle = fillGrad;
    ctx.beginPath();
    ctx.moveTo(xp(0), PAD.top + cH);
    hourly.forEach((h, i) => ctx.lineTo(xp(i), yp(h.alertCount || 0)));
    ctx.lineTo(xp(n - 1), PAD.top + cH);
    ctx.closePath();
    ctx.fill();

    /* line */
    ctx.strokeStyle = '#3498db';
    ctx.lineWidth = 2;
    ctx.beginPath();
    hourly.forEach((h, i) => i === 0
      ? ctx.moveTo(xp(0), yp(h.alertCount || 0))
      : ctx.lineTo(xp(i), yp(h.alertCount || 0)));
    ctx.stroke();

    /* ack rate line */
    ctx.strokeStyle = '#2ecc71';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    hourly.forEach((h, i) => {
      const v = (h.ackRate || 0) / 100;
      i === 0 ? ctx.moveTo(xp(0), yp(v * maxCount)) : ctx.lineTo(xp(i), yp(v * maxCount));
    });
    ctx.stroke();
    ctx.setLineDash([]);

    /* x-axis labels — up to 8 ticks */
    const step = Math.max(1, Math.floor(n / 8));
    ctx.fillStyle = 'rgba(230,238,247,.35)';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    hourly.forEach((h, i) => {
      if (i % step !== 0) return;
      const x = xp(i);
      const lbl = h.hour ? new Date(h.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : String(i);
      ctx.fillText(lbl, x, PAD.top + cH + 14);
    });

    /* mini legend */
    const legX = PAD.left + cW - 150;
    const legY = PAD.top + 10;
    ctx.fillStyle = '#3498db';   ctx.fillRect(legX,      legY, 14, 3);
    ctx.fillStyle = 'rgba(230,238,247,.50)'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('Alert volume', legX + 17, legY + 4);
    ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(legX, legY + 14); ctx.lineTo(legX + 14, legY + 14); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(230,238,247,.50)';
    ctx.fillText('Ack rate (scaled)', legX + 17, legY + 18);
  }

  /* ── tables ─────────────────────────────────────────────── */
  function renderLatencyTable(bySeverity) {
    latTbody.innerHTML = bySeverity.map(row => `<tr>
      <td>${sevPill(row.severity)}</td>
      <td>${row.total ?? '—'}</td>
      <td>${row.acknowledged ?? '—'}</td>
      <td style="font-weight:600;color:${parseFloat(row.ackRate) >= 80 ? '#2ecc71' : '#e74c3c'}">${row.ackRate != null ? fmt(row.ackRate) + '%' : '—'}</td>
      <td>${minStr(row.avgAckMinutes)}</td>
      <td style="color:#f39c12">${minStr(row.maxAckMinutes)}</td>
    </tr>`).join('');
  }

  function renderStaleTable(stale) {
    if (!stale.length) {
      staleTbody.innerHTML = '<tr><td colspan="4" style="color:rgba(230,238,247,.35);text-align:center;padding:16px">No stale alerts</td></tr>';
      return;
    }
    staleTbody.innerHTML = stale.map(a => `<tr>
      <td>${a.deviceName || '—'}</td>
      <td style="color:rgba(230,238,247,.65)">${(a.message || '').slice(0, 60)}</td>
      <td>${sevPill(a.severity)}</td>
      <td style="color:#e74c3c;font-weight:600">${minStr(a.ageMinutes)}</td>
    </tr>`).join('');
  }

  /* ── load ──────────────────────────────────────────────── */
  async function load() {
    const hours = parseInt(hoursEl.value, 10);
    openJson.onclick = () => window.open(
      `/api/reports/alert-ack-latency?hours=${hours}`, '_blank');

    setStatus('Fetching ack latency data…', true);
    let data;
    try {
      const r = await fetch(
        `/api/reports/alert-ack-latency?hours=${hours}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }

    const bySeverity = data.bySeverity  || [];
    const stale      = data.staleAlerts || [];
    const hourly     = data.hourlyTrend || [];

    /* global KPIs */
    const totalAlerts = bySeverity.reduce((s, r) => s + (r.total || 0), 0);
    const totalAckd   = bySeverity.reduce((s, r) => s + (r.acknowledged || 0), 0);
    const globalRate  = totalAlerts ? totalAckd / totalAlerts * 100 : 0;
    const avgLats     = bySeverity.filter(r => r.avgAckMinutes != null).map(r => r.avgAckMinutes);
    const globalAvg   = avgLats.length ? avgLats.reduce((a, b) => a + b, 0) / avgLats.length : null;

    kpiRow.innerHTML = [
      kpi('Total Alerts',   totalAlerts,                     '',          '#3498db'),
      kpi('Acknowledged',   totalAckd,                       '',          '#2ecc71'),
      kpi('Ack Rate',       fmt(globalRate) + '%',           '',          globalRate >= 80 ? '#2ecc71' : '#e74c3c'),
      kpi('Avg Ack Time',   minStr(globalAvg),               '',          '#f39c12'),
      kpi('Stale Alerts',   stale.length,                    'unack\'d',  stale.length > 0 ? '#e74c3c' : '#2ecc71'),
    ].join('');

    renderLatencyTable(bySeverity);
    renderStaleTable(stale);
    drawTrend(hourly);

    const label = hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `Last ${label} · ${totalAlerts} alerts · ${fmt(globalRate)}% ack rate`;
    setStatus(`Loaded · ${totalAlerts} alerts · ${stale.length} stale`, false);
  }

  runBtn.addEventListener('click', load);
  window.addEventListener('resize', () => { if (window._ackHourly) drawTrend(window._ackHourly); });

  /* initial load */
  (async function init() {
    const hours = parseInt(hoursEl.value, 10);
    setStatus('Fetching ack latency data…', true);
    let data;
    try {
      const r = await fetch(
        `/api/reports/alert-ack-latency?hours=${hours}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }

    const bySeverity = data.bySeverity  || [];
    const stale      = data.staleAlerts || [];
    const hourly     = data.hourlyTrend || [];
    window._ackHourly = hourly;

    const totalAlerts = bySeverity.reduce((s, r) => s + (r.total || 0), 0);
    const totalAckd   = bySeverity.reduce((s, r) => s + (r.acknowledged || 0), 0);
    const globalRate  = totalAlerts ? totalAckd / totalAlerts * 100 : 0;
    const avgLats     = bySeverity.filter(r => r.avgAckMinutes != null).map(r => r.avgAckMinutes);
    const globalAvg   = avgLats.length ? avgLats.reduce((a, b) => a + b, 0) / avgLats.length : null;

    kpiRow.innerHTML = [
      kpi('Total Alerts',   totalAlerts,                     '',          '#3498db'),
      kpi('Acknowledged',   totalAckd,                       '',          '#2ecc71'),
      kpi('Ack Rate',       fmt(globalRate) + '%',           '',          globalRate >= 80 ? '#2ecc71' : '#e74c3c'),
      kpi('Avg Ack Time',   minStr(globalAvg),               '',          '#f39c12'),
      kpi('Stale Alerts',   stale.length,                    'unack\'d',  stale.length > 0 ? '#e74c3c' : '#2ecc71'),
    ].join('');

    renderLatencyTable(bySeverity);
    renderStaleTable(stale);
    drawTrend(hourly);

    const label = hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `Last ${label} · ${totalAlerts} alerts · ${fmt(globalRate)}% ack rate`;
    setStatus(`Loaded · ${totalAlerts} alerts · ${stale.length} stale`, false);
    openJson.onclick = () => window.open(
      `/api/reports/alert-ack-latency?hours=${hours}`, '_blank');
  })();

})();
