/**
 * main.js
 * Honda RA621H — CPM + DAG + Kahn's Algorithm
 * Pyodide bridge + UI controller
 *
 * Tabs:
 *  1. CPM / DAG  — SVG graph + critical path panel
 *  2. Statistik  — pandas-powered charts & tables
 *  3. Kahn Algo  — step-by-step BFS visualizer
 */

'use strict';

/* ══════════════════════════════════════
   SUBSYSTEM COLORS
══════════════════════════════════════ */
const SUB_COLORS = {
  'ICE – Internal Combustion Engine': '#CC0000',
  'Turbocharger System':              '#E65100',
  'Hybrid – MGU-H':                  '#6A1B9A',
  'Hybrid – MGU-K':                  '#1565C0',
  'Energy Store (ES)':               '#2E7D32',
  'Lubrication System':              '#5D4037',
  'Cooling System':                  '#00695C',
  'Fuel System':                     '#F57F17',
  'Electronics & Control':           '#37474F',
  'Chassis & Monocoque':             '#757575',
  'Suspension – Front':              '#880E4F',
  'Suspension – Rear':               '#AD1457',
  'Aerodynamics – Front':            '#0277BD',
  'Aerodynamics – Rear':             '#01579B',
  'Gearbox & Drivetrain':            '#4A148C',
  'Braking System':                  '#B71C1C',
  'Wheels & Tyres':                  '#33691E',
  'Cockpit & Safety':                '#006064',
  'Final Assembly':                  '#424242',
};

/* ══════════════════════════════════════
   GLOBAL STATE
══════════════════════════════════════ */
const S = {
  components:  [],
  result:      null,   // full result from Python
  pyodide:     null,
  activeTab:   'cpm',

  // DAG pan/zoom
  dagTransform: { x: 0, y: 0, scale: 1 },
  dagNodes:     {},    // id -> {x,y}
  selectedNode: null,

  // Kahn stepper
  stepIdx:   -1,
  playing:   false,
  playTimer: null,
  speed:     700,
};

/* ══════════════════════════════════════
   BOOT
══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  showLoader('Memuat Pyodide…', 0);
  await initPyodide();
  showLoader('Memuat dataset…', 40);
  await loadData();
  showLoader('Menjalankan Kahn + CPM (Python)…', 60);
  await runAnalysis();
  showLoader('Render visualisasi…', 85);
  hideLoader();

  renderSummaryCards();
  renderDAG();
  renderCPMList();
  renderKahnWaveGrid();
  renderKahnInDegreeGrid();
  renderStats();
  buildKahnStepLog();
  goToKahnStep(0);
  wireControls();
  wireTabs();
  wirePseudo();
  wireDAGInteraction();
});

/* ══════════════════════════════════════
   LOADER
══════════════════════════════════════ */
function showLoader(msg, pct) {
  let el = document.getElementById('py-loader');
  if (!el) return;
  document.getElementById('py-loader-msg').textContent = msg;
  if (pct !== undefined) {
    document.getElementById('py-loader-bar').style.width = pct + '%';
  }
}
function hideLoader() {
  const el = document.getElementById('py-loader');
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; setTimeout(() => el.remove(), 450); }
}

/* ══════════════════════════════════════
   PYODIDE INIT
══════════════════════════════════════ */
async function initPyodide() {
  S.pyodide = await loadPyodide();
  showLoader('Memuat micropip…', 20);
  await S.pyodide.loadPackage('micropip');
  const micropip = S.pyodide.pyimport('micropip');
  showLoader('Menginstall pandas…', 30);
  await micropip.install('pandas');

  // Load kahn+cpm Python module
  const pyRes = await fetch('py/cpm_kahn.py');
  const pySrc = await pyRes.text();
  await S.pyodide.runPythonAsync(pySrc);
}

/* ══════════════════════════════════════
   LOAD DATA + RUN PYTHON
══════════════════════════════════════ */
async function loadData() {
  const res  = await fetch('data/components.json');
  S.components = await res.json();
}

async function runAnalysis() {
  // Pass data via Pyodide globals to avoid JSON string escaping issues
  S.pyodide.globals.set('_components_json', JSON.stringify(S.components));
  const resultJson = await S.pyodide.runPythonAsync(
    `run_full_analysis(_components_json)`
  );
  S.result = JSON.parse(resultJson);

  // Restore Map accessors
  S.result.graph._nodesMap    = new Map(Object.entries(S.result.graph.nodes));
  S.result.graph._inDegreeMap = new Map(Object.entries(S.result.graph.in_degree));

  showLoader('Render visualisasi…', 90);
}

