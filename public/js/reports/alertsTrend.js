(function () {
  const canvas = document.getElementById('canvas');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');
  const openJsonBtn = document.getElementById('openJson');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function getQueryInt(name, fallback, { min, max } = {}) {
    const url = new URL(window.location.href);
    const raw = url.searchParams.get(name);
    const n = Number.parseInt(raw, 10);
    let v = Number.isFinite(n) ? n : fallback;
    if (Number.isFinite(min)) v = Math.max(min, v);
    if (Number.isFinite(max)) v = Math.min(max, v);
    return v;
  }

  function resizeToDisplaySize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  function rgbaArrayToCss(rgba, alphaOverride) {
    const r = Math.round((rgba[0] || 0) * 255);
    const g = Math.round((rgba[1] || 0) * 255);
    const b = Math.round((rgba[2] || 0) * 255);
    const a = (alphaOverride !== undefined) ? alphaOverride : (rgba[3] ?? 1);
    return `rgba(${r},${g},${b},${a})`;
  }

  function draw(data) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas not available');

    resizeToDisplaySize();
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Background grid
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, w, h);

    const pad = Math.floor(Math.min(w, h) * 0.06);
    const plotX = pad;
    const plotY = pad;
    const plotW = w - pad * 2;
    const plotH = h - pad * 2;

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const y = plotY + Math.round((plotH * i) / 5);
      ctx.beginPath();
      ctx.moveTo(plotX, y);
      ctx.lineTo(plotX + plotW, y);
      ctx.stroke();
    }

    const severities = data?.series?.severities || [];
    const points = data?.series?.points || [];
    const palette = data?.renderSpec?.palette || {};

    // Determine max stacked value
    let maxY = 1;
    for (const p of points) {
      const values = p.values || {};
      let sum = 0;
      for (const s of severities) sum += (values[s] || 0);
      maxY = Math.max(maxY, sum);
    }

    // Bars
    const n = Math.max(points.length, 1);
    const gap = Math.max(1, Math.floor(plotW * 0.004));
    const barW = Math.max(2, Math.floor((plotW - gap * (n - 1)) / n));

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const x = plotX + i * (barW + gap);
      let stack = 0;

      for (const s of severities) {
        const count = (p.values && p.values[s]) ? p.values[s] : 0;
        if (!count) continue;

        const y0 = stack;
        stack += count;

        const yA = plotY + plotH - Math.round((y0 / maxY) * plotH);
        const yB = plotY + plotH - Math.round((stack / maxY) * plotH);
        const segH = Math.max(1, yA - yB);

        const rgba = palette[s] || [0.6, 0.65, 0.7, 1.0];
        ctx.fillStyle = rgbaArrayToCss(rgba, 0.85);
        ctx.fillRect(x, yB, barW, segH);
      }
    }

    // Legend
    const legendX = plotX;
    let legendY = plotY + 8;
    ctx.font = `${Math.max(12, Math.floor(w / 85))}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica, Arial, sans-serif`;

    for (const s of severities) {
      const rgba = palette[s] || [0.6, 0.65, 0.7, 1.0];
      ctx.fillStyle = rgbaArrayToCss(rgba, 0.95);
      ctx.fillRect(legendX, legendY - 10, 12, 12);
      ctx.fillStyle = 'rgba(230,238,247,0.92)';
      ctx.fillText(String(s), legendX + 18, legendY);
      legendY += 18;
    }

    // Title/meta text inside plot
    ctx.fillStyle = 'rgba(230,238,247,0.65)';
    ctx.fillText(`max ${maxY}`, plotX + plotW - 70, plotY + 18);
  }

  async function load() {
    const hours = getQueryInt('hours', 24, { min: 1, max: 8760 });
    const bucketMinutes = getQueryInt('bucketMinutes', 60, { min: 5, max: 240 });

    const primaryUrl = `/api/reports/alerts-trend?hours=${encodeURIComponent(hours)}&bucketMinutes=${encodeURIComponent(bucketMinutes)}`;
    const fallbackUrl = `/reports/alerts-trend.json?hours=${encodeURIComponent(hours)}&bucketMinutes=${encodeURIComponent(bucketMinutes)}`;
    let openUrl = primaryUrl;
    openJsonBtn.addEventListener('click', () => window.open(openUrl, '_blank', 'noopener'));

    setStatus('Fetching trend…');

    async function fetchJson(url) {
      const resp = await fetch(url, { credentials: 'include' });
      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      const isJson = contentType.includes('application/json');
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`HTTP ${resp.status} ${resp.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`);
        err.httpStatus = resp.status;
        err.url = url;
        throw err;
      }
      if (!isJson) {
        const text = await resp.text().catch(() => '');
        const err = new Error(`Expected JSON, got ${contentType || 'unknown content-type'}${text ? `: ${text.slice(0, 200)}` : ''}`);
        err.httpStatus = resp.status;
        err.url = url;
        throw err;
      }
      return resp.json();
    }

    let data;
    try {
      data = await fetchJson(primaryUrl);
      openUrl = primaryUrl;
    } catch (e) {
      // If /api is misrouted by a reverse-proxy, use CPM-served JSON under /reports.
      if (e && (e.httpStatus === 404 || e.httpStatus === 502 || e.httpStatus === 503)) {
        data = await fetchJson(fallbackUrl);
        openUrl = fallbackUrl;
      } else {
        // Try the fallback once even for non-JSON edge cases
        try {
          data = await fetchJson(fallbackUrl);
          openUrl = fallbackUrl;
        } catch (e2) {
          throw e;
        }
      }
    }
    const count = data?.series?.points?.length || 0;

    const source = data?.source ? String(data.source) : 'unknown';
    const unit = data?.unit ? String(data.unit) : 'count';

    metaEl.textContent = `${hours}h • ${bucketMinutes}m buckets • ${count} points • ${source} • ${unit}`;

    setStatus('Rendering…');
    draw(data);
    setStatus('Rendered.');
  }

  window.addEventListener('resize', () => {
    try {
      // quick redraw if we already have data: simplest is reload
      // (keeps behavior deterministic & avoids state complexity)
      load();
    } catch (e) {
      console.error(e);
    }
  });

  (async function boot() {
    try {
      await load();
    } catch (e) {
      console.error(e);
      if (metaEl) metaEl.textContent = 'Failed to load trend';
      setStatus(`Error: ${e.message || e}`);
    }
  })();
})();
