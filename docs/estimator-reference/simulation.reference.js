
/* ------------------------- Simulation ------------------------- */
var CAP = { cast: 18, trucks: 4, crane: 24 };
var DRV = [
  { k: "conc", label: "Concrete price", lo: 0.9, mid: 1, hi: 1.25 },
  { k: "rebar", label: "Steel price", lo: 0.85, mid: 1, hi: 1.35 },
  { k: "insul", label: "Insulation and fittings", lo: 0.9, mid: 1, hi: 1.15 },
  { k: "lab", label: "Labour cost", lo: 0.9, mid: 1, hi: 1.2 },
  { k: "prod", label: "Crew productivity", lo: 0.8, mid: 1, hi: 1.1 },
  { k: "trans", label: "Transport cost", lo: 0.9, mid: 1, hi: 1.3 },
  { k: "erect", label: "Erection cost", lo: 0.9, mid: 1, hi: 1.25 }
];
var wi = {}; DRV.forEach(function (d) { wi[d.k] = 1; });
function costWith(c, m) {
  var mat = c.parts.conc * m.conc + c.parts.rebar * m.rebar + (c.insulCost + c.insertCost) * m.insul;
  var lab = c.comp.labour * m.lab / m.prod;
  var oh = (mat + c.comp.moulds + lab) * R.oh;
  return mat + c.comp.moulds + lab + oh + c.comp.transport * m.trans + c.comp.erection * m.erect;
}
function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function tri(r, a, b, c) { var u = r(), f = (b - a) / (c - a); return u < f ? a + Math.sqrt(u * (c - a) * (b - a)) : c - Math.sqrt((1 - u) * (c - a) * (c - b)); }
function pct(arr, q) { return arr[Math.min(arr.length - 1, Math.floor(q * arr.length))]; }
function risk(c) {
  var r = rng(42), N = 2000, res = [], i;
  for (i = 0; i < N; i++) { var m = {}; DRV.forEach(function (d) { m[d.k] = tri(r, d.lo, d.mid, d.hi) * wi[d.k]; }); res.push(costWith(c, m)); }
  res.sort(function (a, b) { return a - b; });
  var price = c.price, loss = 0, thin = 0;
  res.forEach(function (x) { if (x > price) loss++; if ((price - x) / price < R.margin * 0.5) thin++; });
  var tor = DRV.map(function (d) {
    var lo = {}, hi = {}; DRV.forEach(function (q) { lo[q.k] = wi[q.k]; hi[q.k] = wi[q.k]; });
    lo[d.k] = d.lo * wi[d.k]; hi[d.k] = d.hi * wi[d.k];
    var a = costWith(c, lo), b = costWith(c, hi); return { label: d.label, lo: Math.min(a, b), hi: Math.max(a, b) };
  });
  var mid = {}; DRV.forEach(function (d) { mid[d.k] = wi[d.k]; });
  tor.sort(function (a, b) { return (b.hi - b.lo) - (a.hi - a.lo); });
  return { res: res, p10: pct(res, 0.1), p50: pct(res, 0.5), p90: pct(res, 0.9), loss: loss / N, thin: thin / N, tor: tor, likely: costWith(c, mid) };
}
function simPanels(p, c) {
  var prodD = Math.max(1, Math.ceil(c.vol / CAP.cast)), trD = Math.max(1, Math.ceil(c.loads / CAP.trucks)), erD = Math.max(1, Math.ceil(c.vol / CAP.crane));
  var trStart = 5, erStart = 6, trEnd = trStart + trD, erEnd = Math.max(trEnd + 1, erStart + erD), total = Math.max(prodD, erEnd);
  var rows = [["Casting in the factory", 0, prodD, "var(--accent)"], ["Transport to site", trStart, trEnd, "#d29a3a"], ["Crane and erection", erStart, erEnd, "#58a37a"]];
  $("gantt").innerHTML = rows.map(function (r) {
    return '<div class="gr"><span>' + r[0] + '</span><div class="gtrack"><div class="gbar" style="left:' + (r[1] / total * 100) + '%;width:' + ((r[2] - r[1]) / total * 100) + '%;background:' + r[3] + '"></div></div><span style="text-align:right">' + (r[2] - r[1]) + ' d</span></div>';
  }).join("");
  $("ganttNote").textContent = "About " + total + " working days from first casting to the last panel in place (" + fmt(c.vol, 0) + " m³ at " + CAP.cast + " m³/day casting, " + c.loads + " truck loads at " + CAP.trucks + " per day, crane at " + CAP.crane + " m³/day). Capacities are illustrative.";
  var k = risk(c), lo = k.res[0], hi = k.res[k.res.length - 1];
  $("kpis").innerHTML = [["Likely cost", "SAR " + fmt(k.likely)], ["Cost range (P10 to P90)", fmt(k.p10 / 1000) + "k to " + fmt(k.p90 / 1000) + "k"], ["Chance cost exceeds the price", fmt(k.loss * 100, 1) + "%"], ["Chance margin falls under half of target", fmt(k.thin * 100, 1) + "%"]]
    .map(function (x) { return '<div><span>' + x[0] + '</span><b>' + x[1] + '</b></div>'; }).join("");
  var bins = 28, cnt = [], mx = 0, span = (hi - lo) || 1, i;
  for (i = 0; i < bins; i++) cnt.push(0);
  k.res.forEach(function (x) { var b = Math.min(bins - 1, Math.floor((x - lo) / span * bins)); cnt[b]++; });
  cnt.forEach(function (x) { if (x > mx) mx = x; });
  var W = 640, H = 170, pl = 8, pr = 8, pt = 10, pb = 28, bw = (W - pl - pr) / bins, svg = '';
  function X(v) { return pl + (Math.min(Math.max(v, lo), hi) - lo) / span * (W - pl - pr); }
  cnt.forEach(function (x, j) { var h = x / mx * (H - pt - pb); svg += '<rect x="' + (pl + j * bw + 1) + '" y="' + (H - pb - h) + '" width="' + (bw - 2) + '" height="' + h + '" rx="2" fill="var(--accent)" opacity="0.75"/>'; });
  svg += '<line x1="' + X(c.price) + '" x2="' + X(c.price) + '" y1="' + pt + '" y2="' + (H - pb) + '" stroke="#c4675a" stroke-width="2"/>';
  var lx = X(c.price), anchor = lx > W * 0.6 ? "end" : "start", tx = anchor === "end" ? lx - 5 : lx + 5;
  svg += '<text x="' + tx + '" y="' + (pt + 10) + '" font-size="11" text-anchor="' + anchor + '" fill="var(--ink)">Quote price before VAT</text>';
  svg += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + (H - pb) + '" y2="' + (H - pb) + '" stroke="var(--line)"/>';
  svg += '<text x="' + pl + '" y="' + (H - 8) + '" font-size="11" fill="var(--muted)">SAR ' + fmt(lo / 1000) + 'k</text><text x="' + (W - pr) + '" y="' + (H - 8) + '" font-size="11" text-anchor="end" fill="var(--muted)">SAR ' + fmt(hi / 1000) + 'k</text>';
  svg += '<text x="' + X(k.p50) + '" y="' + (H - 8) + '" font-size="11" text-anchor="middle" fill="var(--ink)">median ' + fmt(k.p50 / 1000) + 'k</text>';
  $("hist").innerHTML = svg;
  var tmax = Math.max.apply(null, k.tor.map(function (t) { return t.hi; })), tmin = Math.min.apply(null, k.tor.map(function (t) { return t.lo; }));
  var sp = (tmax - tmin) || 1;
  $("tor").innerHTML = k.tor.map(function (t) {
    return '<div class="tr"><span>' + t.label + '</span><div class="ttrack"><div class="tbar" style="left:' + ((t.lo - tmin) / sp * 100) + '%;width:' + Math.max(1.5, (t.hi - t.lo) / sp * 100) + '%"></div></div><span style="text-align:right">±' + fmt((t.hi - t.lo) / 2 / 1000, 1) + 'k</span></div>';
  }).join("");
  if (!$("wi").dataset.ready) {
    $("wi").dataset.ready = "1";
    $("wi").innerHTML = DRV.map(function (d) { return '<div class="f"><label for="wi_' + d.k + '">' + d.label + ' <span id="wv_' + d.k + '">×1.00</span></label><input id="wi_' + d.k + '" data-wi="' + d.k + '" type="range" min="0.7" max="1.5" step="0.01" value="1"></div>'; }).join("");
  }
}
document.addEventListener("input", function (e) { var k = e.target.dataset && e.target.dataset.wi; if (k) { wi[k] = +e.target.value; $("wv_" + k).textContent = "×" + (+e.target.value).toFixed(2); render(); } });

