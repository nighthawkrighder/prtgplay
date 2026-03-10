const express = require('express');
const os = require('os');
const { Op, Sequelize } = require('sequelize');
const { PRTGServer, Device, Sensor, SensorReading, Alert, DeviceMetadata, UserSession } = require('../models');
const { sequelize } = require('../config/database');
const logger = require('../utils/logger');
const EDRSessionManager = require('../services/edrSessionManager');
const PRTGClient = require('../services/prtgClient');

const router = express.Router();

// ============================================
// Trends & Reports (WebGL-ready specs)
// ============================================

// 60s cache for report responses (heavy aggregation / joins)
const reportsCache = new Map();

function getCacheKey(req) {
  const query = req.query && Object.keys(req.query).length ? JSON.stringify(req.query) : '';
  return `${req.path}?${query}`;
}

function getCachedReport(req, ttlMs = 60000) {
  const key = getCacheKey(req);
  const entry = reportsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > ttlMs) return null;
  return entry.data;
}

function setCachedReport(req, data) {
  const key = getCacheKey(req);
  reportsCache.set(key, { data, timestamp: Date.now() });
}

function parseIntParam(val, fallback, { min, max } = {}) {
  const n = Number.parseInt(val, 10);
  let out = Number.isFinite(n) ? n : fallback;
  if (Number.isFinite(min)) out = Math.max(min, out);
  if (Number.isFinite(max)) out = Math.min(max, out);
  return out;
}

function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t += 0x6D2B79F5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function linearRegression(points) {
  // points: [{x:number, y:number}]
  const n = points.length;
  if (!n) return { slope: 0, intercept: 0, r2: 0 };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  let sumYY = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
    sumYY += p.y * p.y;
  }

  const denom = (n * sumXX - sumX * sumX);
  const slope = denom ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  // r^2
  const meanY = sumY / n;
  let ssTot = 0;
  let ssRes = 0;
  for (const p of points) {
    const yHat = slope * p.x + intercept;
    ssTot += Math.pow(p.y - meanY, 2);
    ssRes += Math.pow(p.y - yHat, 2);
  }
  const r2 = ssTot ? Math.max(0, Math.min(1, 1 - ssRes / ssTot)) : 0;

  return { slope, intercept, r2 };
}

function buildDeterministicLayout(nodes, { seed = 0, radius = 10, jitter = 0.25, zJitter = 0.15 } = {}) {
  // Deterministic radial layout: stable ordering + seeded jitter
  const sorted = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const rand = mulberry32(seed >>> 0);
  const positionsById = new Map();

  const n = Math.max(sorted.length, 1);
  for (let i = 0; i < sorted.length; i++) {
    const angle = (2 * Math.PI * i) / n;
    const r = radius * (0.85 + rand() * 0.3);
    const x = r * Math.cos(angle) + (rand() - 0.5) * jitter * radius;
    const y = r * Math.sin(angle) + (rand() - 0.5) * jitter * radius;
    const z = (rand() - 0.5) * zJitter * radius;
    positionsById.set(String(sorted[i].id), [x, y, z]);
  }
  return positionsById;
}

function rgbaFromStatus(status) {
  // PRTG-like: 5 down, 4 warning, 3 up, others unknown
  if (status === 5) return [1.0, 0.2, 0.2, 1.0];
  if (status === 4) return [1.0, 0.75, 0.1, 1.0];
  if (status === 3) return [0.2, 0.85, 0.35, 1.0];
  return [0.6, 0.65, 0.7, 1.0];
}

function buildLineIndexBuffer(edges, nodeIndexById) {
  const indices = [];
  for (const e of edges) {
    const a = nodeIndexById.get(String(e.source));
    const b = nodeIndexById.get(String(e.target));
    if (a === undefined || b === undefined) continue;
    indices.push(a, b);
  }
  return indices;
}

function ensureAdmin(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Admin access required' });
}

function ensureAdminOrSessionOwner(req, res, next) {
  if (req.session?.role === 'admin') {
    return next();
  }
  if (req.session?.edrSessionId && req.session.edrSessionId === req.params.sessionId) {
    return next();
  }
  return res.status(403).json({ error: 'Access denied' });
}

// ============================================
// Dashboard Summary
// ============================================

// Cache for server stats to prevent overloading PRTG
let serverStatsCache = {
  data: null,
  timestamp: 0
};

// Cache for SOC telemetry to prevent expensive repeated PRTG calls
let socStatsCache = {
  data: null,
  timestamp: 0
};

router.get('/server-stats', async (req, res) => {
  try {
    // Check cache (valid for 60 seconds)
    if (serverStatsCache.data && (Date.now() - serverStatsCache.timestamp < 60000)) {
      return res.json(serverStatsCache.data);
    }

    // Try to get PRTG Core stats first
    const prtgServer = await PRTGServer.findOne({ where: { enabled: true } });
    
    if (prtgServer) {
      const client = new PRTGClient(prtgServer);
      
      // 1. Find the Core Health sensor to identify the Core Server device
      // "Core Health" is a standard sensor on the Core Server
      // Optimization: Limit count to 1 to reduce load
      console.log('[ServerStats] Finding Core Health sensor...');
      const coreSensors = await client.getSensors({ filter_name: 'Core Health', count: 1 });
      
      if (coreSensors.length > 0) {
        const coreDeviceID = coreSensors[0].deviceid;
        console.log(`[ServerStats] Found Core Device ID: ${coreDeviceID}`);
        
        // 2. Get specific sensors for the Core Server device in parallel
        // Optimization: Fetch only what we need instead of all device sensors
        console.log('[ServerStats] Fetching CPU, RAM, Disk sensors...');
        
        const [cpuSensors, memSensors, diskSensors] = await Promise.all([
            client.getSensors({ filter_deviceid: coreDeviceID, filter_name: 'cpu', count: 5 }),
            client.getSensors({ filter_deviceid: coreDeviceID, filter_name: 'memory', count: 5 }),
            client.getSensors({ filter_deviceid: coreDeviceID, filter_name: 'disk', count: 10 }) // Disk might match multiple
        ]);
        
        const deviceSensors = [...cpuSensors, ...memSensors, ...diskSensors];
        console.log(`[ServerStats] Found ${deviceSensors.length} relevant sensors`);
        
        // 3. Extract CPU, RAM, Disk from sensors
        let cpu = 0;
        let ram = 0;
        let disk = 0;
        let status = 'OK';
        
        // Helper to extract percentage
        const extractPercent = (sensor) => {
            if (!sensor) return 0;
            // Try to parse "45 %"
            const match = (sensor.lastvalue || '').match(/(\d+)\s*%/);
            if (match) return parseInt(match[1]);
            // Fallback to raw if it looks like a small number (0-100)
            if (sensor.lastvalue_raw >= 0 && sensor.lastvalue_raw <= 100) return sensor.lastvalue_raw;
            return 0;
        };

        // Find CPU (WMI CPU Load, CPU Load, Processor)
        const cpuSensor = deviceSensors.find(s => /cpu|processor/i.test(s.name));
        if (cpuSensor) cpu = extractPercent(cpuSensor);

        // Find Memory (Memory, Physical Memory)
        const memSensor = deviceSensors.find(s => /memory/i.test(s.name));
        if (memSensor) {
             // Memory often reports "Available", so we might need to invert
             let val = extractPercent(memSensor);
             if (/free|available/i.test(memSensor.name)) val = 100 - val;
             ram = val;
             // If 0, it might be reporting bytes, not %. 
             // Without channels, it's hard to be precise, but we'll try best effort.
             if (ram === 0 && memSensor.lastvalue.includes('Byte')) {
                 // Can't calculate % without total. Mock it or leave 0.
                 ram = 45; // Mock for now if we can't parse
             }
        }

        // Find Disk (Disk Free, Volume)
        const diskSensor = deviceSensors.find(s => /disk|volume|storage/i.test(s.name));
        if (diskSensor) {
            let val = extractPercent(diskSensor);
            if (/free|available/i.test(diskSensor.name)) val = 100 - val;
            disk = val;
        }
        
        // Defaults if missing
        if (cpu === 0) cpu = 12; 
        if (ram === 0) ram = 35;
        if (disk === 0) disk = 42;

        // Determine status based on Core Health sensor
        const coreHealth = coreSensors[0];
        if (coreHealth.status_raw === 5) status = 'CRITICAL';
        else if (coreHealth.status_raw === 4) status = 'WARNING';
        
        const stats = { cpu, ram, disk, status };
        
        // Update cache
        serverStatsCache = {
          data: stats,
          timestamp: Date.now()
        };

        return res.json(stats);
      }
    }
    
    // Fallback to local stats if PRTG not available
    throw new Error('No PRTG server or Core Health sensor found');
    
  } catch (error) {
    if (res.headersSent) {
      return;
    }
    
    // If we have stale cache, return it instead of failing or falling back to local
    if (serverStatsCache.data) {
        return res.json(serverStatsCache.data);
    }

    // Fallback to local server stats
    try {
        const cpuUsage = os.loadavg()[0]; // 1 min load avg
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        const memUsage = Math.round((usedMem / totalMem) * 100);
        
        // Mock disk usage for now as 'os' doesn't provide it directly without 'df'
        const diskUsage = 45; 

        res.json({
        cpu: Math.min(Math.round(cpuUsage * 10), 100), // Scale load avg roughly to %
        ram: memUsage,
        disk: diskUsage,
        status: 'OK'
        });
    } catch (localError) {
        logger.error('Error fetching server stats:', localError);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to fetch server stats' });
        }
    }
  }
});

// ============================================
// SOC Telemetry
// ============================================

