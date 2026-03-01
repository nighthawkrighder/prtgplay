/* Flapping / Unstable Devices report viewer */
(function () {
  'use strict';

  const hoursEl   = document.getElementById('hours');
  const limitEl   = document.getElementById('limit');
  const runBtn    = document.getElementById('run');
  const openJson  = document.getElementById('openJson');
  const tbody     = document.getElementById('tableBody');
  const canvas    = document.getElementById('mainCanvas');
  const metaEl    = document.getElementById('meta');
  const statusBar = document.getElementById('statusBar');

  function setStatus(html, busy) {
    statusBar.innerHTML = busy
      ? '<span class="spinner"></span>' + html
      : html;
  }

  function fmt(n, d) { return typeof n === 'number' ? n.toFixed(d ?? 1) : '—'; }

  /* ── volatility badge colors ──────────────────────────────── */
  const VOL_COLOR = {
    Critical : { bg: 'rgba(231,76,60,.18)',   bd: 'rgba(231,76,60,.40)',    fg: '#ff7f72' },
    High     : { bg: 'rgba(230,126,34,.18)',  bd: 'rgba(230,126,34,.40)',   fg: '#f7b267' },
    Moderate : { bg: 'rgba(243,156,18,.18)',  bd: 'rgba(243,156,18,.40)',   fg: '#f7c870' },
    Low      : { bg: 'rgba(46,204,113,.14)', bd: 'rgba(46,204,113,.35)',   fg: '#67e8a0' },
  };
  function volBadge(label) {
    const c = VOL_COLOR[label] || VOL_COLOR.Low;
    return `<span class="badge" style="background:${c.bg};border-color:${c.bd};color:${c.fg}">${label}</span>`;
  }

  /* ── chart: horizontal bar ranked by stddev ───────────────── */
  function drawChart(devices) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W   = canvas.clientWidth  || 700;
    const H   = canvas.clientHeight || 460;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 16, right: 24, bottom: 30, left: 60 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!devices.length) {
      ctx.fillStyle = 'rgba(230,238,247,.35)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No data', W / 2, H / 2);
      return;
    }

    const data = devices.slice(0, 20);
    const maxSd = Math.max(...data.map(d => d.stddev || 0), 1);
    const barH  = Math.min(22, (cH / data.length) - 4);
    const gap   = (cH - data.length * barH) / (data.length + 1);

    /* axis ticks */
    const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(f => f * maxSd);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth  = 1;
    ticks.forEach(v => {
      const x = PAD.left + (v / maxSd) * cW;
      ctx.beginPath(); ctx.moveTo(x, PAD.top); ctx.lineTo(x, PAD.top + cH); ctx.stroke();
      ctx.fillStyle = 'rgba(230,238,247,.30)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(fmt(v), x, PAD.top + cH + 14);
    });

    const VOL_BAR = {
      Critical: '#e74c3c', High: '#e67e22', Moderate: '#f1c40f', Low: '#2ecc71'
    };

    data.forEach((d, i) => {
      const y    = PAD.top + gap + i * (barH + gap);
      const w    = Math.max(((d.stddev || 0) / maxSd) * cW, 2);
      const clr  = VOL_BAR[d.volatilityLabel] || '#3498db';

      const grad = ctx.createLinearGradient(PAD.left, 0, PAD.left + w, 0);
      grad.addColorStop(0, clr + '40');
      grad.addColorStop(1, clr + 'cc');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect(PAD.left, y, w, barH, 3);
      ctx.fill();

      /* min-max range tick */
      if (d.minHealth != null && d.maxHealth != null) {
        const x1 = PAD.left + (d.minHealth / 100) * cW;
        const x2 = PAD.left + (d.maxHealth / 100) * cW;
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x1, y + barH / 2); ctx.lineTo(x2, y + barH / 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(x1, y + 2, 1, barH - 4);
        ctx.fillRect(x2 - 1, y + 2, 1, barH - 4);
      }

      /* σ label */
      ctx.fillStyle = '#e6eef7';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText('σ ' + fmt(d.stddev), PAD.left + w + 4, y + barH / 2 + 4);

      /* device name */
      ctx.fillStyle = 'rgba(230,238,247,.60)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      const nm = (d.deviceName || 'Unknown');
      const label = nm.length > 14 ? nm.slice(0, 13) + '…' : nm;
      ctx.fillText(label, PAD.left - 5, y + barH / 2 + 4);
    });
  }

  /* ── table ─────────────────────────────────────────────────── */
  function renderTable(devices) {
    tbody.innerHTML = devices.map((d, i) => `<tr>
      <td style="color:rgba(230,238,247,.40)">${i + 1}</td>
      <td>${d.deviceName || '—'}</td>
      <td style="color:rgba(230,238,247,.60)">${d.company || '—'}</td>
      <td style="font-weight:600">${fmt(d.avgHealth)}%</td>
      <td style="font-weight:600;color:#f39c12">${fmt(d.stddev)}</td>
      <td>${d.minHealth != null ? fmt(d.minHealth) + '% – ' + fmt(d.maxHealth) + '%' : '—'}</td>
      <td>${volBadge(d.volatilityLabel || 'Low')}</td>
      <td>${d.badBuckets ?? '—'}</td>
    </tr>`).join('');
  }

  /* ── load ──────────────────────────────────────────────────── */
  async function load() {
    const hours = parseInt(hoursEl.value, 10);
    const limit = parseInt(limitEl.value, 10);
    openJson.onclick = () => window.open(
      `/api/reports/flapping-devices?hours=${hours}&limit=${limit}`, '_blank');

    setStatus('Fetching instability data…', true);
    let data;
    try {
      const r = await fetch(
        `/api/reports/flapping-devices?hours=${hours}&limit=${limit}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }

    const devices = data.devices || [];
    drawChart(devices);
    renderTable(devices);

    const label = hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `${devices.length} unstable devices · last ${label}`;
    setStatus(`Loaded ${devices.length} flapping devices`, false);
  }

  runBtn.addEventListener('click', load);
  window.addEventListener('resize', () => { if (window._flapDevices) drawChart(window._flapDevices); });

  /* initial load */
  (async function init() {
    const hours = parseInt(hoursEl.value, 10);
    const limit = parseInt(limitEl.value, 10);
    setStatus('Fetching instability data…', true);
    let data;
    try {
      const r = await fetch(
        `/api/reports/flapping-devices?hours=${hours}&limit=${limit}`,
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }
    const devices = data.devices || [];
    window._flapDevices = devices;
    drawChart(devices);
    renderTable(devices);
    const label = hours >= 168 ? `${Math.round(hours / 168)} wk` : `${hours} h`;
    metaEl.textContent = `${devices.length} unstable devices · last ${label}`;
    setStatus(`Loaded ${devices.length} flapping devices`, false);
    openJson.onclick = () => window.open(
      `/api/reports/flapping-devices?hours=${hours}&limit=${limit}`, '_blank');
  })();

})();