/* ══════════════════════════════════════
   TABS
══════════════════════════════════════ */
function wireTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('sec-' + tab).classList.add('active');
      S.activeTab = tab;
      if (tab === 'cpm') resizeDAG();
    });
  });
}

/* ══════════════════════════════════════
   SUMMARY CARDS
══════════════════════════════════════ */
function renderSummaryCards() {
  const gs  = S.result.graphStats;
  const ps  = S.result.pandasStats.summary;

  $('hdr-nodes').textContent   = gs.nodeCount;
  $('hdr-edges').textContent   = gs.edgeCount;
  $('hdr-waves').textContent   = gs.waveCount;
  $('hdr-steps').textContent   = gs.stepCount;

  $('card-nodes').textContent     = gs.nodeCount;
  $('card-edges').textContent     = gs.edgeCount;
  $('card-duration').textContent  = ps.project_duration + ' hrs';
  $('card-critical').textContent  = gs.criticalCount;
  $('card-roots').textContent     = gs.rootCount;
  $('card-leaves').textContent    = gs.leafCount;
  $('card-waves').textContent     = gs.waveCount;
  $('card-subsystems').textContent= ps.subsystems;
}

/* ══════════════════════════════════════
   DAG VISUALIZATION (SVG)
══════════════════════════════════════ */
function renderDAG() {
  const svg  = document.getElementById('dag-svg');
  const W    = svg.clientWidth  || 900;
  const H    = svg.clientHeight || 550;

  const nodes    = S.result.graph.nodes;
  const adj      = S.result.graph.adj;
  const cpmNodes = S.result.cpmNodes;
  const order    = S.result.order;

  // ── Layout: layered by topological rank ──
  // Compute rank = longest path from root
  const rank = {};
  for (const nid of order) {
    const preds = S.result.graph.radj[nid] || [];
    rank[nid] = preds.length === 0 ? 0 : Math.max(...preds.map(p => rank[p] ?? 0)) + 1;
  }

  const maxRank = Math.max(...Object.values(rank));
  const byRank  = {};
  for (const [nid, r] of Object.entries(rank)) {
    if (!byRank[r]) byRank[r] = [];
    byRank[r].push(nid);
  }

  const PAD_X = 60, PAD_Y = 40;
  const usableW = W - PAD_X * 2;
  const usableH = H - PAD_Y * 2;
  const xStep   = maxRank > 0 ? usableW / maxRank : usableW;

  for (const [r, ns] of Object.entries(byRank)) {
    const ri = parseInt(r);
    const x  = PAD_X + ri * xStep;
    ns.forEach((nid, i) => {
      const y = PAD_Y + (i + 1) * usableH / (ns.length + 1);
      S.dagNodes[nid] = { x, y };
    });
  }

  // ── SVG defs (arrowhead) ──
  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';

  const defs = document.createElementNS(NS, 'defs');
  const marker = document.createElementNS(NS, 'marker');
  marker.setAttribute('id', 'arrow');
  marker.setAttribute('markerWidth', '8');
  marker.setAttribute('markerHeight', '8');
  marker.setAttribute('refX', '6');
  marker.setAttribute('refY', '3');
  marker.setAttribute('orient', 'auto');
  const arrowPath = document.createElementNS(NS, 'path');
  arrowPath.setAttribute('d', 'M0,0 L0,6 L8,3 z');
  arrowPath.setAttribute('fill', '#333');
  marker.appendChild(arrowPath);

  const markerCP = document.createElementNS(NS, 'marker');
  markerCP.setAttribute('id', 'arrow-cp');
  markerCP.setAttribute('markerWidth', '8');
  markerCP.setAttribute('markerHeight', '8');
  markerCP.setAttribute('refX', '6');
  markerCP.setAttribute('refY', '3');
  markerCP.setAttribute('orient', 'auto');
  const arrowPathCP = document.createElementNS(NS, 'path');
  arrowPathCP.setAttribute('d', 'M0,0 L0,6 L8,3 z');
  arrowPathCP.setAttribute('fill', '#E10600');
  markerCP.appendChild(arrowPathCP);

  defs.appendChild(marker);
  defs.appendChild(markerCP);
  svg.appendChild(defs);

  const gMain = document.createElementNS(NS, 'g');
  gMain.id = 'dag-main';
  svg.appendChild(gMain);

  // ── Edges ──
  const gEdges = document.createElementNS(NS, 'g');
  gEdges.id = 'dag-edges';

  for (const [src, successors] of Object.entries(adj)) {
    const fromPos = S.dagNodes[src];
    if (!fromPos) continue;
    for (const dst of successors) {
      const toPos = S.dagNodes[dst];
      if (!toPos) continue;

      const isCP   = cpmNodes[src]?.on_cp && cpmNodes[dst]?.on_cp;
      const line   = document.createElementNS(NS, 'line');
      // offset endpoints to node edge
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const R   = 6;
      line.setAttribute('x1', fromPos.x + dx / len * R);
      line.setAttribute('y1', fromPos.y + dy / len * R);
      line.setAttribute('x2', toPos.x  - dx / len * (R + 6));
      line.setAttribute('y2', toPos.y  - dy / len * (R + 6));
      line.setAttribute('stroke',       isCP ? '#E10600' : '#2a2a2a');
      line.setAttribute('stroke-width', isCP ? '1.5' : '0.8');
      line.setAttribute('marker-end',   isCP ? 'url(#arrow-cp)' : 'url(#arrow)');
      line.setAttribute('opacity',      isCP ? '0.7' : '0.5');
      gEdges.appendChild(line);
    }
  }
  gMain.appendChild(gEdges);

  // ── Nodes ──
  const gNodes = document.createElementNS(NS, 'g');
  gNodes.id = 'dag-nodes';

  for (const [nid, pos] of Object.entries(S.dagNodes)) {
    const node    = nodes[nid];
    const cpm     = cpmNodes[nid] || {};
    const color   = SUB_COLORS[node?.subsystem] ?? '#555';
    const isCP    = cpm.on_cp === true;

    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${pos.x},${pos.y})`);
    g.setAttribute('class', 'dag-node');
    g.setAttribute('data-id', nid);
    g.style.cursor = 'pointer';

    // Outer ring for critical path nodes
    if (isCP) {
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('r', '9');
      ring.setAttribute('fill', 'none');
      ring.setAttribute('stroke', '#F59E0B');
      ring.setAttribute('stroke-width', '1.5');
      ring.setAttribute('opacity', '0.8');
      g.appendChild(ring);
    }

    // Main circle
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('r', '6');
    circle.setAttribute('fill', color);
    circle.setAttribute('stroke', isCP ? '#F59E0B' : 'none');
    circle.setAttribute('stroke-width', '1');
    g.appendChild(circle);

    // ID label (only if zoomed in enough — always add, CSS opacity handles it)
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', '8');
    text.setAttribute('y', '3');
    text.setAttribute('font-size', '5');
    text.setAttribute('font-family', 'JetBrains Mono, monospace');
    text.setAttribute('fill', '#aaa');
    text.setAttribute('class', 'dag-label');
    text.textContent = nid;
    g.appendChild(text);

    g.addEventListener('click', () => openNodeDrawer(nid));
    gNodes.appendChild(g);
  }
  gMain.appendChild(gNodes);

  // Render legend
  renderDAGLegend();
}

function renderDAGLegend() {
  const container = document.getElementById('dag-legend-items');
  if (!container) return;
  container.innerHTML = '';
  const subsystems = [...new Set(S.components.map(c => c.subsystem))];
  subsystems.forEach(sub => {
    const color = SUB_COLORS[sub] ?? '#555';
    const short = sub.split('–').pop().trim();
    const div = document.createElement('div');
    div.className = 'legend-item';
    div.innerHTML = `<span class="legend-dot" style="background:${color}"></span><span>${short}</span>`;
    container.appendChild(div);
  });
  // Critical path indicator
  const cpDiv = document.createElement('div');
  cpDiv.className = 'legend-item';
  cpDiv.innerHTML = `<span class="legend-dot critical" style="background:transparent"></span><span>Critical Path</span>`;
  container.appendChild(cpDiv);
}

function resizeDAG() {
  setTimeout(renderDAG, 50);
}

/* DAG pan/zoom */
function wireDAGInteraction() {
  const svg = document.getElementById('dag-svg');
  if (!svg) return;

  let dragging = false, startX, startY, startTX, startTY;

  svg.addEventListener('mousedown', e => {
    if (e.target.closest('.dag-node')) return;
    dragging = true;
    startX = e.clientX; startY = e.clientY;
    startTX = S.dagTransform.x; startTY = S.dagTransform.y;
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    S.dagTransform.x = startTX + (e.clientX - startX);
    S.dagTransform.y = startTY + (e.clientY - startY);
    applyDAGTransform();
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    S.dagTransform.scale = Math.min(5, Math.max(0.2, S.dagTransform.scale * factor));
    applyDAGTransform();
  }, { passive: false });

  // Buttons
  document.getElementById('dag-zoom-in')?.addEventListener('click', () => {
    S.dagTransform.scale = Math.min(5, S.dagTransform.scale * 1.3);
    applyDAGTransform();
  });
  document.getElementById('dag-zoom-out')?.addEventListener('click', () => {
    S.dagTransform.scale = Math.max(0.2, S.dagTransform.scale * 0.7);
    applyDAGTransform();
  });
  document.getElementById('dag-reset')?.addEventListener('click', () => {
    S.dagTransform = { x: 0, y: 0, scale: 1 };
    applyDAGTransform();
  });
  document.getElementById('dag-fit')?.addEventListener('click', fitDAG);
}

function applyDAGTransform() {
  const g = document.getElementById('dag-main');
  if (g) g.setAttribute('transform',
    `translate(${S.dagTransform.x},${S.dagTransform.y}) scale(${S.dagTransform.scale})`);
}

function fitDAG() {
  const svg = document.getElementById('dag-svg');
  if (!svg || !Object.keys(S.dagNodes).length) return;
  const W = svg.clientWidth, H = svg.clientHeight;
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (const p of Object.values(S.dagNodes)) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const contentW = maxX - minX || 1, contentH = maxY - minY || 1;
  const scaleX = (W - 80) / contentW, scaleY = (H - 80) / contentH;
  const scale = Math.min(scaleX, scaleY, 3);
  S.dagTransform = {
    x: W / 2 - (minX + contentW / 2) * scale,
    y: H / 2 - (minY + contentH / 2) * scale,
    scale
  };
  applyDAGTransform();
}

/* ══════════════════════════════════════
   NODE DRAWER
══════════════════════════════════════ */
function openNodeDrawer(nid) {
  const node = S.result.graph.nodes[nid];
  const cpm  = S.result.cpmNodes[nid] || {};
  if (!node) return;

  $('nd-id').textContent  = nid;
  $('nd-name').textContent = node.name || '';
  $('nd-sub').textContent  = node.subsystem || '';

  const isCP = cpm.on_cp;
  $('nd-cp-tag').style.display = isCP ? 'inline-block' : 'none';

  $('nd-duration').textContent = (node.duration || 0) + ' hrs';
  $('nd-es').textContent = cpm.ES ?? '—';
  $('nd-ef').textContent = cpm.EF ?? '—';
  $('nd-ls').textContent = cpm.LS ?? '—';
  $('nd-lf').textContent = cpm.LF ?? '—';
  $('nd-float').textContent = cpm.Float !== undefined ? cpm.Float + ' hrs' : '—';
  $('nd-material').textContent = node.material || '—';
  $('nd-weight').textContent   = node.weight   || '—';

  const deps = (node.deps || []).join(', ') || '—';
  $('nd-deps').textContent = deps;

  // Successors
  const succs = (S.result.graph.adj[nid] || []).join(', ') || '—';
  $('nd-succs').textContent = succs;

  $('nd-notes').textContent = node.notes || '';

  document.getElementById('node-drawer').classList.add('open');
  document.getElementById('node-drawer-backdrop').classList.add('active');
  S.selectedNode = nid;
}

function closeNodeDrawer() {
  document.getElementById('node-drawer').classList.remove('open');
  document.getElementById('node-drawer-backdrop').classList.remove('active');
  S.selectedNode = null;
}

/* ══════════════════════════════════════
   CPM LIST (side panel)
══════════════════════════════════════ */
function renderCPMList() {
  const container = $('cpm-list');
  if (!container) return;
  container.innerHTML = '';

  const order    = S.result.order;
  const nodes    = S.result.graph.nodes;
  const cpmNodes = S.result.cpmNodes;
  const gs       = S.result.graphStats;
  const maxEF    = gs.projectDuration;

  order.forEach(nid => {
    const node = nodes[nid];
    const cpm  = cpmNodes[nid] || {};
    const isCP = cpm.on_cp;

    const div = document.createElement('div');
    div.className = `cpm-node-item${isCP ? ' critical' : ''}`;
    div.dataset.id = nid;

    const esW  = Math.round((cpm.ES / maxEF) * 100);
    const lsW  = Math.round((cpm.LS / maxEF) * 100);
    const floatVal = cpm.Float ?? 0;

    div.innerHTML = `
      <div class="cni-top">
        <span class="cni-id">${nid}${isCP ? '<span class="cp-badge">CP</span>' : ''}</span>
        <span class="cni-float ${floatVal === 0 ? 'zero' : ''}">Float: ${floatVal} h</span>
      </div>
      <div class="cni-name">${(node?.name || '').slice(0, 44)}</div>
      <div class="cni-bars">
        <div class="cni-bar">
          <span class="cni-bar-label">ES</span>
          <div class="cni-bar-track"><div class="cni-bar-fill fill-es" style="width:${esW}%"></div></div>
          <span class="cni-bar-val">${cpm.ES}</span>
        </div>
        <div class="cni-bar">
          <span class="cni-bar-label">LS</span>
          <div class="cni-bar-track"><div class="cni-bar-fill fill-ls" style="width:${lsW}%"></div></div>
          <span class="cni-bar-val">${cpm.LS}</span>
        </div>
      </div>
    `;
    div.addEventListener('click', () => openNodeDrawer(nid));
    container.appendChild(div);
  });
}

/* ══════════════════════════════════════
   STATISTICS SECTION (pandas data)
══════════════════════════════════════ */
function renderStats() {
  const ps = S.result.pandasStats;

  // ── Subsystem table ──
  renderSubsystemTable(ps.subsys_stats);

  // ── Float distribution bar chart ──
  renderFloatDistChart(ps.float_dist);

  // ── Avg float by subsystem ──
  renderFloatBySubChart(ps.float_by_sub);

  // ── Critical path timeline ──
  renderCPTimeline(ps.cp_detail);
}

function renderSubsystemTable(data) {
  const tbody = $('subsys-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  data.forEach(row => {
    const color = SUB_COLORS[row.subsystem] ?? '#555';
    const short = row.subsystem.split('–').pop().trim();
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span class="sub-dot" style="background:${color}"></span>${short}</td>
      <td>${row.jumlah_komponen}</td>
      <td>${row.total_durasi}</td>
      <td>${row.mean_durasi}</td>
      <td class="cp-count">${row.komponen_kritis}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderFloatDistChart(data) {
  const container = $('float-dist-chart');
  if (!container) return;
  container.innerHTML = '';
  const maxCount = Math.max(...data.map(d => d.count), 1);
  data.forEach(d => {
    if (d.count === 0) return;
    const pct = Math.round((d.count / maxCount) * 100);
    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label">${d.bin}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:#E10600;opacity:${d.bin.startsWith('[0') ? 1 : 0.5}"></div></div>
      <div class="bar-val">${d.count}</div>
    `;
    container.appendChild(row);
  });
}