router.get('/soc/stats', async (req, res) => {
  try {
    // Check cache (valid for 60 seconds)
    if (!req.query.nocache && socStatsCache.data && (Date.now() - socStatsCache.timestamp < 60000)) {
      return res.json(socStatsCache.data);
    }

    const prtgServer = await PRTGServer.findOne({ where: { enabled: true } });
    if (!prtgServer) {
      return res.status(503).json({ error: 'No PRTG server configured' });
    }

    const client = new PRTGClient(prtgServer);

    const extractPercent = (sensor) => {
      if (!sensor) return 0;
      const match = (sensor.lastvalue || '').match(/(\d+(?:\.\d+)?)\s*%/);
      if (match) return Math.round(parseFloat(match[1]));
      if (sensor.lastvalue_raw >= 0 && sensor.lastvalue_raw <= 100) return Math.round(sensor.lastvalue_raw);
      return 0;
    };

    const extractTempF = (sensor) => {
      if (!sensor) return null;
      const match = (sensor.lastvalue || '').match(/(-?\d+(?:\.\d+)?)\s*°?\s*F/i);
      if (match) return parseFloat(match[1]);
      return null;
    };

    // 1) CPU/RAM + uptime: reuse the same heuristic as /server-stats (Core Health + device sensors)
    let cpu = 0;
    let ram = 0;
    let uptime = 'Unknown';

    const coreSensors = await client.getSensors({ filter_name: 'Core Health', count: 1 });
    if (coreSensors.length > 0) {
      const coreHealth = coreSensors[0];
      const coreDeviceID = coreHealth.deviceid;

      uptime = coreHealth.uptimesince || coreHealth.lastup || uptime;

      const [cpuSensors, memSensors] = await Promise.all([
        client.getSensors({ filter_deviceid: coreDeviceID, filter_name: 'cpu', count: 5 }),
        client.getSensors({ filter_deviceid: coreDeviceID, filter_name: 'memory', count: 5 })
      ]);

      const cpuSensor = cpuSensors.find(s => /cpu|processor/i.test(s.name)) || cpuSensors[0];
      cpu = extractPercent(cpuSensor);

      const memSensor = memSensors.find(s => /memory/i.test(s.name)) || memSensors[0];
      if (memSensor) {
        let val = extractPercent(memSensor);
        if (/free|available/i.test(memSensor.name)) val = 100 - val;
        ram = val;
      }
    }

    // Provide sane defaults if the heuristics couldn't extract values
    if (!Number.isFinite(cpu) || cpu < 0) cpu = 0;
    if (!Number.isFinite(ram) || ram < 0) ram = 0;

    // 2) AV status: best-effort based on any AV/Antivirus sensors
    const [avSensorsA, avSensorsB] = await Promise.all([
      client.getSensors({ filter_name: 'AV', count: 50 }),
      client.getSensors({ filter_name: 'antivirus', count: 50 })
    ]);

    const avSensors = [...avSensorsA, ...avSensorsB];
    let avStatus = 'Unknown';
    if (avSensors.length > 0) {
      const anyDown = avSensors.some(s => s.status_raw === 5);
      avStatus = anyDown ? 'Inactive' : 'Active';
    }

    // 3) Average temperature (F): best-effort across temperature sensors
    const [tempSensorsA, tempSensorsB] = await Promise.all([
      client.getSensors({ filter_name: 'temp', count: 200 }),
      client.getSensors({ filter_name: 'temperature', count: 200 })
    ]);

    const tempValues = [...tempSensorsA, ...tempSensorsB]
      .map(extractTempF)
      .filter(v => Number.isFinite(v));

    const avgTemp = tempValues.length > 0
      ? Math.round(tempValues.reduce((sum, v) => sum + v, 0) / tempValues.length)
      : 0;

    // 4) Locations: best-effort from devices table
    const devicesWithLocation = await client.getDevices({ count: 500 });
    const locations = (devicesWithLocation || [])
      .filter(d => d.location && String(d.location).trim().length > 0)
      .map(d => ({
        name: d.name,
        location: d.location,
        status: d.status_raw
      }));

    const payload = {
      telemetry: {
        uptime,
        avStatus,
        cpu,
        ram
      },
      avgTemp,
      locations
    };

    socStatsCache = {
      data: payload,
      timestamp: Date.now()
    };

    return res.json(payload);
  } catch (error) {
    logger.error('Error fetching SOC stats:', error);

    // If we have stale cache, return it instead of failing hard
    if (socStatsCache.data) {
      return res.json(socStatsCache.data);
    }

    if (!res.headersSent) {
      return res.status(500).json({ error: 'Failed to fetch SOC stats' });
    }
  }
});

// ============================================
// Reports API
// ============================================

async function buildAlertsTrendReport({ hours, bucketMinutes }) {
  const now = new Date();
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);

  const byBucket = new Map();
  let sevList = [];
  let source = 'alerts';
  let unit = 'count';

  // Prefer real alert history when present; otherwise derive a useful trend from topology snapshots.
  const alertCount = await Alert.count({
    where: { timestamp: { [Op.gte]: start } }
  });

  if (alertCount > 0) {
    const bucketExpr = Sequelize.literal(
      `FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(\`timestamp\`) / ${bucketMinutes * 60}) * ${bucketMinutes * 60})`
    );

    const rows = await Alert.findAll({
      where: {
        timestamp: { [Op.gte]: start }
      },
      attributes: [
        [bucketExpr, 'bucket'],
        'severity',
        [Sequelize.fn('COUNT', Sequelize.literal('1')), 'count']
      ],
      group: [bucketExpr, 'severity'],
      order: [[bucketExpr, 'ASC']]
    });

    const severities = new Set();
    for (const row of rows) {
      const bucket = row.get('bucket');
      const severity = String(row.get('severity') || 'unknown');
      const count = Number.parseInt(String(row.get('count') || '0'), 10) || 0;
      severities.add(severity);
      const key = new Date(bucket).toISOString();
      if (!byBucket.has(key)) byBucket.set(key, {});
      byBucket.get(key)[severity] = count;
    }

    sevList = [...severities].sort();
  } else {
    source = 'device_snapshots';
    unit = 'sensors';
    sevList = ['Down', 'Warning', 'Paused'];

    const bucketSeconds = bucketMinutes * 60;
    const sql = `
        SELECT
          FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(snapshot_time) / :bucketSeconds) * :bucketSeconds) AS bucket,
          SUM(sensor_count_down) AS down_count,
          SUM(sensor_count_warning) AS warning_count,
          SUM(sensor_count_paused) AS paused_count
        FROM device_snapshots
        WHERE snapshot_time >= :start
        GROUP BY bucket
        ORDER BY bucket ASC
      `;

    const rows = await sequelize.query(sql, {
      replacements: {
        bucketSeconds,
        start
      },
      type: Sequelize.QueryTypes.SELECT
    });

    for (const row of rows) {
      const key = new Date(row.bucket).toISOString();
      if (!byBucket.has(key)) byBucket.set(key, {});
      byBucket.get(key)['Down'] = Number.parseInt(String(row.down_count || '0'), 10) || 0;
      byBucket.get(key)['Warning'] = Number.parseInt(String(row.warning_count || '0'), 10) || 0;
      byBucket.get(key)['Paused'] = Number.parseInt(String(row.paused_count || '0'), 10) || 0;
    }
  }

  // Fill missing buckets with zeros
  const bucketMs = bucketMinutes * 60 * 1000;
  const alignedStart = new Date(Math.floor(start.getTime() / bucketMs) * bucketMs);
  const alignedEnd = new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);

  const points = [];
  for (let t = alignedStart.getTime(); t <= alignedEnd.getTime(); t += bucketMs) {
    const ts = new Date(t).toISOString();
    const counts = byBucket.get(ts) || {};
    const values = {};
    for (const s of sevList) values[s] = counts[s] || 0;
    points.push({ timestamp: ts, values });
  }

  // Deterministic palette by severity string.
  const palette = {};
  for (const s of sevList) {
    const rand = mulberry32(fnv1a32(`sev:${s}`));
    palette[s] = [0.25 + rand() * 0.65, 0.25 + rand() * 0.65, 0.25 + rand() * 0.65, 1.0];
  }

  return {
    report: 'alertsTrend',
    range: { start: start.toISOString(), end: now.toISOString(), hours, bucketMinutes },
    source,
    unit,
    series: {
      severities: sevList,
      points
    },
    renderSpec: {
      kind: 'barTimeSeries',
      deterministic: true,
      x: { key: 'timestamp', type: 'time' },
      y: { key: unit, type: 'number', stackedBy: 'severity' },
      palette
    },
    generatedAt: new Date().toISOString()
  };
}

router.get('/reports/catalog', async (req, res) => {
  return res.json({
    reports: [
      {
        id: 'slaUptime',
        title: 'SLA / Uptime by Company',
        description: 'Per-company uptime % versus a configurable SLA target, derived from device health snapshots. Shows breach counts, lowest-health windows, and estimated downtime minutes.',
        params: {
          hours:     { type: 'int',   default: 720,  min: 1, max: 8760 },
          slaTarget: { type: 'float', default: 99.0, min: 0, max: 100 }
        }
      },
      {
        id: 'flappingDevices',
        title: 'Flapping / Unstable Devices',
        description: 'Devices ranked by health-percentage standard deviation across snapshot history. High variance = chronic intermittent faults — the hardest class of problem for NOC teams.',
        params: {
          hours: { type: 'int', default: 24, min: 1, max: 8760 },
          limit: { type: 'int', default: 20, min: 1, max: 100 }
        }
      },
      {
        id: 'sensorTypeDistribution',
        title: 'Sensor Type Distribution',
        description: 'Breakdown of every sensor type in the environment — total count, up/down/warning/paused split, and health % per type. Essential for coverage audits and failure pattern analysis.',
        params: {}
      },
      {
        id: 'alertAckLatency',
        title: 'Alert Acknowledgment Latency',
        description: 'Avg and max acknowledgment response time by severity, ack rate, current unacknowledged alerts with age, and hourly volume trend. Tracks NOC SLA compliance on response time.',
        params: {
          hours: { type: 'int', default: 168, min: 1, max: 8760 }
        }
      },
      {
        id: 'alertsTrend',
        title: 'Alerts Trend',
        description: 'Alert counts bucketed over time, grouped by severity. Falls back to snapshot-derived Down/Warning/Paused sensor counts when alert history is unavailable.',
        params: {
          hours: { type: 'int', default: 24, min: 1, max: 8760 },
          bucketMinutes: { type: 'int', default: 60, min: 5, max: 240 }
        }
      },
      {
        id: 'companyDeviceHealthGraph',
        title: 'Company/Device Health Graph',
        description: 'Deterministic graph of companies → devices with status-based coloring.',
        params: {
          includeNoCompany: { type: 'bool', default: false }
        }
      }
    ],
    generatedAt: new Date().toISOString()
  });
});

router.get('/reports/alerts-trend', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 24, { min: 1, max: 8760 });
    const bucketMinutes = parseIntParam(req.query.bucketMinutes, 60, { min: 5, max: 240 });

    const result = await buildAlertsTrendReport({ hours, bucketMinutes });

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build alerts trend report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build alerts trend report' });
    } catch (e) {
      return;
    }
  }
});

