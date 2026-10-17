/* ---- 3D model: every mesh group is one real piece from layout() ---- */
var T = { ready: false, step: 99, steps: [], playing: false, anim: 0, last: 0, rotY: 0.7, rotX: 0.45, dist: 46, target: null, sel: null, explode: 0, pcs: [], c: null };
function cssc(n, f) { var v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || f; }
function build3d(p, c) {
  var el = $("three");
  if (!window.THREE) { el.innerHTML = '<p class="help" style="padding:16px">The 3D view could not load.</p>'; return; }
  if (!T.ready) {
    T.scene = new THREE.Scene(); T.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 600);
    T.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); T.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    T.renderer.shadowMap.enabled = true; T.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(T.renderer.domElement);
    T.scene.add(new THREE.HemisphereLight(0xdfeaf5, 0x8a8372, 0.8));
    var dl = new THREE.DirectionalLight(0xffffff, 0.75); dl.position.set(34, 55, 26); dl.castShadow = true;
    dl.shadow.mapSize.set(2048, 2048); var sc = dl.shadow.camera; sc.left = -45; sc.right = 45; sc.top = 45; sc.bottom = -45; sc.far = 200; T.scene.add(dl);
    T.root = new THREE.Group(); T.scene.add(T.root);
    var drag = null, moved = 0;
    el.addEventListener("pointerdown", function (e) { drag = { x: e.clientX, y: e.clientY }; moved = 0; el.style.cursor = "grabbing"; el.setPointerCapture(e.pointerId); });
    el.addEventListener("pointermove", function (e) { if (!drag) return; moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y); T.rotY -= (e.clientX - drag.x) * 0.008; T.rotX = Math.max(0.08, Math.min(1.45, T.rotX + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", function (e) { el.style.cursor = "grab"; if (drag && moved < 5) pick(e); drag = null; });
    el.addEventListener("wheel", function (e) { e.preventDefault(); T.dist = Math.max(14, Math.min(140, T.dist * (1 + e.deltaY * 0.001))); }, { passive: false });
    if (window.ResizeObserver) new ResizeObserver(function () { size3d(); }).observe(el);
    T.ray = new THREE.Raycaster();
    T.ready = true; requestAnimationFrame(loop3d);
  }
  while (T.root.children.length) { var o = T.root.children[0]; T.root.remove(o); o.traverse(function (n) { if (n.geometry) n.geometry.dispose(); }); }
  var L = layout(p), w = L.w, d = L.d, fh = p.height;
  var base = new THREE.Color(cssc("--concrete", "#c9d1d9")), edge = new THREE.Color(cssc("--concrete-line", "#8d99a6")), glass = new THREE.Color(cssc("--glass", "#b9dbe6")), ground = new THREE.Color(cssc("--ground", "#d6cdbf"));
  var tint = { EW: 0, PR: 0.02, IW: -0.03, SL: 0.05, FR: -0.06, ST: 0.03, BW: -0.02 };
  function mat(o, k) { var cc = base.clone(); cc.offsetHSL(0, 0, (tint[o.code] || 0) + ((k * 37) % 7 - 3) * 0.006); return new THREE.MeshLambertMaterial({ color: cc }); }
  function box(g, w1, h1, t1, x, y, z, m, o) {
    var geo = new THREE.BoxGeometry(Math.max(0.02, w1), Math.max(0.02, h1), Math.max(0.02, t1)), me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true;
    me.userData = { piece: o }; var ln = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: edge })); ln.raycast = function () {}; me.add(ln); g.add(me); return me;
  }
  var gr = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshLambertMaterial({ color: ground })); gr.rotation.x = -Math.PI / 2; gr.position.y = -0.41; gr.receiveShadow = true; gr.userData = { fixed: true, step: 0, y0: -0.41 }; T.root.add(gr);
  var fd = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.4, d + 2), new THREE.MeshLambertMaterial({ color: ground.clone().offsetHSL(0, 0, -0.08) })); fd.position.y = -0.2; fd.receiveShadow = true; fd.userData = { fixed: true, step: 0, y0: -0.2, floor: 0 }; T.root.add(fd);
  L.pcs.forEach(function (o, k) {
    var g = new THREE.Group(); g.position.set(o.pos[0], o.pos[1], o.pos[2]); g.rotation.y = o.rot || 0; g.userData = { step: o.step, y0: o.pos[1], floor: o.floor, piece: o };
    var m = mat(o, k), D = o.dims;
    if (o.kind === "panel" || o.kind === "box" || o.kind === "col") {
      if (o.op) {
        var op = o.op, s = op.sill, side = (D.w - op.w) / 2, lh = D.h - s - op.h;
        if (s > 0) box(g, D.w, s, D.t, 0, -D.h / 2 + s / 2, 0, m, o);
        if (side > 0.01) { box(g, side, op.h, D.t, -(op.w / 2 + side / 2), -D.h / 2 + s + op.h / 2, 0, m, o); box(g, side, op.h, D.t, op.w / 2 + side / 2, -D.h / 2 + s + op.h / 2, 0, m, o); }
        if (lh > 0.01) box(g, D.w, lh, D.t, 0, D.h / 2 - lh / 2, 0, m, o);
        var gm = box(g, op.w, op.h, 0.04, 0, -D.h / 2 + s + op.h / 2, 0, new THREE.MeshLambertMaterial({ color: op.door ? new THREE.Color(0x7a5c3e) : glass, transparent: true, opacity: op.door ? 1 : 0.65 }), o);
      } else box(g, D.w, D.h, D.t, 0, 0, 0, m, o);
    } else if (o.kind === "plank") { box(g, D.w, D.h, D.t, 0, 0, 0, m, o); }
    else if (o.kind === "stair") {
      var n = 9, rise = (D.h) / n, run = D.t / n;
      for (var q = 0; q < n; q++) box(g, D.w, rise * (q + 1), run, 0, rise * (q + 1) / 2, -D.t / 2 + run * (q + 0.5), m, o);
    }
    T.root.add(g);
  });
  T.steps = STEP_NAMES; T.pcs = L.pcs; T.c = c;
  var sq = $("seq"); sq.max = T.steps.length - 1; if (T.step > T.steps.length - 1) T.step = T.steps.length - 1; sq.value = T.step;
  T.target = new THREE.Vector3(0, p.floors * fh / 2, 0); T.dist = Math.max(30, (w + d) * 1.25 + p.floors * 3);
  var cnt = {}; L.pcs.forEach(function (o) { cnt[o.code] = (cnt[o.code] || 0) + 1; });
  $("pieceInfo").innerHTML = "<b>" + L.pcs.length + " pieces</b> in this model, each one a bill-of-materials item: " + ["EW", "PR", "IW", "SL", "FR", "ST", "BW"].filter(function (k) { return cnt[k]; }).map(function (k) { return cnt[k] + " × " + PIECE_INFO[k].name.toLowerCase(); }).join(", ") + ". Click any piece.";
  T.sel = null; $("inspect").innerHTML = '<span class="help">Click a piece in the model to see its mark, size, weight and cost.</span>';
  size3d(); updateStep();
}
function pick(e) {
  var el = $("three"), r = el.getBoundingClientRect(), v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  T.ray.setFromCamera(v, T.camera);
  var hit = T.ray.intersectObjects(T.root.children.filter(function (g) { return g.visible && g.userData.piece; }), true).filter(function (h) { return h.object.userData && h.object.userData.piece; })[0];
  T.root.traverse(function (n) { if (n.material && n.material.emissive) n.material.emissive.setHex(0x000000); });
  if (!hit) { T.sel = null; $("inspect").innerHTML = '<span class="help">Click a piece in the model to see its mark, size, weight and cost.</span>'; return; }
  var o = hit.object.userData.piece; T.sel = o;
  T.root.children.forEach(function (g) { if (g.userData.piece === o) g.traverse(function (n) { if (n.material && n.material.emissive) n.material.emissive.setHex(0x1b6f78); }); });
  var info = PIECE_INFO[o.code], el2 = T.c && T.c.els.filter(function (x) { return x.code === info.bom; })[0], unit = el2 ? el2.cost / el2.vol : 0;
  var D = o.dims, dim = o.kind === "plank" ? fmt(D.t, 2) + " × " + fmt(D.w, 2) + " × " + fmt(D.h, 2) : o.kind === "stair" ? fmt(D.t, 2) + " × " + fmt(D.w, 2) + " × " + fmt(D.h, 2) : fmt(D.w, 2) + " × " + fmt(D.h, 2) + " × " + fmt(D.t, 2);
  $("inspect").innerHTML = '<table><tr><th>Mark</th><td class="mono">' + o.id + '</td><th>BOM line</th><td class="mono">' + info.bom + '</td></tr><tr><th>Piece</th><td>' + info.name + (o.op ? (o.op.door ? " (door opening)" : " (window opening)") : "") + '</td><th>Size (m)</th><td>' + dim + '</td></tr><tr><th>Concrete</th><td>' + fmt(o.vol, 3) + ' m³</td><th>Weight</th><td>' + fmt(o.vol * R.density, 2) + ' t</td></tr><tr><th>Cost</th><td>SAR ' + fmt(o.vol * unit) + '</td><th>Erected in</th><td>' + T.steps[o.step] + '</td></tr></table>';
}
function size3d() { var el = $("three"); if (!T.ready || !el.clientWidth) return; T.renderer.setSize(el.clientWidth, el.clientHeight, false); T.camera.aspect = el.clientWidth / el.clientHeight; T.camera.updateProjectionMatrix(); }
function updateStep() {
  if (!T.ready) return;
  T.root.children.forEach(function (g) { g.visible = g.userData.fixed ? true : g.userData.step <= T.step; });
  $("stepLabel").textContent = "Step " + (T.step + 1) + " of " + T.steps.length + ": " + T.steps[T.step];
  T.anim = performance.now();
}
function loop3d(t) {
  requestAnimationFrame(loop3d);
  if (mode !== "sim" || !T.ready) return;
  if (T.playing && t - T.last > 1200) { T.last = t; if (T.step < T.steps.length - 1) { T.step++; $("seq").value = T.step; updateStep(); } else { T.playing = false; $("play").textContent = "Play"; } }
  var k = Math.min(1, (t - T.anim) / 700);
  T.root.children.forEach(function (g) {
    if (g.userData.fixed) return;
    var drop = (g.userData.step === T.step && g.visible) ? (1 - k) * (1 - k) * 6 : 0;
    g.position.y = g.userData.y0 + drop + T.explode * (g.userData.floor || 0) * 5;
  });
  var cx = T.target.x + T.dist * Math.cos(T.rotX) * Math.sin(T.rotY), cy = T.target.y + T.dist * Math.sin(T.rotX), cz = T.target.z + T.dist * Math.cos(T.rotX) * Math.cos(T.rotY);
  T.camera.position.set(cx, cy, cz); T.camera.lookAt(T.target); T.renderer.render(T.scene, T.camera);
}
$("seq").addEventListener("input", function (e) { T.step = +e.target.value; T.playing = false; $("play").textContent = "Play"; updateStep(); });
$("explode").addEventListener("input", function (e) { T.explode = +e.target.value; });
$("play").addEventListener("click", function () {
  if (T.playing) { T.playing = false; $("play").textContent = "Play"; return; }
  if (T.step >= T.steps.length - 1) { T.step = 0; $("seq").value = 0; updateStep(); }
  T.playing = true; T.last = performance.now(); $("play").textContent = "Pause";
});
$("b-bim").addEventListener("click", function () { $("bimNote").hidden = !$("bimNote").hidden; });
$("b-ai").addEventListener("click", function () { $("aiNote").hidden = !$("aiNote").hidden; });
