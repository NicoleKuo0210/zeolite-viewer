import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- 配色狀態 ----------
const palette = {
  unit: { d4r: '#f59e0b', d6r: '#22c55e', d8r: '#a855f7', other: '#3b82f6' },
  ring: { 4: '#f59e0b', 6: '#3b82f6', 8: '#22c55e', 0: '#9ca3af' },
  sig: {},
  atoms: { Si: '#ef4444', Al: '#f3f4f6', T: '#9ca3af' },
};
// 未預先指定顏色的類別，依序從這組顏色取用
const CYCLE = ['#f59e0b', '#3b82f6', '#22c55e', '#ef4444', '#a855f7', '#14b8a6', '#ec4899', '#eab308'];
const labels = {
  unit: {
    d4r: '雙四元環 (d4r)', d6r: '雙六元環 (d6r)', d8r: '雙八元環 (d8r)', other: '其他（不屬於雙環）',
  },
  ring: (k) => (k === '0' ? '無環（邊界）' : `${k} 元環`),
  sig: (k) => (k === '' ? '無環（邊界）' : `屬於 ${k.split('-').join('、')} 元環`),
};

// ---------- Three.js 場景 ----------
const container = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14171c);
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f38, 1.1));
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(1, 1.5, 1);
scene.add(dir);
const dir2 = new THREE.DirectionalLight(0xffffff, 0.5);
dir2.position.set(-1, -0.5, -1);
scene.add(dir2);

const beadGeo = new THREE.SphereGeometry(1, 28, 18);
const beadMat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05 });
let beads = null;
let atomMesh = null;
let data = null;
let edgeClass = [];

// ---------- 載入與建立 ----------
const els = {
  search: document.getElementById('search'),
  results: document.getElementById('results'),
  current: document.getElementById('current'),
  mode: document.getElementById('mode'),
  colors: document.getElementById('colors'),
  size: document.getElementById('size'),
  atoms: document.getElementById('atoms'),
  atomColors: document.getElementById('atomColors'),
  rotate: document.getElementById('rotate'),
  info: document.getElementById('info'),
  msg: document.getElementById('msg'),
};

let structures = [];   // index.json 內容
let shown = [];        // 目前搜尋結果
let activeIdx = 0;     // 鍵盤游標位置
let currentFile = null;

const norm = (s) => s.toLowerCase().replace(/^-/, '');

function filterStructures(q) {
  q = norm(q.trim());
  if (!q) return structures.slice();
  const scored = [];
  for (const s of structures) {
    const code = norm(s.code), name = s.name.toLowerCase();
    let rank = -1;
    if (code === q) rank = 0;
    else if (code.startsWith(q)) rank = 1;
    else if (code.includes(q)) rank = 2;
    else if (name.includes(q)) rank = 3;
    if (rank >= 0) scored.push([rank, s]);
  }
  return scored.sort((x, y) => x[0] - y[0] || x[1].code.localeCompare(y[1].code)).map((x) => x[1]);
}

function renderResults() {
  els.results.replaceChildren();
  if (!shown.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = '沒有符合的結構';
    els.results.appendChild(d);
    return;
  }
  shown.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'item' + (i === activeIdx ? ' active' : '') + (s.file === currentFile ? ' cur' : '');
    row.setAttribute('role', 'option');
    const cd = document.createElement('span');
    cd.className = 'cd';
    cd.textContent = s.code;
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = s.name === s.code ? '' : s.name;
    row.append(cd, nm);
    row.addEventListener('click', () => chooseStructure(s));
    els.results.appendChild(row);
  });
  els.results.children[activeIdx]?.scrollIntoView({ block: 'nearest' });
}

function updateSearch() {
  shown = filterStructures(els.search.value);
  const cur = shown.findIndex((s) => s.file === currentFile);
  // 有輸入關鍵字 -> 游標在第一筆; 未輸入 -> 停在目前結構
  activeIdx = els.search.value.trim() ? 0 : Math.max(cur, 0);
  renderResults();
}

async function chooseStructure(s) {
  currentFile = s.file;
  els.current.textContent = `目前：${s.code}${s.name !== s.code ? ' — ' + s.name : ''}（共 ${structures.length} 個結構，符合 ${shown.length} 個）`;
  renderResults();
  await loadStructure(s.file);
}

async function loadIndex() {
  const res = await fetch('data/index.json');
  structures = await res.json();
  if (!structures.length) throw new Error('index.json 是空的');
  updateSearch();
  await chooseStructure(structures.find((s) => s.code === 'LTA') || structures[0]);
}

async function loadStructure(file) {
  const res = await fetch(`data/${file}`);
  data = await res.json();
  buildModel();
}

function disposeMeshes() {
  for (const m of [beads, atomMesh]) {
    if (m) { scene.remove(m); m.dispose(); }
  }
  beads = atomMesh = null;
}