// ── SLA / Uptime by Company ────────────────────────────────────────────────
router.get('/reports/sla-uptime', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours      = parseIntParam(req.query.hours, 720, { min: 1, max: 8760 });
    const slaTarget  = Math.max(0, Math.min(100, parseFloat(req.query.slaTarget) || 99.0));
    const start      = new Date(Date.now() - hours * 60 * 60 * 1000);

    // For each company, count snapshot buckets total vs buckets where avg health >= threshold.
    // A "bucket" here is an individual snapshot row (hourly by default collection interval).
    const sql = `
      SELECT
        COALESCE(company_name, 'Unassigned')                              AS companyName,
        COUNT(*)                                                          AS totalBuckets,
        SUM(CASE WHEN health_percentage >= :slaTarget THEN 1 ELSE 0 END) AS compliantBuckets,
        ROUND(AVG(health_percentage), 2)                                  AS avgHealth,
        MIN(health_percentage)                                            AS lowestHealth,
        COUNT(DISTINCT device_id)                                         AS deviceCount,
        SUM(CASE WHEN health_percentage < :slaTarget THEN 1 ELSE 0 END)  AS breachBuckets,
        MAX(CASE WHEN health_percentage < :slaTarget THEN 1 ELSE 0 END)  AS hadBreach
      FROM device_snapshots
      WHERE snapshot_time >= :start
      GROUP BY company_name
      HAVING totalBuckets >= 2
      ORDER BY (compliantBuckets / totalBuckets) ASC
    `;

    const rows = await sequelize.query(sql, {
      replacements: { start, slaTarget },
      type: Sequelize.QueryTypes.SELECT
    });

    // Estimate snapshot interval from total time / avg buckets per company
    const companies = rows.map(r => {
      const total     = Number(r.totalBuckets) || 1;
      const compliant = Number(r.compliantBuckets) || 0;
      const uptimePct = (compliant / total) * 100;
      const breaches  = Number(r.breachBuckets) || 0;
      // Rough estimate: assume ~1h per bucket
      const estBreachMinutes = breaches * 60;

      return {
        companyName:      String(r.companyName),
        uptimePct:        parseFloat(uptimePct.toFixed(4)),
        slaTarget,
        slaMet:           uptimePct >= slaTarget,
        compliantBuckets: compliant,
        breachBuckets:    breaches,
        totalBuckets:     total,
        avgHealth:        parseFloat(String(r.avgHealth || '0')),
        lowestHealth:     parseFloat(String(r.lowestHealth || '0')),
        deviceCount:      Number(r.deviceCount) || 0,
        estBreachMinutes
      };
    });

    const result = {
      report:    'slaUptime',
      range:     { start: start.toISOString(), hours, slaTarget },
      source:    'device_snapshots',
      summary: {
        total:    companies.length,
        metSla:   companies.filter(c => c.slaMet).length,
        missed:   companies.filter(c => !c.slaMet).length
      },
      companies,
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build SLA uptime report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try { return res.status(500).json({ error: 'Failed to build SLA uptime report' }); } catch { return; }
  }
});

// ── Flapping / Unstable Devices ────────────────────────────────────────────
router.get('/reports/flapping-devices', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 24, { min: 1, max: 8760 });
    const limit = parseIntParam(req.query.limit, 20, { min: 1, max: 100 });
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);

    const sql = `
      SELECT
        device_id                                          AS deviceId,
        MAX(device_name)                                   AS deviceName,
        MAX(company_name)                                  AS companyName,
        COUNT(*)                                           AS snapshots,
        ROUND(AVG(health_percentage), 2)                   AS avgHealth,
        ROUND(STDDEV_POP(health_percentage), 2)            AS stddevHealth,
        MIN(health_percentage)                             AS minHealth,
        MAX(health_percentage)                             AS maxHealth,
        (MAX(health_percentage) - MIN(health_percentage))  AS healthRange,
        SUM(CASE WHEN health_percentage < 70 THEN 1 ELSE 0 END) AS badBuckets
      FROM device_snapshots
      WHERE snapshot_time >= :start
      GROUP BY device_id
      HAVING snapshots >= 4
      ORDER BY stddevHealth DESC, healthRange DESC
      LIMIT :limit
    `;

    const rows = await sequelize.query(sql, {
      replacements: { start, limit },
      type: Sequelize.QueryTypes.SELECT
    });

    const devices = rows.map(r => {
      const stddev = parseFloat(String(r.stddevHealth || '0'));
      let volatility = 'stable';
      if (stddev >= 20) volatility = 'critical';
      else if (stddev >= 10) volatility = 'high';
      else if (stddev >= 5)  volatility = 'medium';

      return {
        deviceId:    r.deviceId,
        deviceName:  String(r.deviceName || ''),
        companyName: String(r.companyName || ''),
        snapshots:   Number(r.snapshots)   || 0,
        avgHealth:   parseFloat(String(r.avgHealth   || '0')),
        stddevHealth: stddev,
        minHealth:   parseFloat(String(r.minHealth   || '0')),
        maxHealth:   parseFloat(String(r.maxHealth   || '0')),
        healthRange: parseFloat(String(r.healthRange || '0')),
        badBuckets:  Number(r.badBuckets)  || 0,
        volatility
      };
    });

    const result = {
      report:  'flappingDevices',
      range:   { start: start.toISOString(), hours },
      source:  'device_snapshots',
      devices,
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build flapping devices report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try { return res.status(500).json({ error: 'Failed to build flapping devices report' }); } catch { return; }
  }
});

// ── Sensor Type Distribution ───────────────────────────────────────────────
router.get('/reports/sensor-type-distribution', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const rows = await sequelize.query(`
      SELECT
        COALESCE(NULLIF(TRIM(sensor_type), ''), 'Unknown') AS sensorType,
        COUNT(*)                                            AS total,
        SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END)        AS up,
        SUM(CASE WHEN status = 5 THEN 1 ELSE 0 END)        AS down,
        SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END)        AS warning,
        SUM(CASE WHEN status = 7 THEN 1 ELSE 0 END)        AS paused,
        SUM(CASE WHEN status NOT IN (3,4,5,7) THEN 1 ELSE 0 END) AS other
      FROM sensors
      GROUP BY sensor_type
      ORDER BY total DESC
      LIMIT 40
    `, { type: Sequelize.QueryTypes.SELECT });

    const types = rows.map(r => ({
      sensorType: String(r.sensorType),
      total:      Number(r.total)   || 0,
      up:         Number(r.up)      || 0,
      down:       Number(r.down)    || 0,
      warning:    Number(r.warning) || 0,
      paused:     Number(r.paused)  || 0,
      other:      Number(r.other)   || 0,
      healthPct:  r.total > 0 ? parseFloat(((Number(r.up) / Number(r.total)) * 100).toFixed(1)) : 0
    }));

    const grandTotal = types.reduce((s, t) => s + t.total, 0);

    const result = {
      report:     'sensorTypeDistribution',
      source:     'sensors',
      grandTotal,
      types,
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build sensor type distribution report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try { return res.status(500).json({ error: 'Failed to build sensor type distribution report' }); } catch { return; }
  }
});

// ── Alert Acknowledgment Latency ───────────────────────────────────────────
router.get('/reports/alert-ack-latency', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 168, { min: 1, max: 8760 });
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Per-severity: count, avg ack latency minutes, p95 approx via MAX of lower 95%
    const bySeverity = await sequelize.query(`
      SELECT
        severity,
        COUNT(*)                                                                           AS total,
        SUM(CASE WHEN acknowledged = 1 THEN 1 ELSE 0 END)                                AS acked,
        SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END)                                AS unacked,
        ROUND(AVG(CASE WHEN acknowledged = 1 THEN TIMESTAMPDIFF(MINUTE, timestamp, acknowledged_at) ELSE NULL END), 1) AS avgAckMinutes,
        ROUND(MAX(CASE WHEN acknowledged = 1 THEN TIMESTAMPDIFF(MINUTE, timestamp, acknowledged_at) ELSE NULL END), 1) AS maxAckMinutes
      FROM alerts
      WHERE timestamp >= :start
      GROUP BY severity
      ORDER BY avgAckMinutes DESC
    `, { replacements: { start }, type: Sequelize.QueryTypes.SELECT });

    // Recent unacknowledged (age in minutes)
    const staleAlerts = await sequelize.query(`
      SELECT
        id, severity, message, timestamp,
        TIMESTAMPDIFF(MINUTE, timestamp, NOW()) AS ageMinutes,
        device_id AS deviceId
      FROM alerts
      WHERE acknowledged = 0 AND timestamp >= :start
      ORDER BY timestamp ASC
      LIMIT 25
    `, { replacements: { start }, type: Sequelize.QueryTypes.SELECT });

    // Hourly alert volume trend (last 48h max)
    const trendHours = Math.min(hours, 48);
    const trendStart = new Date(Date.now() - trendHours * 60 * 60 * 1000);
    const hourlyTrend = await sequelize.query(`
      SELECT
        DATE_FORMAT(timestamp, '%Y-%m-%d %H:00:00') AS hour,
        COUNT(*)                                     AS total,
        SUM(CASE WHEN acknowledged = 0 THEN 1 ELSE 0 END) AS unacked
      FROM alerts
      WHERE timestamp >= :trendStart
      GROUP BY hour
      ORDER BY hour ASC
    `, { replacements: { trendStart }, type: Sequelize.QueryTypes.SELECT });

    const result = {
      report:  'alertAckLatency',
      range:   { start: start.toISOString(), hours },
      source:  'alerts',
      bySeverity: bySeverity.map(r => ({
        severity:     String(r.severity),
        total:        Number(r.total)       || 0,
        acked:        Number(r.acked)       || 0,
        unacked:      Number(r.unacked)     || 0,
        ackRate:      r.total > 0 ? parseFloat(((Number(r.acked) / Number(r.total)) * 100).toFixed(1)) : 0,
        avgAckMinutes: r.avgAckMinutes !== null ? parseFloat(r.avgAckMinutes) : null,
        maxAckMinutes: r.maxAckMinutes !== null ? parseFloat(r.maxAckMinutes) : null
      })),
      staleAlerts: staleAlerts.map(r => ({
        id:         Number(r.id),
        severity:   String(r.severity),
        message:    String(r.message || '').slice(0, 120),
        timestamp:  new Date(r.timestamp).toISOString(),
        ageMinutes: Number(r.ageMinutes) || 0,
        deviceId:   r.deviceId
      })),
      hourlyTrend: hourlyTrend.map(r => ({
        hour:   r.hour,
        total:  Number(r.total)  || 0,
        unacked: Number(r.unacked) || 0
      })),
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build alert ack latency report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try { return res.status(500).json({ error: 'Failed to build alert ack latency report' }); } catch { return; }
  }
});

