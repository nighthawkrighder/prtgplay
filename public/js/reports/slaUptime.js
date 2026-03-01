/* SLA / Uptime by Company report viewer */
(function () {
  'use strict';

  /* ── DOM refs ─────────────────────────────────────────────── */
  const hoursEl   = document.getElementById('hours');
  const slaEl     = document.getElementById('slaTarget');
  const runBtn    = document.getElementById('run');
  const openJson  = document.getElementById('openJson');
  const kpiRow    = document.getElementById('kpiRow');
  const tbody     = document.getElementById('tableBody');
  const canvas    = document.getElementById('mainCanvas');
  const metaEl    = document.getElementById('meta');
  const statusBar = document.getElementById('statusBar');

  /* ── helpers ──────────────────────────────────────────────── */
  function setStatus(html, busy) {
    statusBar.innerHTML = busy
      ? '<span class="spinner"></span>' + html
      : html;
  }

  function fmt(n, d) { return (typeof n === 'number' ? n.toFixed(d ?? 1) : '—'); }

  function kpi(label, val, unit, color) {
    return `<div class="kpi">
      <div class="label">${label}</div>
      <div class="val" style="color:${color||'#e6eef7'}">${val}</div>
      ${unit ? `<div class="unit">${unit}</div>` : ''}
    </div>`;
  }

  /* ── chart ─────────────────────────────────────────────────── */
  function drawChart(companies, slaTarget) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W   = canvas.clientWidth  || 800;
    const H   = canvas.clientHeight || 420;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 20, right: 20, bottom: 80, left: 56 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!companies.length) {
      ctx.fillStyle = 'rgba(230,238,247,.35)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    /* sort ascending so worst performers are top of horizontal list */
    const data = [...companies].sort((a, b) => a.uptimePct - b.uptimePct).slice(0, 20);
    const barH  = Math.min(24, (cH / data.length) - 4);
    const gap   = (cH - data.length * barH) / (data.length + 1);
    const xMin  = Math.max(0, Math.min(...data.map(d => d.uptimePct)) - 2);
    const xMax  = 100;
    const xRange = xMax - xMin;

    function xPos(val) { return PAD.left + ((val - xMin) / xRange) * cW; }

    /* grid lines */
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth   = 1;
    const gridTicks = [xMin, xMin + xRange * 0.25, xMin + xRange * 0.5, xMin + xRange * 0.75, xMax];
    gridTicks.forEach(v => {
      const x = xPos(v);
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      ctx.fillStyle = 'rgba(230,238,247,.3)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(fmt(v) + '%', x, PAD.top + cH + 14);
    });

    /* SLA threshold line */
    const slaX = xPos(slaTarget);
    ctx.save();
    ctx.strokeStyle = 'rgba(231,76,60,.65)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(slaX, PAD.top - 4); ctx.lineTo(slaX, PAD.top + cH); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(231,76,60,.85)';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SLA ' + fmt(slaTarget) + '%', slaX, PAD.top - 8);
    ctx.restore();

    /* bars */
    data.forEach((d, i) => {
      const y   = PAD.top + gap + i * (barH + gap);
      const w   = ((d.uptimePct - xMin) / xRange) * cW;
      const ok  = d.uptimePct >= slaTarget;
      const clr = ok ? '#2ecc71' : '#e74c3c';

      /* bar */
      const grad = ctx.createLinearGradient(PAD.left, 0, PAD.left + w, 0);
      grad.addColorStop(0, clr + '55');
      grad.addColorStop(1, clr + 'cc');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(PAD.left, y, Math.max(w, 1), barH, 3);
      ctx.fill();

      /* pct label */
      ctx.fillStyle = '#e6eef7';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(fmt(d.uptimePct) + '%', PAD.left + w + 4, y + barH / 2 + 4);

      /* company label */
      ctx.fillStyle = 'rgba(230,238,247,.65)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      const label = (d.company || 'Unknown').length > 18 ? d.company.slice(0, 17) + '…' : (d.company || 'Unknown');
      ctx.fillText(label, PAD.left - 6, y + barH / 2 + 4);
    });
  }

  /* ── table ─────────────────────────────────────────────────── */
  function renderTable(companies, slaTarget) {
    const sorted = [...companies].sort((a, b) => a.uptimePct - b.uptimePct);
    tbody.innerHTML = sorted.map(d => {
      const ok = d.uptimePct >= slaTarget;
      return `<tr>
        <td>${d.company || '—'}</td>
        <td style="color:${ok ? '#2ecc71' : '#e74c3c'};font-weight:600">${fmt(d.uptimePct)}%</td>
        <td>${d.deviceCount}</td>
        <td>${d.breachCount}</td>
        <td>${d.estBreachMinutes != null ? Math.round(d.estBreachMinutes) + ' min' : '—'}</td>
        <td><span class="badge" style="background:${ok ? 'rgba(46,204,113,.12)' : 'rgba(231,76,60,.12)'};border-color:${ok ? 'rgba(46,204,113,.35)' : 'rgba(231,76,60,.35)'}; color:${ok ? '#67e8a0' : '#ff7f72'}">${ok ? 'MET' : 'BREACH'}</span></td>
      </tr>`;
    }).join('');
  }

  /* ── main load ─────────────────────────────────────────────── */
  async function load() {
    const hours     = parseInt(hoursEl.value, 10);
    const slaTarget = parseFloat(slaEl.value) || 99.0;

    openJson.onclick = () => window.open(
      `/api/reports/sla-uptime?hours=${hours}&slaTarget=${slaTarget}`, '_blank');

    setStatus('Fetching SLA data…', true);

    let data;
    try {
      const r = await fetch(
        `/api/reports/sla-uptime?hours=${hours}&slaTarget=${slaTarget}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }

    const companies = data.companies || [];
    const summary   = data.summary   || {};

    /* KPIs */
    const breaching = companies.filter(c => c.uptimePct < slaTarget).length;
    kpiRow.innerHTML = [
      kpi('Companies',       companies.length,                       '',         '#3498db'),
      kpi('SLA Target',      fmt(slaTarget) + '%',                   'threshold', '#e6eef7'),
      kpi('In Breach',       breaching,                              'companies', breaching ? '#e74c3c' : '#2ecc71'),
      kpi('Avg Uptime',      fmt(summary.avgUptimePct) + '%',        '',         summary.avgUptimePct >= slaTarget ? '#2ecc71' : '#e74c3c'),
      kpi('Total Breaches',  summary.totalBreaches ?? '—',           'buckets',  '#f39c12'),
    ].join('');

    drawChart(companies, slaTarget);
    renderTable(companies, slaTarget);

    const label = hours >= 720 ? `${Math.round(hours / 720)} mo` :
                  hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `${companies.length} companies · last ${label} · SLA ${fmt(slaTarget)}%`;
    setStatus(`Loaded ${companies.length} companies · ${breaching} in breach`, false);
  }

  /* ── events ────────────────────────────────────────────────── */
  runBtn.addEventListener('click', load);
  window.addEventListener('resize', () => {
    const companies = window._slaData;
    if (companies) drawChart(companies, parseFloat(slaEl.value) || 99.0);
  });

  /* patch load to cache data for resize */
  const _orig = load;
  window._slaData = null;
  (async function init() {
    const hours     = parseInt(hoursEl.value, 10);
    const slaTarget = parseFloat(slaEl.value) || 99.0;
    setStatus('Fetching SLA data…', true);
    let data;
    try {
      const r = await fetch(
        `/api/reports/sla-uptime?hours=${hours}&slaTarget=${slaTarget}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }
    const companies = data.companies || [];
    const summary   = data.summary   || {};
    window._slaData = companies;
    const breaching = companies.filter(c => c.uptimePct < slaTarget).length;
    kpiRow.innerHTML = [
      kpi('Companies',      companies.length,                       '',          '#3498db'),
      kpi('SLA Target',     fmt(slaTarget) + '%',                   'threshold', '#e6eef7'),
      kpi('In Breach',      breaching,                              'companies', breaching ? '#e74c3c' : '#2ecc71'),
      kpi('Avg Uptime',     fmt(summary.avgUptimePct) + '%',        '',          summary.avgUptimePct >= slaTarget ? '#2ecc71' : '#e74c3c'),
      kpi('Total Breaches', summary.totalBreaches ?? '—',           'buckets',   '#f39c12'),
    ].join('');
    drawChart(companies, slaTarget);
    renderTable(companies, slaTarget);
    const label = hours >= 720 ? `${Math.round(hours / 720)} mo` :
                  hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `${companies.length} companies · last ${label} · SLA ${fmt(slaTarget)}%`;
    setStatus(`Loaded ${companies.length} companies · ${breaching} in breach`, false);
    openJson.onclick = () => window.open(
      `/api/reports/sla-uptime?hours=${hours}&slaTarget=${slaTarget}`, '_blank');
  })();

})();