function renderFloatBySubChart(data) {
  const container = $('float-sub-chart');
  if (!container) return;
  container.innerHTML = '';
  const maxVal = Math.max(...data.map(d => d.avg_float), 1);
  data.forEach(d => {
    const color = SUB_COLORS[d.subsystem] ?? '#555';
    const short = d.subsystem.split('–').pop().trim();
    const pct   = Math.round((d.avg_float / maxVal) * 100);
    const row   = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label" title="${d.subsystem}">${short}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="bar-val">${d.avg_float}</div>
    `;
    container.appendChild(row);
  });
}

function renderCPTimeline(data) {
  const container = $('cp-timeline');
  if (!container) return;
  container.innerHTML = '';
  const maxEF = Math.max(...data.map(d => d.EF), 1);
  data.forEach(d => {
    const esW  = Math.round((d.ES / maxEF) * 100);
    const durW = Math.max(Math.round((d.duration / maxEF) * 100), 1);
    const short = (d.name || d.id).slice(0, 36);
    const row  = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:0.75rem;margin-bottom:0.4rem;';
    row.innerHTML = `
      <div style="font-family:var(--ff-m);font-size:0.58rem;color:var(--t3);min-width:38px;text-align:right">${d.id}</div>
      <div style="flex:1;position:relative;height:18px;background:var(--bg-4);border-radius:3px;overflow:hidden;">
        <div style="position:absolute;left:${esW}%;width:${durW}%;height:100%;background:#E10600;opacity:0.8;border-radius:2px;" title="${short} | ES:${d.ES} EF:${d.EF}"></div>
      </div>
      <div style="font-family:var(--ff-m);font-size:0.58rem;color:var(--t2);min-width:50px">${d.ES}–${d.EF}h</div>
    `;
    container.appendChild(row);
  });
}

/* ══════════════════════════════════════
   KAHN SECTION
══════════════════════════════════════ */

function renderKahnWaveGrid() {
  const area = $('wave-area');
  if (!area) return;
  area.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'wave-grid';
  grid.id = 'wave-grid';

  const nodesMap    = S.result.graph._nodesMap;
  const inDegreeMap = S.result.graph._inDegreeMap;

  S.result.waves.forEach((wave, wi) => {
    const row = document.createElement('div');
    row.className = 'wave-row';
    row.dataset.wave = wi;
    row.innerHTML = `
      <div class="wave-label-col">
        <div class="wave-num">Wave ${wi + 1}</div>
        <div class="wave-sub">${wave.length} node${wave.length > 1 ? 's' : ''}</div>
      </div>
      <div class="wave-nodes" id="wave-nodes-${wi}">
        ${wave.map(id => {
          const comp     = nodesMap.get(id);
          const color    = SUB_COLORS[comp?.subsystem] ?? '#555';
          const shortNm  = (comp?.name ?? id).slice(0, 18) + ((comp?.name?.length ?? 0) > 18 ? '…' : '');
          return `
            <div class="node-card state-pending" id="nc-${id}" data-id="${id}">
              <span class="nc-id">${id}</span>
              <span class="nc-name" style="--sub-color:${color}" title="${comp?.name ?? ''}">${shortNm}</span>
              <span class="nc-deg" id="ncdeg-${id}">in: ${inDegreeMap.get(id) ?? 0}</span>
            </div>`;
        }).join('')}
      </div>
    `;
    grid.appendChild(row);
  });
  area.appendChild(grid);
}

function renderKahnInDegreeGrid() {
  const grid = $('indegree-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const nodesMap    = S.result.graph._nodesMap;
  const inDegreeMap = S.result.graph._inDegreeMap;
  for (const [id] of nodesMap) {
    const d   = inDegreeMap.get(id) ?? 0;
    const div = document.createElement('div');
    div.className = `id-cell ${d === 0 ? 'zero' : ''}`;
    div.id = `idc-${id}`;
    div.innerHTML = `<span class="id-cell-id">${id}</span><span class="id-cell-deg ${d===0?'deg-zero':'deg-pos'}" id="idcd-${id}">${d}</span>`;
    grid.appendChild(div);
  }
}

function buildKahnStepLog() {
  const log = $('step-log');
  if (!log) return;
  log.innerHTML = '';
  S.result.steps.forEach((step, i) => {
    const div = document.createElement('div');
    div.className = 'log-item';
    div.dataset.idx = i;
    div.onclick = () => goToKahnStep(i);
    const phaseLabel = { init:'INIT','wave-start':'WAVE',process:'PROCESS',done:'DONE' }[step.phase] ?? step.phase.toUpperCase();
    const phaseClass = { init:'phase-init','wave-start':'phase-wave',process:'phase-proc',done:'phase-done' }[step.phase] ?? 'phase-init';
    const queuePills = (step.queue??[]).map(id => `<span class="qpill ${(step.justQueued??[]).includes(id)?'just-queued':''}">${id}</span>`).join('');
    const donePills  = (step.justDone??[]).map(id => `<span class="qpill just-done">${id}</span>`).join('');
    div.innerHTML = `
      <div class="log-step-num">STEP ${String(i+1).padStart(3,'0')} / ${S.result.steps.length}</div>
      <span class="log-phase-badge ${phaseClass}">${phaseLabel}</span>
      <div class="log-desc">${step.description}</div>
      ${donePills||queuePills ? `<div class="log-queue">${donePills?`<span class="log-queue-label">DONE:</span>${donePills}`:''}${queuePills?`<span class="log-queue-label" style="margin-left:${donePills?'0.5rem':'0'}">QUEUE:</span>${queuePills}`:''}</div>` : ''}
    `;
    log.appendChild(div);
  });
}

function goToKahnStep(idx) {
  if (!S.result) return;
  idx = Math.max(0, Math.min(idx, S.result.steps.length - 1));
  S.stepIdx = idx;
  const step = S.result.steps[idx];
  updateKahnStepLog(idx);
  updateAlgoHighlight(step);
  updateKahnWaveGrid(step);
  updateKahnInDegreeGrid(step);
  updateOrderStrip(step);
  updateResultBanner(step);
  updatePseudoHighlight(step);
  updateKahnNavButtons();
  $('step-counter').textContent = `${idx+1} / ${S.result.steps.length}`;
}

function updateKahnStepLog(idx) {
  document.querySelectorAll('.log-item').forEach((el, i) => {
    el.classList.remove('current','past');
    if (i === idx) { el.classList.add('current'); el.scrollIntoView({block:'nearest',behavior:'smooth'}); }
    else if (i < idx) el.classList.add('past');
  });
}

function updateAlgoHighlight(step) {
  document.querySelectorAll('.asi-step').forEach(el => el.classList.remove('active-phase'));
  const map = { init:'asi-1','wave-start':'asi-2',process:'asi-3',done:'asi-4' };
  const t = map[step.phase];
  if (t) $(t)?.classList.add('active-phase');
}

function updateKahnWaveGrid(step) {
  const { order, wave, phase } = step;
  const processedSet = new Set(order ?? []);
  const queueSet     = new Set(step.queue ?? []);
  const activeNode   = step.activeNode;

  document.querySelectorAll('.wave-row').forEach(row => {
    const wi = parseInt(row.dataset.wave);
    row.classList.remove('active-wave','done-wave');
    if (wi === step.waveIndex && phase !== 'done') row.classList.add('active-wave');
    else if (wi < step.waveIndex) row.classList.add('done-wave');
  });

  S.result.waves.forEach(w => {
    w.forEach(id => {
      const card = $(`nc-${id}`);
      if (!card) return;
      card.classList.remove('state-pending','state-queued','state-active','state-done');
      if (processedSet.has(id))  card.classList.add('state-done');
      else if (id === activeNode) card.classList.add('state-active');
      else if (queueSet.has(id)) card.classList.add('state-queued');
      else                       card.classList.add('state-pending');
      const degEl = $(`ncdeg-${id}`);
      if (degEl) degEl.textContent = processedSet.has(id) ? '✓' : `in: ${(step.degree??{})[id]??0}`;
    });
  });
}

function updateKahnInDegreeGrid(step) {
  const { order, degree, activeNode, justQueued } = step;
  const processedSet  = new Set(order ?? []);
  const justQueuedSet = new Set(justQueued ?? []);
  for (const [id] of S.result.graph._nodesMap) {
    const cell  = $(`idc-${id}`);
    const degEl = $(`idcd-${id}`);
    if (!cell || !degEl) continue;
    cell.classList.remove('done','zero','active-node','just-freed');
    if (processedSet.has(id)) {
      cell.classList.add('done');
      degEl.className = 'id-cell-deg deg-done';
      degEl.textContent = '✓';
    } else {
      const d = (degree??{})[id] ?? 0;
      degEl.textContent = d;
      if (id === activeNode)           { cell.classList.add('active-node'); degEl.className='id-cell-deg deg-pos'; }
      else if (justQueuedSet.has(id)) { cell.classList.add('just-freed');  degEl.className='id-cell-deg deg-zero'; }
      else if (d === 0)                { cell.classList.add('zero');         degEl.className='id-cell-deg deg-zero'; }
      else                             { degEl.className='id-cell-deg deg-pos'; }
    }
  }
}

function updateOrderStrip(step) {
  const strip    = $('order-nodes');
  const newOrder = step.order ?? [];
  const prevLen  = strip.querySelectorAll('.onode').length;
  if (newOrder.length === prevLen) return;
  strip.innerHTML = newOrder.map((id,i) => `<span class="onode ${i>=prevLen?'newest':''}">${id}</span>`).join('');
  strip.scrollLeft = strip.scrollWidth;
}

function updateResultBanner(step) {
  const banner = $('result-banner');
  if (!banner) return;
  if (step.phase === 'done') {
    banner.classList.add('show');
    const st = S.result.graphStats;
    banner.innerHTML = `
      <div class="rb-title">${step.valid?'✓ VALID — No Cycles':'⚠ CYCLE DETECTED'}</div>
      <div class="rb-stats">
        <div class="rb-stat"><span>${st.nodeCount}</span> nodes sorted</div>
        <div class="rb-stat"><span>${st.waveCount}</span> waves</div>
        <div class="rb-stat"><span>${st.maxWaveSize}</span> max parallel</div>
        <div class="rb-stat"><span>${st.avgWaveSize}</span> avg wave size</div>
      </div>`;
  } else banner.classList.remove('show');
}

const PSEUDO_MAP = {
  init:['1','2','3','4','5'],
  'wave-start':['7','8','9'],
  process:['10','11','12','13','14'],
  done:['16','17'],
};
function updatePseudoHighlight(step) {
  const lines = PSEUDO_MAP[step.phase] ?? [];
  document.querySelectorAll('.pseudo-line').forEach(el => {
    el.classList.toggle('hl', lines.includes(el.dataset.line));
  });
}

function updateKahnNavButtons() {
  const btnPrev  = $('btn-prev');
  const btnNext  = $('btn-next');
  const btnPlay  = $('btn-play');
  if (btnPrev) btnPrev.disabled = S.stepIdx <= 0;
  if (btnNext) btnNext.disabled = S.stepIdx >= S.result.steps.length - 1;
  if (btnPlay) btnPlay.textContent = S.playing ? '⏸ Pause' : '▶ Play';
}

/* ══════════════════════════════════════
   KAHN CONTROLS
══════════════════════════════════════ */
function wireControls() {
  $('btn-prev')?.addEventListener('click',  () => { stopPlay(); goToKahnStep(S.stepIdx - 1); });
  $('btn-next')?.addEventListener('click',  () => { stopPlay(); goToKahnStep(S.stepIdx + 1); });
  $('btn-first')?.addEventListener('click', () => { stopPlay(); goToKahnStep(0); });
  $('btn-last')?.addEventListener('click',  () => { stopPlay(); goToKahnStep(S.result.steps.length - 1); });
  $('btn-play')?.addEventListener('click',  () => S.playing ? stopPlay() : startPlay());

  $('speed-range')?.addEventListener('input', e => {
    const v = parseInt(e.target.value);
    S.speed = Math.round(1600 - v * 150);
    $('speed-label').textContent = v<=3?'slow':v<=7?'mid':'fast';
  });

  document.addEventListener('keydown', e => {
    if (S.activeTab !== 'kahn') return;
    if (e.target.tagName === 'INPUT') return;
    if (e.key==='ArrowRight'||e.key==='l') { stopPlay(); goToKahnStep(S.stepIdx+1); }
    if (e.key==='ArrowLeft' ||e.key==='h') { stopPlay(); goToKahnStep(S.stepIdx-1); }
    if (e.key===' ') { e.preventDefault(); S.playing?stopPlay():startPlay(); }
    if (e.key==='Home') { stopPlay(); goToKahnStep(0); }
    if (e.key==='End')  { stopPlay(); goToKahnStep(S.result.steps.length-1); }
  });

  $('nd-close-btn')?.addEventListener('click', closeNodeDrawer);
  $('node-drawer-backdrop')?.addEventListener('click', closeNodeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && S.selectedNode) closeNodeDrawer();
  });
  $('cpm-filter-all')?.addEventListener('click', () => filterCPMList('all'));
  $('cpm-filter-cp')?.addEventListener('click',  () => filterCPMList('cp'));
}

function filterCPMList(mode) {
  document.querySelectorAll('.cpm-node-item').forEach(el => {
    if (mode === 'all') el.style.display = '';
    else el.style.display = el.classList.contains('critical') ? '' : 'none';
  });
  document.querySelectorAll('.cpm-filter-btn').forEach(b => b.classList.remove('active'));
  $(mode === 'all' ? 'cpm-filter-all' : 'cpm-filter-cp')?.classList.add('active');
}

function startPlay() {
  if (S.stepIdx >= S.result.steps.length - 1) goToKahnStep(0);
  S.playing = true;
  updateKahnNavButtons();
  tick();
}
function stopPlay() {
  S.playing = false;
  clearTimeout(S.playTimer);
  updateKahnNavButtons();
}
function tick() {
  if (!S.playing) return;
  if (S.stepIdx >= S.result.steps.length - 1) { stopPlay(); return; }
  goToKahnStep(S.stepIdx + 1);
  S.playTimer = setTimeout(tick, S.speed);
}

function wirePseudo() {
  const panel = document.getElementById('pseudo-panel');
  document.getElementById('pseudo-header')?.addEventListener('click', () => {
    panel?.classList.toggle('collapsed');
    const toggle = document.querySelector('.pseudo-toggle');
    if (toggle) toggle.textContent = panel?.classList.contains('collapsed') ? '▼ expand' : '▲ collapse';
  });
}

/* ══════════════════════════════════════
   UTIL
══════════════════════════════════════ */
function $(id) { return document.getElementById(id); }