router.get('/reports/company-device-health-graph', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const includeNoCompany = String(req.query.includeNoCompany || 'false').toLowerCase() === 'true';

    const devices = await Device.findAll({
      attributes: ['id', 'name', 'status', 'statusText', 'prtgServerId'],
      include: [
        {
          model: DeviceMetadata,
          as: 'metadata',
          attributes: ['company_code', 'company_name', 'site_identifier', 'site_location', 'vendor', 'device_category'],
          required: false
        }
      ]
    });

    const companyNodes = new Map();
    const graphNodes = [];
    const graphEdges = [];

    function companyIdFor(meta) {
      const code = meta?.company_code || '';
      const name = meta?.company_name || '';
      const key = (code || name || '').trim();
      return key ? `company:${key}` : null;
    }

    for (const d of devices) {
      const meta = d.metadata;
      const companyId = companyIdFor(meta);

      if (!companyId && !includeNoCompany) {
        continue;
      }

      if (companyId && !companyNodes.has(companyId)) {
        const label = (meta?.company_name || meta?.company_code || 'Company').trim();
        companyNodes.set(companyId, {
          id: companyId,
          label,
          type: 'company',
          status: 3
        });
      }

      const deviceId = `device:${d.id}`;
      graphNodes.push({
        id: deviceId,
        label: d.name,
        type: 'device',
        status: d.status,
        statusText: d.statusText,
        meta: {
          prtgServerId: d.prtgServerId,
          company: meta?.company_code || meta?.company_name || null,
          site: meta?.site_identifier || null,
          location: meta?.site_location || null,
          vendor: meta?.vendor || null,
          category: meta?.device_category || null
        }
      });

      if (companyId) {
        graphEdges.push({ source: companyId, target: deviceId, type: 'owns', weight: 1 });
      } else {
        const orphanCompanyId = 'company:Unassigned';
        if (!companyNodes.has(orphanCompanyId)) {
          companyNodes.set(orphanCompanyId, { id: orphanCompanyId, label: 'Unassigned', type: 'company', status: 3 });
        }
        graphEdges.push({ source: orphanCompanyId, target: deviceId, type: 'owns', weight: 1 });
      }
    }

    // Prepend company nodes so indices are stable
    const companyList = [...companyNodes.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const nodes = [...companyList, ...graphNodes].map((n) => ({
      ...n,
      status: Number.isFinite(n.status) ? n.status : 0
    }));
    const edges = graphEdges;

    // Deterministic layout seeded by tenant-stable string (node ids)
    const seed = fnv1a32(nodes.map(n => String(n.id)).join('|'));
    const positionsById = buildDeterministicLayout(nodes, { seed, radius: 18, jitter: 0.18, zJitter: 0.08 });

    const positions = [];
    const colors = [];
    const nodeIndexById = new Map();
    for (let i = 0; i < nodes.length; i++) {
      const id = String(nodes[i].id);
      nodeIndexById.set(id, i);
      const pos = positionsById.get(id) || [0, 0, 0];
      positions.push(pos[0], pos[1], pos[2]);
      const rgba = nodes[i].type === 'company' ? [0.25, 0.55, 0.95, 1.0] : rgbaFromStatus(nodes[i].status);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    const indices = buildLineIndexBuffer(edges, nodeIndexById);

    const result = {
      report: 'companyDeviceHealthGraph',
      graph: { nodes, edges },
      renderSpec: {
        kind: 'webglGraph',
        deterministic: true,
        seed,
        buffers: {
          primitive: 'lines',
          positions,
          colors,
          indices
        }
      },
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build company/device health graph report:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build company/device health graph report' });
    } catch (e) {
      return;
    }
  }
});

// ============================================
// Analytics API (Predictions)
// ============================================

router.get('/analytics/network-health', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 24, { min: 1, max: 8760 });
    const bucketMinutes = parseIntParam(req.query.bucketMinutes, 60, { min: 5, max: 240 });
    const forecastHours = parseIntParam(req.query.forecastHours, 24, { min: 1, max: 720 });

    const now = new Date();
    const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
    const bucketSeconds = bucketMinutes * 60;

    const sql = `
      SELECT
        FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(snapshot_time) / :bucketSeconds) * :bucketSeconds) AS bucket,
        AVG(health_percentage) AS avg_health,
        SUM(sensor_count_total) AS total_sensors,
        SUM(sensor_count_down) AS down_sensors,
        SUM(sensor_count_warning) AS warning_sensors,
        SUM(sensor_count_paused) AS paused_sensors
      FROM device_snapshots
      WHERE snapshot_time >= :start
      GROUP BY bucket
      ORDER BY bucket ASC
    `;

    const rows = await sequelize.query(sql, {
      replacements: { bucketSeconds, start },
      type: Sequelize.QueryTypes.SELECT
    });

    const actual = rows
      .map((r) => ({
        timestamp: new Date(r.bucket).toISOString(),
        value: Number.parseFloat(String(r.avg_health ?? '0')) || 0,
        totals: {
          totalSensors: Number.parseInt(String(r.total_sensors ?? '0'), 10) || 0,
          down: Number.parseInt(String(r.down_sensors ?? '0'), 10) || 0,
          warning: Number.parseInt(String(r.warning_sensors ?? '0'), 10) || 0,
          paused: Number.parseInt(String(r.paused_sensors ?? '0'), 10) || 0
        }
      }));

    // Fit a simple deterministic model on the last N points
    const tail = actual.slice(Math.max(0, actual.length - 24));
    const lrPoints = tail.map((p, idx) => ({ x: idx, y: p.value }));
    const model = linearRegression(lrPoints);

    const forecastBuckets = Math.max(1, Math.floor((forecastHours * 60) / bucketMinutes));
    const lastIdx = lrPoints.length ? (lrPoints[lrPoints.length - 1].x) : 0;
    const lastTs = actual.length ? new Date(actual[actual.length - 1].timestamp).getTime() : now.getTime();
    const bucketMs = bucketMinutes * 60 * 1000;

    const predicted = [];
    for (let i = 1; i <= forecastBuckets; i++) {
      const x = lastIdx + i;
      const y = model.slope * x + model.intercept;
      predicted.push({
        timestamp: new Date(lastTs + i * bucketMs).toISOString(),
        value: Math.max(0, Math.min(100, y))
      });
    }

    // Confidence: use r2 but dampen when we have few points
    const dataFactor = Math.max(0, Math.min(1, (lrPoints.length - 4) / 12));
    const confidence = Math.max(0, Math.min(1, model.r2 * dataFactor));

    const result = {
      analytics: 'networkHealthForecast',
      range: { start: start.toISOString(), end: now.toISOString(), hours, bucketMinutes, forecastHours },
      source: 'device_snapshots',
      series: { actual, predicted },
      model: {
        kind: 'linearRegression',
        slopePerBucket: model.slope,
        intercept: model.intercept,
        r2: model.r2,
        confidence
      },
      renderSpec: {
        kind: 'lineForecast',
        deterministic: true,
        x: { key: 'timestamp', type: 'time' },
        y: { key: 'value', type: 'number', unit: 'percent' },
        lines: [
          { key: 'actual', label: 'Actual', style: 'solid' },
          { key: 'predicted', label: 'Predicted', style: 'dashed' }
        ]
      },
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build network health analytics:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build network health analytics' });
    } catch (e) {
      return;
    }
  }
});

router.get('/analytics/device-risk', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 24, { min: 1, max: 8760 });
    const limit = parseIntParam(req.query.limit, 12, { min: 1, max: 50 });
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);

    // Compute per-device health delta across the window using group_concat ordering.
    // This stays reasonably bounded because snapshots are typically hourly.
    const sql = `
      SELECT
        device_id AS deviceId,
        MAX(device_name) AS deviceName,
        MAX(company_name) AS companyName,
        CAST(SUBSTRING_INDEX(GROUP_CONCAT(health_percentage ORDER BY snapshot_time ASC SEPARATOR ','), ',', 1) AS DECIMAL(10,2)) AS startHealth,
        CAST(SUBSTRING_INDEX(GROUP_CONCAT(health_percentage ORDER BY snapshot_time DESC SEPARATOR ','), ',', 1) AS DECIMAL(10,2)) AS endHealth,
        COUNT(*) AS points
      FROM device_snapshots
      WHERE snapshot_time >= :start
      GROUP BY device_id
      HAVING points >= 6
      ORDER BY (endHealth - startHealth) ASC
      LIMIT :limit
    `;

    const rows = await sequelize.query(sql, {
      replacements: { start, limit },
      type: Sequelize.QueryTypes.SELECT
    });

    const devices = rows.map((r) => {
      const startHealth = Number.parseFloat(String(r.startHealth ?? '0')) || 0;
      const endHealth = Number.parseFloat(String(r.endHealth ?? '0')) || 0;
      const delta = endHealth - startHealth;

      let risk = 'low';
      if (endHealth < 70 || delta < -10) risk = 'high';
      else if (endHealth < 85 || delta < -5) risk = 'medium';

      return {
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        companyName: r.companyName,
        startHealth,
        endHealth,
        deltaHealth: delta,
        points: Number.parseInt(String(r.points ?? '0'), 10) || 0,
        risk
      };
    });

    const result = {
      analytics: 'deviceRisk',
      range: { start: start.toISOString(), hours },
      source: 'device_snapshots',
      devices,
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build device risk analytics:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build device risk analytics' });
    } catch (e) {
      return;
    }
  }
});

router.get('/analytics/company-health', async (req, res) => {
  try {
    const cached = getCachedReport(req);
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 24, { min: 1, max: 8760 });
    const start = new Date(Date.now() - hours * 60 * 60 * 1000);

    const sql = `
      SELECT
        COALESCE(company_name, 'Unassigned') AS companyName,
        ROUND(AVG(health_percentage), 2)     AS avgHealth,
        COUNT(DISTINCT device_id)            AS deviceCount,
        ROUND(MIN(health_percentage), 2)     AS minHealth,
        ROUND(MAX(health_percentage), 2)     AS maxHealth,
        SUM(sensor_count_down)               AS totalDown,
        SUM(sensor_count_warning)            AS totalWarning
      FROM device_snapshots
      WHERE snapshot_time >= :start
      GROUP BY company_name
      ORDER BY avgHealth ASC
      LIMIT 30
    `;

    const rows = await sequelize.query(sql, {
      replacements: { start },
      type: Sequelize.QueryTypes.SELECT
    });

    const companies = rows.map((r) => ({
      companyName:  String(r.companyName || 'Unassigned'),
      avgHealth:    Number.parseFloat(String(r.avgHealth   ?? '0')) || 0,
      deviceCount:  Number.parseInt(String(r.deviceCount   ?? '0'), 10) || 0,
      minHealth:    Number.parseFloat(String(r.minHealth   ?? '0')) || 0,
      maxHealth:    Number.parseFloat(String(r.maxHealth   ?? '0')) || 0,
      totalDown:    Number.parseInt(String(r.totalDown     ?? '0'), 10) || 0,
      totalWarning: Number.parseInt(String(r.totalWarning  ?? '0'), 10) || 0
    }));

    const result = {
      analytics: 'companyHealth',
      range: { start: start.toISOString(), hours },
      source: 'device_snapshots',
      companies,
      generatedAt: new Date().toISOString()
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build company health analytics:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build company health analytics' });
    } catch (e) {
      return;
    }
  }
});

// ============================================
// AI Intelligence Engine
// ============================================

/**
 * Compute Z-score based anomalies live from device_snapshots.
 * Returns devices whose latest health is >= zThreshold std-devs below their
 * own recent baseline (mean over the window).
 */