function buildModel() {
  disposeMeshes();
  const { atoms, edges } = data;
  const n = edges.length;
  beads = new THREE.InstancedMesh(beadGeo, beadMat, n);
  edgeClass = new Array(n);
  const mids = new Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = edges[i];
    const pa = atoms[a].p, pb = atoms[b].p;
    mids[i] = new THREE.Vector3((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2);
  }
  data._mids = mids;

  atomMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshStandardMaterial({ roughness: 0.4 }), atoms.length);
  atomMesh.visible = els.atoms.checked;

  scene.add(beads, atomMesh);
  applySize();
  applyColors();
  rebuildColorPickers();
  fitCamera();
  els.info.textContent =
    `${data.code}：${atoms.length} 個 T 原子、${n} 顆珠子。` +
    `完整單元：${Object.entries(data.units || {}).map(([k, v]) => `${k}×${v.length}`).join('、') || '無'}。` +
    `環數：${Object.entries(data.ringCounts).map(([k, v]) => `${k}元環×${v}`).join('、')}。`;
}

function classOf(edge) {
  const mode = els.mode.value;
  if (mode === 'unit') return edge[3] || 'other';
  if (mode === 'sig') return edge[4] || '';
  return String(edge[2]);
}

function classLabel(mode, cls) {
  return mode === 'unit' ? (labels.unit[cls] || cls) : labels[mode](cls);
}

function colorFor(cls) {
  const table = palette[els.mode.value];
  if (!(cls in table)) table[cls] = CYCLE[Object.keys(table).length % CYCLE.length];
  return table[cls];
}

function applySize() {
  const r = data.beadRadius * parseFloat(els.size.value);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(r, r, r);
  data._mids.forEach((p, i) => {
    m.compose(p, q, s);
    beads.setMatrixAt(i, m);
  });
  beads.instanceMatrix.needsUpdate = true;

  const ra = data.beadRadius * 0.35;
  const sa = new THREE.Vector3(ra, ra, ra);
  data.atoms.forEach((a, i) => {
    m.compose(new THREE.Vector3(...a.p), q, sa);
    atomMesh.setMatrixAt(i, m);
  });
  atomMesh.instanceMatrix.needsUpdate = true;
}

function applyColors() {
  const c = new THREE.Color();
  data.edges.forEach((e, i) => {
    edgeClass[i] = classOf(e);
    c.set(colorFor(edgeClass[i]));
    beads.setColorAt(i, c);
  });
  beads.instanceColor.needsUpdate = true;
  data.atoms.forEach((a, i) => {
    c.set(palette.atoms[a.el]);
    atomMesh.setColorAt(i, c);
  });
  atomMesh.instanceColor.needsUpdate = true;
}

function pickerRow(text, value, onInput) {
  const row = document.createElement('label');
  row.className = 'row';
  const span = document.createElement('span');
  span.textContent = text;
  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  input.addEventListener('input', () => onInput(input.value));
  row.append(span, input);
  return row;
}

function rebuildColorPickers() {
  const mode = els.mode.value;
  els.colors.replaceChildren();
  const classes = [...new Set(data.edges.map(classOf))].sort();
  for (const cls of classes) {
    els.colors.appendChild(pickerRow(classLabel(mode, cls), colorFor(cls), (v) => {
      palette[mode][cls] = v;
      applyColors();
    }));
  }
  els.atomColors.replaceChildren();
  const elements = [...new Set(data.atoms.map((a) => a.el))].sort();
  for (const el of elements) {
    els.atomColors.appendChild(pickerRow(el === 'T' ? 'T 四面體（不分 Si/Al）' : `${el} 四面體`, palette.atoms[el], (v) => {
      palette.atoms[el] = v;
      applyColors();
    }));
  }
}

function fitCamera() {
  const box = new THREE.Box3();
  data.atoms.forEach((a) => box.expandByPoint(new THREE.Vector3(...a.p)));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.05;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(dist));
  camera.near = dist / 100;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  controls.update();
}

// ---------- 事件 ----------
els.search.addEventListener('input', updateSearch);
els.search.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!shown.length) return;
    activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
    renderResults();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (shown[activeIdx]) chooseStructure(shown[activeIdx]);
  } else if (e.key === 'Escape') {
    els.search.value = '';
    updateSearch();
    els.search.blur();
  }
});
window.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== els.search) {
    e.preventDefault();
    els.search.focus();
    els.search.select();
  }
});
els.mode.addEventListener('change', () => { applyColors(); rebuildColorPickers(); });
els.size.addEventListener('input', applySize);
els.atoms.addEventListener('change', () => {
  atomMesh.visible = els.atoms.checked;
  els.atomColors.style.display = els.atoms.checked ? '' : 'none';
});
els.rotate.addEventListener('change', () => { controls.autoRotate = els.rotate.checked; });
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

loadIndex().catch((err) => {
  els.msg.textContent = '載入失敗：' + err.message + '（請用 python -m http.server 開啟，不要直接雙擊 html）';
  console.error(err);
});
