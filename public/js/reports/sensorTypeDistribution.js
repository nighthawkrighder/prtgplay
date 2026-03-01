/* Sensor Type Distribution report viewer */
(function () {
  'use strict';

  const openJson  = document.getElementById('openJson');
  const kpiRow    = document.getElementById('kpiRow');
  const tbody     = document.getElementById('tableBody');
  const canvas    = document.getElementById('mainCanvas');
  const metaEl    = document.getElementById('meta');
  const statusBar = document.getElementById('statusBar');

  function setStatus(html, busy) {
    statusBar.innerHTML = busy
      ? '<span class="spinner"></span>' + html
      : html;
  }

  function fmt(n) { return typeof n === 'number' ? n.toLocaleString() : '—'; }
  function pct(n, total) {
    if (!total) return '0.0%';
    return (n / total * 100).toFixed(1) + '%';
  }

  function kpi(label, val, color) {
    return `<div class="kpi">
      <div class="label">${label}</div>
      <div class="val" style="color:${color||'#e6eef7'}">${val}</div>
    </div>`;
  }

  /* status palette */
  const STATUS_COLORS = {
    up     : '#2ecc71',
    warning: '#f1c40f',
    down   : '#e74c3c',
    paused : '#9b59b6',
    other  : '#7f8c8d',
  };

  /* type palette — cycle through these for the 20+ possible types */
  const TYPE_PALETTE = [
    '#3498db','#2ecc71','#e74c3c','#f39c12','#9b59b6',
    '#1abc9c','#e67e22','#34495e','#16a085','#8e44ad',
    '#d35400','#27ae60','#2980b9','#c0392b','#7f8c8d',
    '#f1c40f','#e91e63','#00bcd4','#ff5722','#607d8b',
  ];

  /* ── stacked horizontal bar chart ────────────────────────── */
  function drawChart(types) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W   = canvas.clientWidth || 700;
    /* dynamic height — 30px per type, min 300 */
    const H   = Math.max(300, 50 + types.length * 34);
    canvas.style.height = H + 'px';
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const PAD = { top: 16, right: 120, bottom: 20, left: 170 };
    const cW  = W - PAD.left - PAD.right;
    const cH  = H - PAD.top  - PAD.bottom;

    ctx.clearRect(0, 0, W, H);

    if (!types.length) {
      ctx.fillStyle = 'rgba(230,238,247,.35)';
      ctx.font = '13px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('No sensor data', W / 2, H / 2);
      return;
    }

    const maxTotal = Math.max(...types.map(t => t.total), 1);
    const barH = Math.min(22, (cH / types.length) - 4);
    const gap  = (cH - types.length * barH) / (types.length + 1);
    const statuses = ['up', 'warning', 'down', 'paused', 'other'];

    types.forEach((t, i) => {
      const y    = PAD.top + gap + i * (barH + gap);
      let   xOff = PAD.left;

      statuses.forEach(s => {
        const cnt = t[s] || 0;
        const w   = (cnt / maxTotal) * cW;
        if (w < 0.5) return;
        ctx.fillStyle = STATUS_COLORS[s] + 'cc';
        ctx.beginPath();
        ctx.roundRect(xOff, y, w, barH, i === 0 && xOff === PAD.left ? 3 : 0);
        ctx.fill();
        xOff += w;
      });

      /* type name */
      ctx.fillStyle = 'rgba(230,238,247,.70)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'right';
      const label = t.sensorType.length > 22 ? t.sensorType.slice(0, 21) + '…' : t.sensorType;
      ctx.fillText(label, PAD.left - 6, y + barH / 2 + 4);

      /* total count */
      ctx.fillStyle = '#e6eef7';
      ctx.font = '11px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(fmt(t.total), PAD.left + cW + 6, y + barH / 2 + 4);
    });

    /* legend */
    const legY = H - 10;
    statuses.forEach((s, i) => {
      const lx = PAD.left + i * 90;
      ctx.fillStyle = STATUS_COLORS[s] + 'cc';
      ctx.fillRect(lx, legY - 8, 10, 10);
      ctx.fillStyle = 'rgba(230,238,247,.55)';
      ctx.font = '10px system-ui';
      ctx.textAlign = 'left';
      ctx.fillText(s[0].toUpperCase() + s.slice(1), lx + 13, legY);
    });
  }

  /* ── table ─────────────────────────────────────────────────── */
  function renderTable(types) {
    tbody.innerHTML = types.map((t, i) => `<tr>
      <td><span class="swatch" style="background:${TYPE_PALETTE[i % TYPE_PALETTE.length]}"></span>${t.sensorType}</td>
      <td style="font-weight:600">${fmt (t.total)}</td>
      <td style="color:#2ecc71">${fmt(t.up)}     <span style="color:rgba(230,238,247,.35)"> / ${pct(t.up,     t.total)}</span></td>
      <td style="color:#f1c40f">${fmt(t.warning)} <span style="color:rgba(230,238,247,.35)"> / ${pct(t.warning,t.total)}</span></td>
      <td style="color:#e74c3c">${fmt(t.down)}    <span style="color:rgba(230,238,247,.35)"> / ${pct(t.down,   t.total)}</span></td>
      <td style="color:#9b59b6">${fmt(t.paused)}  <span style="color:rgba(230,238,247,.35)"> / ${pct(t.paused, t.total)}</span></td>
    </tr>`).join('');
  }

  /* ── init ──────────────────────────────────────────────────── */
  (async function init() {
    setStatus('Fetching sensor distribution…', true);
    let data;
    try {
      const r = await fetch('/api/reports/sensor-type-distribution',
        { credentials: 'include' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      data = await r.json();
    } catch (e) {
      setStatus('Error: ' + e.message, false);
      return;
    }

    const types    = data.types     || [];
    const grand    = data.grandTotal || {};
    const total    = grand.total    || 0;

    kpiRow.innerHTML = [
      kpi('Sensor Types',   types.length,        '#3498db'),
      kpi('Total Sensors',  fmt(total),           '#e6eef7'),
      kpi('Up',             fmt(grand.up     || 0) + ' / ' + pct(grand.up     || 0, total), '#2ecc71'),
      kpi('Warning',        fmt(grand.warning|| 0) + ' / ' + pct(grand.warning|| 0, total), '#f1c40f'),
      kpi('Down',           fmt(grand.down   || 0) + ' / ' + pct(grand.down   || 0, total), '#e74c3c'),
    ].join('');

    drawChart(types);
    renderTable(types);

    metaEl.textContent = `${types.length} sensor types · ${fmt(total)} sensors total`;
    setStatus(`${types.length} sensor types · ${fmt(total)} sensors`, false);

    openJson.onclick = () => window.open('/api/reports/sensor-type-distribution', '_blank');

    /* resize */
    window.addEventListener('resize', () => { drawChart(types); });
  })();

})();