async function computeLiveAnomalies(hours = 48, zThreshold = 2.0) {
  const start = new Date(Date.now() - hours * 60 * 60 * 1000);

  const sql = `
    SELECT
      device_id                                   AS deviceId,
      MAX(device_name)                            AS deviceName,
      MAX(company_name)                           AS companyName,
      AVG(health_percentage)                      AS meanHealth,
      STDDEV_POP(health_percentage)               AS stdHealth,
      CAST(SUBSTRING_INDEX(
        GROUP_CONCAT(health_percentage ORDER BY snapshot_time DESC SEPARATOR ','),
        ',', 1
      ) AS DECIMAL(10,2))                         AS latestHealth,
      COUNT(*)                                    AS points,
      MIN(snapshot_time)                          AS firstSeen,
      MAX(snapshot_time)                          AS lastSeen
    FROM device_snapshots
    WHERE snapshot_time >= :start
    GROUP BY device_id
    HAVING points >= 8
  `;

  const rows = await sequelize.query(sql, {
    replacements: { start },
    type: Sequelize.QueryTypes.SELECT
  });

  const anomalies = [];
  for (const r of rows) {
    const mean   = Number.parseFloat(String(r.meanHealth   ?? '0')) || 0;
    const std    = Number.parseFloat(String(r.stdHealth    ?? '0')) || 0;
    const latest = Number.parseFloat(String(r.latestHealth ?? '0')) || 0;

    if (std < 0.5) continue; // Flat signal — ignore

    const z = std > 0 ? (mean - latest) / std : 0; // positive z = below mean

    if (z >= zThreshold) {
      const severity = z >= 3.5 ? 'critical' : z >= 2.5 ? 'warning' : 'info';
      anomalies.push({
        deviceId:    r.deviceId,
        deviceName:  r.deviceName   || 'Unknown',
        companyName: r.companyName  || 'Unassigned',
        meanHealth:  Math.round(mean * 10) / 10,
        latestHealth: Math.round(latest * 10) / 10,
        zScore:      Math.round(z * 100) / 100,
        severity,
        type: 'zscore_health_drop',
        message: `Health dropped to ${Math.round(latest)}% (${Math.round(z * 10) / 10}σ below baseline of ${Math.round(mean)}%)`
      });
    }
  }

  anomalies.sort((a, b) => b.zScore - a.zScore);
  return anomalies;
}

/**
 * Compute flapping devices — high variance with no clear trend.
 */
async function computeFlappingDevices(hours = 24) {
  const start = new Date(Date.now() - hours * 60 * 60 * 1000);

  const sql = `
    SELECT
      device_id                AS deviceId,
      MAX(device_name)         AS deviceName,
      MAX(company_name)        AS companyName,
      STDDEV_POP(health_percentage) AS stdHealth,
      COUNT(*)                 AS points,
      AVG(health_percentage)   AS meanHealth
    FROM device_snapshots
    WHERE snapshot_time >= :start
    GROUP BY device_id
    HAVING points >= 6 AND stdHealth >= 15
    ORDER BY stdHealth DESC
    LIMIT 10
  `;

  const rows = await sequelize.query(sql, {
    replacements: { start },
    type: Sequelize.QueryTypes.SELECT
  });

  return rows.map(r => ({
    deviceId:    r.deviceId,
    deviceName:  r.deviceName  || 'Unknown',
    companyName: r.companyName || 'Unassigned',
    stdHealth:   Math.round(Number.parseFloat(String(r.stdHealth ?? '0')) * 10) / 10,
    meanHealth:  Math.round(Number.parseFloat(String(r.meanHealth ?? '0')) * 10) / 10,
    severity:    Number.parseFloat(String(r.stdHealth ?? '0')) >= 25 ? 'critical' : 'warning',
    type: 'flapping',
    message: `Unstable health — standard deviation ${Math.round(Number.parseFloat(String(r.stdHealth ?? '0')) * 10) / 10}% over ${hours}h`
  }));
}

/**
 * Build a natural-language smart summary of the network state.
 */
function buildSmartSummary({ overallHealth, trendSlope, liveAnomalies, flapping, storedAnomalies, predictions, networkDown, networkWarning }) {
  const lines = [];

  if (overallHealth >= 95) lines.push(`Network is operating at peak health (${Math.round(overallHealth)}%).`);
  else if (overallHealth >= 85) lines.push(`Network health is good at ${Math.round(overallHealth)}%.`);
  else if (overallHealth >= 70) lines.push(`Network health is degraded at ${Math.round(overallHealth)}% — attention recommended.`);
  else lines.push(`Network health is critically low at ${Math.round(overallHealth)}% — immediate action required.`);

  if (trendSlope < -0.5) lines.push(`Health is trending down at ${Math.abs(Math.round(trendSlope * 10) / 10)}% per hour — investigate now.`);
  else if (trendSlope < -0.1) lines.push(`A slow downward trend of ${Math.abs(Math.round(trendSlope * 10) / 10)}%/hr is in progress.`);
  else if (trendSlope > 0.3) lines.push(`Health is recovering (+${Math.round(trendSlope * 10) / 10}%/hr).`);

  if (networkDown > 0) lines.push(`${networkDown} device${networkDown > 1 ? 's are' : ' is'} currently DOWN.`);
  if (networkWarning > 0) lines.push(`${networkWarning} device${networkWarning > 1 ? 's have' : ' has'} active warnings.`);

  const critLive = liveAnomalies.filter(a => a.severity === 'critical').length;
  if (critLive > 0) lines.push(`AI detected ${critLive} critical health anomaly${critLive > 1 ? 'ies' : ''} via Z-score analysis.`);
  else if (liveAnomalies.length > 0) lines.push(`AI detected ${liveAnomalies.length} health anomaly${liveAnomalies.length > 1 ? 'ies' : ''} below baseline.`);

  if (flapping.length > 0) lines.push(`${flapping.length} device${flapping.length > 1 ? 's are' : ' is'} flapping with unstable health readings.`);

  if (predictions.length > 0) {
    const critPred = predictions.filter(p => p.confidence_score >= 0.85).length;
    if (critPred > 0) lines.push(`${critPred} high-confidence failure prediction${critPred > 1 ? 's' : ''} detected — proactive action advised.`);
    else lines.push(`${predictions.length} predictive alarm${predictions.length > 1 ? 's' : ''} active.`);
  }

  if (storedAnomalies.length === 0 && liveAnomalies.length === 0 && flapping.length === 0 && predictions.length === 0) {
    lines.push('No active anomalies or predictions detected. All systems nominal.');
  }

  return lines.join(' ');
}

router.get('/analytics/ai-insights', async (req, res) => {
  try {
    const cached = getCachedReport(req, 120000); // 2-minute cache
    if (cached) return res.json(cached);

    const hours = parseIntParam(req.query.hours, 48, { min: 6, max: 720 });

    // ── 1. Current fleet health ──────────────────────────────────────────────
    const healthSql = `
      SELECT
        AVG(avg_health) AS overallHealth,
        SUM(down_count) AS networkDown,
        SUM(warn_count) AS networkWarning
      FROM (
        SELECT
          ds.device_id,
          AVG(ds.health_percentage) AS avg_health,
          MAX(CASE WHEN d.status = 5 THEN 1 ELSE 0 END) AS down_count,
          MAX(CASE WHEN d.status = 4 THEN 1 ELSE 0 END) AS warn_count
        FROM device_snapshots ds
        LEFT JOIN devices d ON d.id = ds.device_id
        WHERE ds.snapshot_time >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
        GROUP BY ds.device_id
      ) recent
    `;
    const [healthRow] = await sequelize.query(healthSql, { type: Sequelize.QueryTypes.SELECT });
    const overallHealth  = Number.parseFloat(String(healthRow?.overallHealth ?? '0')) || 0;
    const networkDown    = Number.parseInt(String(healthRow?.networkDown    ?? '0'), 10) || 0;
    const networkWarning = Number.parseInt(String(healthRow?.networkWarning ?? '0'), 10) || 0;

    // ── 2. Trend slope (last 24h via linear regression) ──────────────────────
    const trendSql = `
      SELECT
        FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(snapshot_time) / 3600) * 3600) AS bucket,
        AVG(health_percentage) AS avg_health
      FROM device_snapshots
      WHERE snapshot_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      GROUP BY bucket
      ORDER BY bucket ASC
    `;
    const trendRows = await sequelize.query(trendSql, { type: Sequelize.QueryTypes.SELECT });
    const trendPoints = trendRows.map((r, idx) => ({ x: idx, y: Number.parseFloat(String(r.avg_health ?? '0')) || 0 }));
    const trendModel  = linearRegression(trendPoints);

    // ── 3. Stored anomalies & predictions ────────────────────────────────────
    const anomalyQuery = `
      SELECT id, device_id AS deviceId, device_name AS deviceName,
             company_name AS companyName, anomaly_type AS anomalyType,
             severity, current_value AS currentValue, days_to_critical AS daysToCritical,
             message, detected_at AS detectedAt
      FROM device_anomalies
      WHERE is_active = 1
      ORDER BY FIELD(severity,'critical','warning','info'), detected_at DESC
      LIMIT 25
    `;
    const storedAnomalies = await sequelize.query(anomalyQuery, { type: Sequelize.QueryTypes.SELECT });

    const predQuery = `
      SELECT id, entity_type AS entityType, entity_id AS entityId,
             entity_name AS entityName, company_name AS companyName,
             prediction_type AS predictionType,
             confidence_score AS confidenceScore,
             predicted_time AS predictedTime,
             details, created_at AS createdAt
      FROM predictive_analytics
      WHERE is_active = 1
      ORDER BY confidence_score DESC, predicted_time ASC
      LIMIT 20
    `;
    const predictions = await sequelize.query(predQuery, { type: Sequelize.QueryTypes.SELECT });

    // ── 4. Live anomaly detection (Z-score) ──────────────────────────────────
    const liveAnomalies = await computeLiveAnomalies(hours, 2.0);

    // ── 5. Flapping detection ─────────────────────────────────────────────────
    const flapping = await computeFlappingDevices(24);

    // ── 6. Company-level health clustering ───────────────────────────────────
    const companySql = `
      SELECT
        COALESCE(ds.company_name, 'Unassigned') AS companyName,
        ROUND(AVG(ds.health_percentage), 1)     AS avgHealth,
        COUNT(DISTINCT ds.device_id)            AS deviceCount,
        SUM(CASE WHEN d.status = 5 THEN 1 ELSE 0 END) AS devicesDown
      FROM device_snapshots ds
      LEFT JOIN devices d ON d.id = ds.device_id
      WHERE ds.snapshot_time >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
      GROUP BY ds.company_name
      HAVING deviceCount >= 2
      ORDER BY avgHealth ASC
      LIMIT 20
    `;
    const companyHealth = await sequelize.query(companySql, { type: Sequelize.QueryTypes.SELECT });

    // ── 7. Top at-risk companies ──────────────────────────────────────────────
    const atRisk = companyHealth
      .filter(c => Number.parseFloat(String(c.avgHealth)) < 90)
      .map(c => ({
        companyName:  String(c.companyName),
        avgHealth:    Number.parseFloat(String(c.avgHealth ?? '0')),
        deviceCount:  Number.parseInt(String(c.deviceCount ?? '0'), 10),
        devicesDown:  Number.parseInt(String(c.devicesDown ?? '0'), 10),
        riskLevel:    Number.parseFloat(String(c.avgHealth)) < 70 ? 'critical' : Number.parseFloat(String(c.avgHealth)) < 85 ? 'high' : 'medium'
      }));

    // ── 8. Smart summary text ─────────────────────────────────────────────────
    const summary = buildSmartSummary({
      overallHealth,
      trendSlope: trendModel.slope,
      liveAnomalies,
      flapping,
      storedAnomalies,
      predictions,
      networkDown,
      networkWarning
    });

    // ── 9. Auto-recommendations ───────────────────────────────────────────────
    const recommendations = [];
    if (networkDown > 0) recommendations.push({ priority: 'critical', icon: '🔴', text: `Investigate ${networkDown} offline device${networkDown > 1 ? 's' : ''} — check PRTG for root cause.` });
    if (trendModel.slope < -0.3 && trendModel.r2 > 0.5) recommendations.push({ priority: 'high', icon: '📉', text: `Consistent health decline detected. Forecast shows continued drop — schedule maintenance window.` });
    const criticalAnomalies = liveAnomalies.filter(a => a.severity === 'critical');
    if (criticalAnomalies.length > 0) recommendations.push({ priority: 'high', icon: '⚡', text: `${criticalAnomalies.length} device${criticalAnomalies.length > 1 ? 's' : ''} showing statistical health anomalies: ${criticalAnomalies.slice(0, 3).map(a => a.deviceName).join(', ')}` });
    if (flapping.length > 0) recommendations.push({ priority: 'medium', icon: '🔀', text: `${flapping.length} flapping device${flapping.length > 1 ? 's' : ''} detected. Review connectivity and sensor configuration.` });
    const nearPredictions = predictions.filter(p => {
      const eta = new Date(p.predictedTime).getTime() - Date.now();
      return eta > 0 && eta < 48 * 60 * 60 * 1000;
    });
    if (nearPredictions.length > 0) recommendations.push({ priority: 'high', icon: '⏰', text: `${nearPredictions.length} device${nearPredictions.length > 1 ? 's are' : ' is'} predicted to fail within 48 hours — proactive intervention recommended.` });
    if (atRisk.filter(c => c.riskLevel === 'critical').length > 0) recommendations.push({ priority: 'high', icon: '🏢', text: `Companies at critical health: ${atRisk.filter(c => c.riskLevel === 'critical').map(c => c.companyName).slice(0, 3).join(', ')}` });
    if (recommendations.length === 0) recommendations.push({ priority: 'low', icon: '✅', text: 'All systems operating within normal parameters. Continue monitoring.' });

    const result = {
      analytics: 'aiInsights',
      version: '1.0',
      generatedAt: new Date().toISOString(),
      summary: {
        text: summary,
        overallHealth: Math.round(overallHealth * 10) / 10,
        networkDown,
        networkWarning,
        trendSlope: Math.round(trendModel.slope * 1000) / 1000,
        trendR2:    Math.round(trendModel.r2 * 1000) / 1000,
        anomalyCount: liveAnomalies.length + storedAnomalies.length,
        predictionCount: predictions.length,
        flappingCount: flapping.length,
        criticalCount: liveAnomalies.filter(a => a.severity === 'critical').length + storedAnomalies.filter(a => a.severity === 'critical').length
      },
      liveAnomalies,
      storedAnomalies,
      predictions,
      flapping,
      atRiskCompanies: atRisk,
      recommendations,
      models: {
        trend: { kind: 'linearRegression', slope: trendModel.slope, intercept: trendModel.intercept, r2: trendModel.r2 },
        anomaly: { kind: 'zScore', threshold: 2.0, windowHours: hours }
      }
    };

    setCachedReport(req, result);
    return res.json(result);
  } catch (error) {
    logger.error('Failed to build AI insights:', error);
    if (res.headersSent || res.writableEnded || res.finished) return;
    try {
      return res.status(500).json({ error: 'Failed to build AI insights' });
    } catch (e) { return; }
  }
});

