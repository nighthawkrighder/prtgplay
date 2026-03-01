(function () {
  const canvas = document.getElementById('canvas');
  const metaEl = document.getElementById('meta');
  const statusEl = document.getElementById('status');

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function toRGB(colorsRgba) {
    // colorsRgba length = 4 * n; return Float32Array length = 3 * n
    const n = Math.floor(colorsRgba.length / 4);
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      rgb[i * 3 + 0] = colorsRgba[i * 4 + 0];
      rgb[i * 3 + 1] = colorsRgba[i * 4 + 1];
      rgb[i * 3 + 2] = colorsRgba[i * 4 + 2];
    }
    return rgb;
  }

  if (typeof THREE === 'undefined') {
    setStatus('THREE.js not loaded');
    return;
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
  camera.position.set(0, 0, 55);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);

  const grid = new THREE.GridHelper(120, 24, 0x223044, 0x172230);
  grid.material.opacity = 0.25;
  grid.material.transparent = true;
  scene.add(grid);

  let graphGroup = null;

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  window.addEventListener('resize', resize);

  async function load() {
    setStatus('Fetching graph…');

    const resp = await fetch('/api/reports/company-device-health-graph', { credentials: 'include' });
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
    const nodesCount = data?.graph?.nodes?.length || 0;
    const edgesCount = data?.graph?.edges?.length || 0;

    metaEl.textContent = `${nodesCount} nodes • ${edgesCount} edges • deterministic seed ${data?.renderSpec?.seed ?? 'n/a'}`;

    const buffers = data?.renderSpec?.buffers;
    if (!buffers || !Array.isArray(buffers.positions) || !Array.isArray(buffers.colors)) {
      throw new Error('Missing renderSpec.buffers in response');
    }

    const positions = new Float32Array(buffers.positions);
    const colorsRgb = toRGB(new Float32Array(buffers.colors));

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colorsRgb, 3));

    if (Array.isArray(buffers.indices) && buffers.indices.length > 0) {
      geometry.setIndex(buffers.indices);
    }

    const group = new THREE.Group();

    // Lines (edges)
    const lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35 });
    const lines = new THREE.LineSegments(geometry, lineMaterial);
    group.add(lines);

    // Points (nodes)
    const pointMaterial = new THREE.PointsMaterial({ size: 0.65, vertexColors: true, transparent: true, opacity: 0.95 });
    const points = new THREE.Points(geometry, pointMaterial);
    group.add(points);

    // Fit camera roughly based on bounding sphere
    geometry.computeBoundingSphere();
    const bs = geometry.boundingSphere;
    if (bs && bs.radius) {
      controls.target.copy(bs.center);
      camera.position.set(bs.center.x, bs.center.y, bs.center.z + Math.max(35, bs.radius * 2.2));
      camera.lookAt(bs.center);
      controls.update();
    }

    if (graphGroup) scene.remove(graphGroup);
    graphGroup = group;
    scene.add(group);

    setStatus('Rendered. Drag to orbit, scroll to zoom.');
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  (async function boot() {
    try {
      resize();
      animate();
      await load();
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e.message || e}`);
      if (metaEl) metaEl.textContent = 'Failed to load graph';
    }
  })();
})();