/* ---- 3D build sequence ---- */
var T = { ready: false, step: 99, steps: [], playing: false, anim: 0, last: 0, rotY: 0.7, rotX: 0.5, dist: 46, target: null };
function cssc(n, f) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || f; }
function build3d(p) {
  var el = $("three");
  if (!window.THREE) { el.innerHTML = '<p class="help" style="padding:16px">The 3D view could not load.</p>'; return; }
  if (!T.ready) {
    T.scene = new THREE.Scene(); T.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
    T.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); T.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    el.appendChild(T.renderer.domElement);
    T.scene.add(new THREE.AmbientLight(0xffffff, 0.75)); var dl = new THREE.DirectionalLight(0xffffff, 0.65); dl.position.set(30, 50, 20); T.scene.add(dl);
    T.root = new THREE.Group(); T.scene.add(T.root);
    var drag = null;
    el.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; el.style.cursor = "grabbing"; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", function (e) { if (!drag) return; T.rotY -= (e.clientX - drag.x) * 0.008; T.rotX = Math.max(0.1, Math.min(1.4, T.rotX + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", function () { drag = null; el.style.cursor = "grab"; });
    el.addEventListener("wheel", function (e) { e.preventDefault(); T.dist = Math.max(20, Math.min(120, T.dist * (1 + e.deltaY * 0.001))); }, { passive: false });
    if (window.ResizeObserver) new ResizeObserver(function () { size3d(); }).observe(el);
    T.ready = true;
    requestAnimationFrame(loop3d);
  }
  while (T.root.children.length) { var o = T.root.children[0]; T.root.remove(o); if (o.geometry) o.geometry.dispose(); }
  var A = p.area, P = p.perim, half = P / 2, disc = half * half - 4 * A, w, d;
  if (disc >= 0) { w = (half + Math.sqrt(disc)) / 2; d = (half - Math.sqrt(disc)) / 2; } else { w = d = Math.sqrt(A); }
  var fh = p.height, th = Math.max(0.15, p.thk), steps = [];
  var col = new THREE.Color(cssc("--concrete", "#c9d1d9")), col2 = new THREE.Color(cssc("--accent", "#0e7c86")), edge = new THREE.Color(cssc("--concrete-line", "#8d99a6"));
  function add(geo, x, y, z, step, color) {
    var m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: color || col })); m.position.set(x, y, z); m.userData = { step: step, y0: y };
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge }))); T.root.add(m); return m;
  }
  steps.push("Foundation base");
  add(new THREE.BoxGeometry(w + 2, 0.4, d + 2), 0, -0.2, 0, 0, new THREE.Color(cssc("--ground", "#d6cdbf")));
  var s = 1, i;
  function walls(f, step) {
    var y = f * (fh + 0.25) + fh / 2, nW = Math.max(1, Math.round(w / 2.4)), nD = Math.max(1, Math.round(d / 2.4));
    for (i = 0; i < nW; i++) { var x = -w / 2 + (i + 0.5) * (w / nW); add(new THREE.BoxGeometry(w / nW - 0.06, fh, th), x, y, d / 2, step); add(new THREE.BoxGeometry(w / nW - 0.06, fh, th), x, y, -d / 2, step); }
    for (i = 0; i < nD; i++) { var z = -d / 2 + (i + 0.5) * (d / nD); add(new THREE.BoxGeometry(th, fh, d / nD - 0.06), w / 2, y, z, step); add(new THREE.BoxGeometry(th, fh, d / nD - 0.06), -w / 2, y, z, step); }
  }
  for (var f = 0; f < p.floors; f++) {
    steps.push("Floor " + (f + 1) + ": external wall panels"); walls(f, s++);
    steps.push(f === p.floors - 1 ? "Roof slabs" : "Floor " + (f + 2) + " slabs");
    add(new THREE.BoxGeometry(w + 0.4, 0.25, d + 0.4), 0, f * (fh + 0.25) + fh + 0.125, 0, s++, col2);
    if (f === 0 && p.flights > 0) {
      steps.push("Stair flights");
      for (var q = 0; q < p.flights; q++) add(new THREE.BoxGeometry(1.2, 0.25, 3.2), -w / 2 + 1.5 + q * 1.4, fh * (q + 1) / (p.flights + 1), -d / 2 + 2.2, s, col2);
      s++;
    }
  }
  if (p.bw > 0) {
    steps.push("Boundary wall");
    var ow = w + 10, od = d + 10, per = 2 * (ow + od), n = Math.ceil(p.bw / 2.4), seg = 2.4;
    for (i = 0; i < n; i++) {
      var u = (i * seg) % per, bx, bz, rot = 0;
      if (u < ow) { bx = -ow / 2 + u; bz = od / 2; } else if (u < ow + od) { bx = ow / 2; bz = od / 2 - (u - ow); rot = Math.PI / 2; } else if (u < 2 * ow + od) { bx = ow / 2 - (u - ow - od); bz = -od / 2; } else { bx = -ow / 2; bz = -od / 2 + (u - 2 * ow - od); rot = Math.PI / 2; }
      var bm = add(new THREE.BoxGeometry(seg - 0.06, 2.4, 0.18), bx, 1.2, bz, s, col); bm.rotation.y = rot;
    }
    s++;
  }
  T.steps = steps; var sq = $("seq"); sq.max = steps.length - 1; if (T.step > steps.length - 1) T.step = steps.length - 1; sq.value = T.step;
  T.target = new THREE.Vector3(0, p.floors * fh / 2, 0); T.dist = Math.max(36, (w + d) * 1.3 + p.floors * 3);
  size3d(); updateStep();
}
function size3d() { var el = $("three"); if (!T.ready || !el.clientWidth) return; T.renderer.setSize(el.clientWidth, el.clientHeight, false); T.camera.aspect = el.clientWidth / el.clientHeight; T.camera.updateProjectionMatrix(); }
function updateStep() {
  if (!T.ready) return;
  T.root.children.forEach(function (m) { m.visible = m.userData.step <= T.step; });
  $("stepLabel").textContent = "Step " + (T.step + 1) + " of " + T.steps.length + ": " + T.steps[T.step];
  T.anim = performance.now();
}
function loop3d(t) {
  requestAnimationFrame(loop3d);
  if (mode !== "sim" || !T.ready) return;
  if (T.playing && t - T.last > 1100) { T.last = t; if (T.step < T.steps.length - 1) { T.step++; $("seq").value = T.step; updateStep(); } else { T.playing = false; $("play").textContent = "Play"; } }
  var k = Math.min(1, (t - T.anim) / 650);
  T.root.children.forEach(function (m) { m.position.y = (m.userData.step === T.step && m.visible) ? m.userData.y0 + (1 - k) * (1 - k) * 6 : m.userData.y0; });
  var cx = T.target.x + T.dist * Math.cos(T.rotX) * Math.sin(T.rotY), cy = T.target.y + T.dist * Math.sin(T.rotX), cz = T.target.z + T.dist * Math.cos(T.rotX) * Math.cos(T.rotY);
  T.camera.position.set(cx, cy, cz); T.camera.lookAt(T.target); T.renderer.render(T.scene, T.camera);
}
$("seq").addEventListener("input", function (e) { T.step = +e.target.value; T.playing = false; $("play").textContent = "Play"; updateStep(); });
$("play").addEventListener("click", function () {
  if (T.playing) { T.playing = false; $("play").textContent = "Play"; return; }
  if (T.step >= T.steps.length - 1) { T.step = 0; $("seq").value = 0; updateStep(); }
  T.playing = true; T.last = performance.now(); $("play").textContent = "Pause";
});
function setMode(m) {
  mode = m; $("m-est").setAttribute("aria-pressed", m === "est"); $("m-sim").setAttribute("aria-pressed", m === "sim");
  $("estCard").hidden = m !== "est"; $("simCard").hidden = m !== "sim"; render();
}
$("m-est").addEventListener("click", function () { setMode("est"); });
$("m-sim").addEventListener("click", function () { setMode("sim"); });