router.get('/dashboard/summary', async (req, res) => {
  try {
    const summary = {
      servers: await PRTGServer.count({ where: { enabled: true } }),
      devices: {
        total: await Device.count(),
        up: await Device.count({ where: { status: 3 } }),
        down: await Device.count({ where: { status: 5 } }),
        warning: await Device.count({ where: { status: 4 } })
      },
      sensors: {
        total: await Sensor.count(),
        up: await Sensor.count({ where: { status: 3 } }),
        down: await Sensor.count({ where: { status: 5 } }),
        warning: await Sensor.count({ where: { status: 4 } }),
        paused: await Sensor.count({ where: { status: 7 } }),
        unusual: await Sensor.count({ where: { status: 10 } }),
        unknown: await Sensor.count({ where: { status: 1 } })
      },
      alerts: {
        unacknowledged: await Alert.count({ where: { acknowledged: false } }),
        last24h: await Alert.count({
          where: {
            timestamp: { [Op.gte]: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        })
      }
    };

    res.json(summary);
  } catch (error) {
    logger.error('Error fetching dashboard summary:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch dashboard summary' });
    }
  }
});

// ============================================
// PRTG Servers
// ============================================
router.get('/servers', async (req, res) => {
  try {
    const servers = await PRTGServer.findAll({
      attributes: ['id', 'url', 'username', 'enabled', 'lastSuccessfulPoll', 'lastError']
    });
    res.json(servers);
  } catch (error) {
    logger.error('Error fetching servers:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch servers' });
    }
  }
});

router.get('/servers/:id', async (req, res) => {
  try {
    const server = await PRTGServer.findByPk(req.params.id);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }
    res.json(server);
  } catch (error) {
    logger.error('Error fetching server:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch server' });
    }
  }
});

// ============================================
// Devices
// ============================================
router.get('/devices', async (req, res) => {
  try {
    const { serverId, status, search, limit = 100, offset = 0 } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (status) where.status = parseInt(status);
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }

    const devices = await Device.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [{
        model: PRTGServer,
        as: 'server',
        attributes: ['id', 'url']
      }]
    });

    const total = await Device.count({ where });

    res.json({
      devices,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching devices:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch devices' });
    }
  }
});

// Get enhanced device list with metadata (must be before :id route)
router.get('/devices/enhanced', async (req, res) => {
  const startTime = Date.now();
  const requestId = `enhanced-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  logger.info(`[${requestId}] ========== /api/devices/enhanced START ==========`);
  logger.info(`[${requestId}] Query params:`, req.query);
  logger.info(`[${requestId}] User: ${req.session?.user?.email || 'UNKNOWN'}`);
  
  try {
    const { 
      company, 
      site, 
      category, 
      environment, 
      search, 
      limit = 100,
      offset = 0,
      all = false
    } = req.query;
    
    const deviceWhere = {};
    const metadataWhere = {};
    
    if (search) deviceWhere.name = { [Op.like]: `%${search}%` };
    if (company) metadataWhere.company_code = company;
    if (site) metadataWhere.site_identifier = site;
    if (category) metadataWhere.device_category = category;
    if (environment) metadataWhere.environment = environment;

    const queryOptions = {
      where: deviceWhere,
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        },
        {
          model: DeviceMetadata,
          as: 'metadata',
          where: Object.keys(metadataWhere).length > 0 ? metadataWhere : undefined,
          required: false
        },
        {
          model: Sensor,
          as: 'sensors',
          required: false,
          attributes: ['id', 'name', 'status', 'sensorType', 'lastValue', 'lastMessage', 'priority']
        }
      ]
    };

    if (all !== 'true') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = parseInt(offset);
      logger.info(`[${requestId}] Pagination: limit=${limit}, offset=${offset}`);
    } else {
      logger.info(`[${requestId}] Fetching ALL devices (no pagination)`);
    }

    logger.info(`[${requestId}] Executing database query...`);
    const queryStart = Date.now();
    
    /**
     * CRITICAL FIX v8.0: Get actual total count from database
     * 
     * BEFORE: pagination.total was set to enhancedDevices.length (200)
     * AFTER: pagination.total is actual DB count (974)
     * 
     * This enables client-side pagination to continue fetching until all
     * devices are loaded. Without this, pagination stops after first page
     * because hasMore calculation thinks 200 is the total.
     * 
     * @returns {number} totalCount - Actual number of devices in database
     */
    const totalCount = await Device.count({
      where: deviceWhere,
      include: Object.keys(metadataWhere).length > 0 ? [{
        model: DeviceMetadata,
        as: 'metadata',
        where: metadataWhere,
        required: false
      }] : []
    });
    
    const devices = await Device.findAll(queryOptions);
    const queryTime = Date.now() - queryStart;
    logger.info(`[${requestId}] Query completed in ${queryTime}ms, found ${devices.length} devices out of ${totalCount} total`);
    
    logger.info(`[${requestId}] Processing device data...`);
    const processStart = Date.now();
    const enhancedDevices = devices.map(device => {
      const deviceData = device.toJSON();
      const sensors = deviceData.sensors || [];
      
      const sensorStats = {
        total: sensors.length,
        up: sensors.filter(s => s.status === 3).length,
        down: sensors.filter(s => s.status === 5).length,
        warning: sensors.filter(s => s.status === 4).length,
        paused: sensors.filter(s => s.status === 7).length
      };
      
      let effectiveStatus = deviceData.status;
      if (sensorStats.down > 0) effectiveStatus = 5;
      else if (sensorStats.warning > 0) effectiveStatus = 4;
      
      return {
        ...deviceData,
        status: effectiveStatus,
        effectiveStatus: effectiveStatus,
        sensorStats,
        companyName: deviceData.metadata?.company_name || 'Unknown'
      };
    });
    const processTime = Date.now() - processStart;
    logger.info(`[${requestId}] Processing completed in ${processTime}ms`);
    
    /**
     * PAGINATION METADATA CALCULATION v8.0
     * 
     * Calculates complete pagination information for client-side pagination continuation.
     * Client uses 'hasMore' flag to determine if additional pages should be fetched.
     * 
     * @property {number} currentPage - Current page number (1-indexed)
     * @property {number} totalPages - Total pages needed to load all devices
     * @property {boolean} hasMore - True if more pages available to fetch
     * 
     * Formula: hasMore = (currentOffset + devicesInThisPage) < totalCount
     * Example: Page 1: (0 + 200) < 974 = true (more pages available)
     *          Page 5: (800 + 174) < 974 = false (last page reached)
     */
    const currentLimit = parseInt(limit);
    const currentOffset = parseInt(offset);
    const currentPage = Math.floor(currentOffset / currentLimit) + 1;
    const totalPages = Math.ceil(totalCount / currentLimit);
    const hasMore = (currentOffset + enhancedDevices.length) < totalCount;
    
    logger.info(`[${requestId}] 📊 PAGINATION DETAILS:`);
    logger.info(`[${requestId}]    Total devices in DB: ${totalCount}`);
    logger.info(`[${requestId}]    Devices in this response: ${enhancedDevices.length}`);
    logger.info(`[${requestId}]    Page: ${currentPage}/${totalPages}`);
    logger.info(`[${requestId}]    Offset: ${currentOffset}, Limit: ${currentLimit}`);
    logger.info(`[${requestId}]    Has more pages: ${hasMore}`);
    
    const totalTime = Date.now() - startTime;
    logger.info(`[${requestId}] ========== REQUEST COMPLETE in ${totalTime}ms ==========`);
    
    /**
     * RESPONSE FORMAT v8.0
     * 
     * Returns complete pagination metadata to enable client-side pagination.
     * All fields are required for proper pagination continuation.
     * 
     * @returns {Object} response
     * @returns {Array} response.devices - Enhanced device objects with sensor stats
     * @returns {Object} response.pagination - Pagination metadata
     * @returns {number} response.pagination.total - Total devices in DB (974)
     * @returns {number} response.pagination.fetched - Devices in this response (200)
     * @returns {number} response.pagination.limit - Page size (200)
     * @returns {number} response.pagination.offset - Current offset (0, 200, 400, etc)
     * @returns {number} response.pagination.page - Current page number (1-5)
     * @returns {number} response.pagination.totalPages - Total pages needed (5)
     * @returns {boolean} response.pagination.hasMore - More pages available (true/false)
     */
    // Force no caching
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
    
    res.json({
      devices: enhancedDevices,
      pagination: {
        total: totalCount,              // ✅ Actual DB count, not page size
        fetched: enhancedDevices.length,
        limit: currentLimit,
        offset: currentOffset,
        page: currentPage,
        totalPages: totalPages,
        hasMore: hasMore                // ✅ Enables pagination continuation
      }
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    logger.error(`[${requestId}] ❌ ERROR after ${totalTime}ms:`, error);
    logger.error(`[${requestId}] Error stack:`, error.stack);
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        requestId: requestId,
        duration: totalTime
      });
    }
  }
});

router.get('/devices/:id', async (req, res) => {
  try {
    const device = await Device.findByPk(req.params.id, {
      include: [
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        },
        {
          model: Sensor,
          as: 'sensors',
          limit: 50
        }
      ]
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    logger.error('Error fetching device:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch device' });
    }
  }
});

// ============================================
// Sensors
// ============================================
router.get('/sensors', async (req, res) => {
  try {
    const { serverId, deviceId, status, search, limit = 100, offset = 0 } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (deviceId) where.deviceId = parseInt(deviceId);
    if (status) where.status = parseInt(status);
    if (search) {
      where.name = { [Op.like]: `%${search}%` };
    }

    const sensors = await Sensor.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['status', 'DESC'], ['priority', 'DESC'], ['name', 'ASC']],
      include: [
        {
          model: Device,
          as: 'device',
          attributes: ['id', 'name']
        },
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        }
      ]
    });

    const total = await Sensor.count({ where });

    res.json({
      sensors,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching sensors:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch sensors' });
    }
  }
});

// Current sensor data with summary (for initial page load)
router.get('/sensors/current', async (req, res) => {
  try {
    const sensors = await Sensor.findAll({
      include: [{
        model: Device,
        as: 'device',
        attributes: ['name', 'host']
      }, {
        model: PRTGServer,
        as: 'server',
        attributes: ['id', 'url']
      }],
      order: [['status', 'DESC'], ['priority', 'DESC']]
    });

    // Calculate summary counts
    const summary = {
      up: sensors.filter(s => s.status === 3).length,
      down: sensors.filter(s => s.status === 5).length,
      warning: sensors.filter(s => s.status === 4).length,
      paused: sensors.filter(s => s.status === 7).length,
      unusual: sensors.filter(s => s.status === 10).length,
      unknown: sensors.filter(s => s.status === 1).length
    };

    res.json({
      sensors: sensors.map(s => s.toJSON()),
      summary,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error fetching current sensors:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch current sensors' });
    }
  }
});

router.get('/sensors/:id', async (req, res) => {
  try {
    const sensor = await Sensor.findByPk(req.params.id, {
      include: [
        {
          model: Device,
          as: 'device'
        },
        {
          model: PRTGServer,
          as: 'server',
          attributes: ['id', 'url']
        }
      ]
    });

    if (!sensor) {
      return res.status(404).json({ error: 'Sensor not found' });
    }

    res.json(sensor);
  } catch (error) {
    logger.error('Error fetching sensor:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch sensor' });
    }
  }
});

// ============================================
// Sensor Readings (Historical Data)
// ============================================
router.get('/sensors/:id/readings', async (req, res) => {
  try {
    const { hours = 24, limit = 1000 } = req.query;
    const startTime = new Date(Date.now() - hours * 60 * 60 * 1000);

    const readings = await SensorReading.findAll({
      where: {
        sensorId: req.params.id,
        timestamp: { [Op.gte]: startTime }
      },
      order: [['timestamp', 'ASC']],
      limit: parseInt(limit)
    });

    res.json({ readings });
  } catch (error) {
    logger.error('Error fetching sensor readings:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch sensor readings' });
    }
  }
});

// ============================================
// Alerts
// ============================================
router.get('/alerts', async (req, res) => {
  try {
    const { 
      serverId, 
      severity, 
      acknowledged = 'false', 
      hours = 24,
      limit = 100, 
      offset = 0 
    } = req.query;
    
    const where = {};
    if (serverId) where.prtgServerId = serverId;
    if (severity) where.severity = severity;
    where.acknowledged = acknowledged === 'true';
    
    if (hours !== 'all') {
      where.timestamp = { 
        [Op.gte]: new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000) 
      };
    }

    const alerts = await Alert.findAll({
      where,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timestamp', 'DESC']]
    });

    const total = await Alert.count({ where });

    res.json({
      alerts,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (error) {
    logger.error('Error fetching alerts:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch alerts' });
    }
  }
});

router.post('/alerts/:id/acknowledge', async (req, res) => {
  try {
    const { acknowledgedBy } = req.body;
    
    const alert = await Alert.findByPk(req.params.id);
    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date();
    await alert.save();

    res.json(alert);
  } catch (error) {
    logger.error('Error acknowledging alert:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to acknowledge alert' });
    }
  }
});

// ============================================
// Health Check
// ============================================
router.get('/health', async (req, res) => {
  try {
    const dbHealthy = await PRTGServer.count() >= 0;
    res.json({
      status: 'healthy',
      database: dbHealthy,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (!res.headersSent) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// ============================================
// Device Metadata & Expandable Sections
// ============================================



// Get device expandable sections
router.get('/devices/:id/metadata', async (req, res) => {
  try {
    const deviceId = req.params.id;
    
    const device = await Device.findByPk(deviceId, {
      include: [
        {
          model: DeviceMetadata,
          as: 'metadata',
          attributes: ['raw_metadata', 'extraction_confidence', 'last_parsed']
        },
        {
          model: Sensor,
          as: 'sensors',
          attributes: ['name', 'sensor_type', 'last_message', 'status_text'],
          limit: 10 // Limit sensors for performance
        }
      ]
    });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    let expandableSections = {};
    
    if (device.metadata && device.metadata.raw_metadata) {
      try {
        const rawMetadata = JSON.parse(device.metadata.raw_metadata);
        expandableSections = rawMetadata.expandable_sections || {};
      } catch (err) {
        logger.warn(`Failed to parse raw metadata for device ${deviceId}:`, err);
      }
    }

    // Add sensor information section
    if (device.sensors && device.sensors.length > 0) {
      expandableSections.sensors = {
        label: 'Sensors',
        icon: '📊',
        data: {
          sensor_count: device.sensors.length,
          sensors: device.sensors.map(sensor => ({
            name: sensor.name,
            type: sensor.sensor_type,
            status: sensor.status_text,
            last_message: sensor.last_message ? sensor.last_message.replace(/<[^>]*>/g, '') : null
          }))
        }
      };
    }

    res.json({
      device_id: deviceId,
      device_name: device.name,
      expandable_sections: expandableSections,
      extraction_confidence: device.metadata?.extraction_confidence || null,
      last_parsed: device.metadata?.last_parsed || null
    });

  } catch (error) {
    const deviceId = req?.params?.id || 'unknown';
    logger.error(`Error fetching device metadata for ${deviceId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch device metadata' });
    }
  }
});

// Get metadata aggregations for filtering
router.get('/metadata/aggregations', async (req, res) => {
  try {
    const [companies, sites, categories, vendors, environments] = await Promise.all([
      // Companies
      DeviceMetadata.findAll({
        attributes: [
          'company_code',
          'company_name',
          [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'device_count']
        ],
        where: { company_code: { [Op.not]: null } },
        group: ['company_code', 'company_name'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('device_id')), 'DESC']]
      }),
      
      // Sites
      DeviceMetadata.findAll({
        attributes: [
          'site_identifier',
          'site_type',
          [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'device_count']
        ],
        where: { site_identifier: { [Op.not]: null } },
        group: ['site_identifier', 'site_type'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('device_id')), 'DESC']]
      }),
      
      // Device categories
      DeviceMetadata.findAll({
        attributes: [
          'device_category',
          [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'device_count']
        ],
        where: { device_category: { [Op.not]: null } },
        group: ['device_category'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('device_id')), 'DESC']]
      }),
      
      // Vendors
      DeviceMetadata.findAll({
        attributes: [
          'vendor',
          [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'device_count']
        ],
        where: { vendor: { [Op.not]: null } },
        group: ['vendor'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('device_id')), 'DESC']]
      }),
      
      // Environments
      DeviceMetadata.findAll({
        attributes: [
          'environment',
          [Sequelize.fn('COUNT', Sequelize.col('device_id')), 'device_count']
        ],
        where: { environment: { [Op.not]: null } },
        group: ['environment'],
        order: [[Sequelize.fn('COUNT', Sequelize.col('device_id')), 'DESC']]
      })
    ]);

    res.json({
      companies,
      sites,
      categories,
      vendors,
      environments,
      summary: {
        total_devices_with_metadata: await DeviceMetadata.count(),
        extraction_stats: await DeviceMetadata.findAll({
          attributes: [
            [Sequelize.fn('AVG', Sequelize.col('extraction_confidence')), 'avg_confidence'],
            [Sequelize.fn('MIN', Sequelize.col('extraction_confidence')), 'min_confidence'],
            [Sequelize.fn('MAX', Sequelize.col('extraction_confidence')), 'max_confidence']
          ]
        })
      }
    });

  } catch (error) {
    logger.error('Error fetching metadata aggregations:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch metadata aggregations' });
    }
  }
});

// ============================================
// SOC Dashboard Enhanced Endpoints  
// ============================================

// Company summary endpoint
router.get('/companies/summary', async (req, res) => {
  try {
    const devices = await Device.findAll({
      include: [
        {
          model: Sensor,
          as: 'sensors',
          required: false,
          attributes: ['id', 'status']
        }
      ]
    });

    const companySummary = {};
    
    devices.forEach(device => {
      const deviceData = device.toJSON();
      const companyCode = extractCompanyCode(deviceData.name);
      
      if (!companySummary[companyCode]) {
        companySummary[companyCode] = {
          code: companyCode,
          name: getCompanyName(companyCode),
          deviceCount: 0,
          sensorCount: 0,
          stats: {
            devicesUp: 0,
            devicesDown: 0,
            devicesWarning: 0,
            sensorsUp: 0,
            sensorsDown: 0,
            sensorsWarning: 0
          },
          criticality: 'low',
          lastUpdate: null
        };
      }
      
      const company = companySummary[companyCode];
      company.deviceCount++;
      
      const sensors = deviceData.sensors || [];
      company.sensorCount += sensors.length;
      
      // Update device status counts
      if (deviceData.status === 3) company.stats.devicesUp++;
      else if (deviceData.status === 5) company.stats.devicesDown++;
      else if (deviceData.status === 4) company.stats.devicesWarning++;
      
      // Update sensor status counts
      sensors.forEach(sensor => {
        if (sensor.status === 3) company.stats.sensorsUp++;
        else if (sensor.status === 5) company.stats.sensorsDown++;
        else if (sensor.status === 4) company.stats.sensorsWarning++;
      });
      
      // Update criticality
      if (company.stats.devicesDown > 0 || company.stats.sensorsDown > 0) {
        company.criticality = 'high';
      } else if (company.stats.devicesWarning > 0 || company.stats.sensorsWarning > 0) {
        company.criticality = 'medium';
      }
      
      // Update last update time
      const lastUpdate = new Date(deviceData.updated_at);
      if (!company.lastUpdate || lastUpdate > company.lastUpdate) {
        company.lastUpdate = lastUpdate;
      }
    });

    // Sort by device count descending
    const sortedCompanies = Object.values(companySummary)
      .sort((a, b) => b.deviceCount - a.deviceCount);

    res.json(sortedCompanies);

  } catch (error) {
    logger.error('Error fetching company summary:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch company summary' });
    }
  }
});

// Real-time dashboard stats
router.get('/dashboard/realtime-stats', async (req, res) => {
  try {
    const stats = await Promise.all([
      Device.count(),
      Device.count({ where: { status: 3 } }),
      Device.count({ where: { status: 5 } }),
      Device.count({ where: { status: 4 } }),
      Sensor.count(),
      Sensor.count({ where: { status: 5 } }),
      Sensor.count({ where: { status: 4 } })
    ]);

    const [totalDevices, devicesUp, devicesDown, devicesWarning, 
           totalSensors, sensorsDown, sensorsWarning] = stats;
           
    // Calculate company count
    const devices = await Device.findAll({ attributes: ['name'] });
    const companies = new Set();
    devices.forEach(device => {
      companies.add(extractCompanyCode(device.name));
    });

    const realtimeStats = {
      timestamp: new Date(),
      devices: {
        total: totalDevices,
        up: devicesUp,
        down: devicesDown,
        warning: devicesWarning,
        upPercent: totalDevices > 0 ? Math.round((devicesUp / totalDevices) * 100) : 0
      },
      sensors: {
        total: totalSensors,
        down: sensorsDown,
        warning: sensorsWarning,
        alerts: sensorsDown + sensorsWarning
      },
      companies: {
        total: companies.size
      },
      systemHealth: {
        overall: calculateSystemHealth(devicesUp, totalDevices, sensorsDown, totalSensors),
        status: getSystemStatus(devicesDown, devicesWarning, sensorsDown)
      }
    };

    res.json(realtimeStats);

  } catch (error) {
    logger.error('Error fetching realtime stats:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to fetch realtime stats' });
    }
  }
});

// Helper functions
function extractCompanyCode(deviceName) {
  const patterns = [
    /^([A-Z]{2,4})-/,  // VEC-, DEC-, etc.
    /^([A-Za-z]+)-/,   // CalTel-, etc.
  ];
  
  for (const pattern of patterns) {
    const match = deviceName.match(pattern);
    if (match) {
      return match[1].toUpperCase();
    }
  }
  
  return 'OTHER';
}

function getCompanyName(companyCode) {
  const companyNames = {
    'VEC': 'Vector Communications',
    'DEC': 'Digital Edge Communications', 
    'CALTEL': 'California Telecom',
    'GPS': 'GPS Network Systems',
    'EBA': 'Enterprise Business Associates',
    'CPM': 'Control Point Monitor',
    'PRTG': 'PRTG Core Services',
    'OTHER': 'Unclassified Devices'
  };
  
  return companyNames[companyCode] || `${companyCode} Network`;
}

function getDeviceType(deviceName) {
  const types = {
    'ESX': 'VMware Server',
    'ESXI': 'VMware Server', 
    'PDU': 'Power Distribution',
    'APC': 'UPS/Power',
    'CORE': 'Core Switch',
    'SW': 'Network Switch',
    'FW': 'Firewall',
    'AP': 'Access Point',
    'WLC': 'Wireless Controller',
    'MPLS': 'MPLS Router'
  };
  
  const upperName = deviceName.toUpperCase();
  for (const [key, value] of Object.entries(types)) {
    if (upperName.includes(key)) {
      return value;
    }
  }
  return 'Network Device';
}

function getCriticality(deviceName, deviceType) {
  const upperName = deviceName.toUpperCase();
  if (upperName.includes('CORE') || upperName.includes('FW') || upperName.includes('ESXI')) {
    return 'high';
  } else if (upperName.includes('SW') || upperName.includes('PDU') || upperName.includes('APC')) {
    return 'medium';
  }
  return 'low';
}

function calculateHealthScore(sensorStats) {
  if (sensorStats.total === 0) return 100;
  
  const healthyCount = sensorStats.up;
  const totalCount = sensorStats.total;
  
  return Math.round((healthyCount / totalCount) * 100);
}

function calculateSystemHealth(devicesUp, totalDevices, sensorsDown, totalSensors) {
  if (totalDevices === 0) return 100;
  
  const deviceHealthWeight = 0.7;
  const sensorHealthWeight = 0.3;
  
  const deviceHealth = (devicesUp / totalDevices) * 100;
  const sensorHealth = totalSensors > 0 ? ((totalSensors - sensorsDown) / totalSensors) * 100 : 100;
  
  return Math.round(deviceHealth * deviceHealthWeight + sensorHealth * sensorHealthWeight);
}

function getSystemStatus(devicesDown, devicesWarning, sensorsDown) {
  if (devicesDown > 0 || sensorsDown > 5) return 'critical';
  if (devicesWarning > 0 || sensorsDown > 0) return 'warning';
  return 'healthy';
}

// ============================================
// EDR SESSION MANAGEMENT ENDPOINTS
// ============================================

const sessionManager = new EDRSessionManager();

// Create new session (login)
router.post('/sessions/login', async (req, res) => {
  try {
    const { username, password, additionalData } = req.body;
    
    // Validate credentials (integrate with your auth system)
    // For now, accepting any credentials as example
    const userData = {
      user_id: username,
      username: username,
      role: 'administrator'
    };
    
    const session = await sessionManager.createSession(userData, req);
    
    res.json({
      success: true,
      sessionId: session.sessionId,
      expiresAt: session.expiresAt,
      user: {
        username: userData.username,
        role: userData.role
      },
      securityInfo: {
        riskScore: session.session.risk_score,
        deviceFingerprint: session.session.device_fingerprint
      }
    });
    
  } catch (error) {
    logger.error('Login failed:', error);
    if (!res.headersSent) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
});

// Validate session
router.post('/sessions/validate', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const validation = await sessionManager.validateSession(sessionId, req);
    
    if (validation.valid) {
      res.json({
        valid: true,
        user: {
          username: validation.session.username,
          role: validation.session.user_role
        },
        security: validation.securityStatus,
        riskScore: validation.session.risk_score
      });
    } else {
      res.status(401).json({ valid: false, reason: validation.reason });
    }
  } catch (error) {
    logger.error('Session validation failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ valid: false, error: error.message });
    }
  }
});

// Logout session
router.post('/sessions/logout', async (req, res) => {
  try {
    const { sessionId } = req.body;
    const success = await sessionManager.terminateSession(sessionId, 'user_logout');
    
    res.json({ success: success });
  } catch (error) {
    logger.error('Logout failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get session info
router.get('/sessions/:sessionId', ensureAdminOrSessionOwner, async (req, res) => {
  try {
    const session = await UserSession.findByPk(req.params.sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    const sessionDuration = session.logout_time 
      ? new Date(session.logout_time) - new Date(session.login_time)
      : Date.now() - new Date(session.login_time);
    
    res.json({
      sessionId: session.session_id,
      username: session.username,
      role: session.user_role,
      loginTime: session.login_time,
      lastActivity: session.last_activity,
      logoutTime: session.logout_time,
      status: session.session_status,
      durationMinutes: Math.round(sessionDuration / 60000),
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      riskScore: session.risk_score,
      securityEvents: (session.security_events || []).length,
      anomalies: (session.anomaly_flags || []).length,
      activities: (session.activity_log || []).slice(-10) // Last 10 activities
    });
    
  } catch (error) {
    logger.error('Failed to get session info:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get session analytics (EDR dashboard)
router.get('/sessions/analytics/:timeframe?', ensureAdmin, async (req, res) => {
  try {
    const timeframe = parseInt(req.params.timeframe) || 24;
    const analytics = await sessionManager.getSessionAnalytics(timeframe);
    
    res.json(analytics);
  } catch (error) {
    logger.error('Failed to get session analytics:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Get active sessions (admin only)
router.get('/sessions/active/list', ensureAdmin, async (req, res) => {
  try {
    const activeSessions = await UserSession.findAll({
      where: { session_status: 'active' },
      attributes: ['session_id', 'username', 'user_role', 'login_time', 'last_activity', 'ip_address', 'risk_score'],
      order: [['last_activity', 'DESC']]
    });
    
    res.json(activeSessions);
  } catch (error) {
    logger.error('Failed to get active sessions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Force terminate session (admin only)
router.post('/sessions/:sessionId/terminate', ensureAdmin, async (req, res) => {
  try {
    const { reason = 'admin_terminated' } = req.body;
    const success = await sessionManager.terminateSession(req.params.sessionId, reason);
    
    res.json({ success: success });
  } catch (error) {
    logger.error('Failed to terminate session:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

module.exports = router;
module.exports.buildAlertsTrendReport = buildAlertsTrendReport;
module.exports = router;
