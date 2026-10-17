/* The building is defined once, as a list of real pieces. The 3D view draws these pieces and the BOM is summed from them, so what you see is what is priced. */
function geom(p) {
  var half = p.perim / 2, disc = half * half - 4 * p.area, w, d;
  if (disc >= 0) { w = (half + Math.sqrt(disc)) / 2; d = (half - Math.sqrt(disc)) / 2; } else { w = d = Math.sqrt(p.area); }
  return { w: w, d: d };
}
var PIECE_INFO = {
  EW: { bom: "EW-01", group: "Envelope", name: "External wall panels (insulated)", fin: true },
  PR: { bom: "PR-01", group: "Envelope", name: "Parapet panels", fin: true },
  IW: { bom: "IW-01", group: "Structure", name: "Internal wall panels" },
  SL: { bom: "SL-01", group: "Structure", name: "Hollow-core floor and roof planks" },
  FR: { bom: "FR-01", group: "Structure", name: "Beams and columns" },
  ST: { bom: "ST-01", group: "Stairs", name: "Stair flights" },
  BW: { bom: "BW-01", group: "Boundary wall", name: "Boundary wall panels", fin: true }
};
var STEP_NAMES = [];
function layout(p) {
  var g = geom(p), w = g.w, d = g.d, fh = p.height, th = p.thk, GAP = 0.25, pcs = [], cnt = {}, step = 0, names = ["Foundation base"], i, f;
  function add(o) { cnt[o.code] = (cnt[o.code] || 0) + 1; o.id = o.code + "-" + (cnt[o.code] < 10 ? "0" : "") + cnt[o.code]; pcs.push(o); }
  function fy(f) { return f * (fh + GAP); }
  function segs(len, target) { var n = Math.max(1, Math.round(len / target)); return { n: n, w: len / n }; }
  for (f = 0; f < p.floors; f++) {
    step++; names.push("Floor " + (f + 1) + ": columns and beam");
    [-w / 2 + 0.7, 0, w / 2 - 0.7].forEach(function (x) { add({ code: "FR", kind: "col", step: step, floor: f, pos: [x, fy(f) + (fh - 0.5) / 2, 0], dims: { w: 0.4, h: fh - 0.5, t: 0.4 }, vol: 0.4 * 0.4 * (fh - 0.5) }); });
    add({ code: "FR", kind: "box", step: step, floor: f, pos: [0, fy(f) + fh - 0.25, 0], dims: { w: w - 1.0, h: 0.5, t: 0.4 }, vol: (w - 1.0) * 0.5 * 0.4 });
    step++; names.push("Floor " + (f + 1) + ": wall panels");
    var sw = segs(w, 2.4), sd = segs(d, 2.4), y = fy(f) + fh / 2;
    var sides = [{ n: sw.n, pw: sw.w, z: d / 2, rot: 0, side: "front" }, { n: sw.n, pw: sw.w, z: -d / 2, rot: 0, side: "back" }, { n: sd.n, pw: sd.w, x: w / 2, rot: Math.PI / 2, side: "right" }, { n: sd.n, pw: sd.w, x: -w / 2, rot: Math.PI / 2, side: "left" }];
    sides.forEach(function (s) {
      for (var k = 0; k < s.n; k++) {
        var off = (k + 0.5) * s.pw - (s.rot === 0 ? w : d) / 2, op = null;
        if (s.side === "front" && f === 0 && k === Math.floor(s.n / 2)) op = { w: Math.min(1.2, s.pw - 0.5), h: 2.1, sill: 0, door: true };
        else if (s.pw > 1.4 && (k % 3 !== 2 || s.side === "front")) op = { w: Math.min(1.3, s.pw - 0.8), h: 1.2, sill: 0.9, door: false };
        var ow = op ? op.w * op.h : 0;
        add({ code: "EW", kind: "panel", step: step, floor: f, pos: [s.rot === 0 ? off : s.x, y, s.rot === 0 ? s.z : off], rot: s.rot, dims: { w: s.pw - 0.06, h: fh, t: th }, op: op, vol: (s.pw - 0.06) * fh * th - ow * th, area: (s.pw - 0.06) * fh - ow });
      }
    });
    var l1 = w * 0.8, n1 = Math.ceil(l1 / 2.4), l2 = d * 0.5, n2 = Math.ceil(l2 / 2.4);
    for (i = 0; i < n1; i++) add({ code: "IW", kind: "panel", step: step, floor: f, pos: [-l1 / 2 + (i + 0.5) * (l1 / n1), y, -d / 4], rot: 0, dims: { w: l1 / n1 - 0.06, h: fh, t: 0.15 }, op: null, vol: (l1 / n1 - 0.06) * fh * 0.15 });
    for (i = 0; i < n2; i++) add({ code: "IW", kind: "panel", step: step, floor: f, pos: [w / 6, y, -d / 2 + (i + 0.5) * (l2 / n2)], rot: Math.PI / 2, dims: { w: l2 / n2 - 0.06, h: fh, t: 0.15 }, op: null, vol: (l2 / n2 - 0.06) * fh * 0.15 });
    step++; names.push(f === p.floors - 1 ? "Roof: hollow-core planks" : "Floor " + (f + 2) + ": hollow-core planks");
    var np = Math.max(1, Math.ceil(w / 1.2)), plw = (w + 0.2) / np;
    for (i = 0; i < np; i++) add({ code: "SL", kind: "plank", step: step, floor: f, pos: [-(w + 0.2) / 2 + (i + 0.5) * plw, fy(f) + fh + 0.1, 0], dims: { w: plw - 0.04, h: 0.2, t: d + 0.2 }, vol: (plw - 0.04) * (d + 0.2) * 0.2 * 0.62 });
    if (f === 0 && p.flights > 0) {
      step++; names.push("Stair flights");
      for (i = 0; i < p.flights; i++) add({ code: "ST", kind: "stair", step: step, floor: 0, pos: [-w / 2 + 1.5 + i * 1.5, 0, -d / 2 + 2.4], dims: { w: 1.2, h: fh, t: 3.2 }, vol: 1.6 });
    }
  }
  step++; names.push("Parapet panels");
  var top = fy(p.floors - 1) + fh + 0.2 + 0.45, pw2 = segs(w, 2.4), pd2 = segs(d, 2.4);
  [{ n: pw2.n, pw: pw2.w, z: d / 2, rot: 0 }, { n: pw2.n, pw: pw2.w, z: -d / 2, rot: 0 }, { n: pd2.n, pw: pd2.w, x: w / 2, rot: Math.PI / 2 }, { n: pd2.n, pw: pd2.w, x: -w / 2, rot: Math.PI / 2 }].forEach(function (s) {
    for (var k = 0; k < s.n; k++) { var off = (k + 0.5) * s.pw - (s.rot === 0 ? w : d) / 2; add({ code: "PR", kind: "panel", step: step, floor: p.floors - 1, pos: [s.rot === 0 ? off : s.x, top, s.rot === 0 ? s.z : off], rot: s.rot, dims: { w: s.pw - 0.06, h: 0.9, t: 0.12 }, op: null, vol: (s.pw - 0.06) * 0.9 * 0.12 }); }
  });
  if (p.bw > 0) {
    step++; names.push("Boundary wall");
    var ow2 = w + 10, od = d + 10, per = 2 * (ow2 + od), nb = Math.ceil(p.bw / 2.4);
    for (i = 0; i < nb; i++) {
      var u = (i * 2.4) % per, bx, bz, rot = 0;
      if (u < ow2) { bx = -ow2 / 2 + u + 1.2; bz = od / 2; } else if (u < ow2 + od) { bx = ow2 / 2; bz = od / 2 - (u - ow2) - 1.2; rot = Math.PI / 2; } else if (u < 2 * ow2 + od) { bx = ow2 / 2 - (u - ow2 - od) - 1.2; bz = -od / 2; } else { bx = -ow2 / 2; bz = -od / 2 + (u - 2 * ow2 - od) + 1.2; rot = Math.PI / 2; }
      add({ code: "BW", kind: "panel", step: step, floor: 0, pos: [bx, 1.2, bz], rot: rot, dims: { w: 2.34, h: 2.4, t: 0.1 }, op: null, vol: 2.34 * 2.4 * 0.1 });
    }
  }
  STEP_NAMES = names;
  return { pcs: pcs, w: w, d: d };
}
function calc(p, finishOverride) {
  var ff = FIN[finishOverride || p.finish], L = layout(p), byCode = {}, insA = 0;
  L.pcs.forEach(function (o) {
    var e = byCode[o.code] || (byCode[o.code] = { code: PIECE_INFO[o.code].bom, group: PIECE_INFO[o.code].group, name: PIECE_INFO[o.code].name, vol: 0, n: 0, fin: PIECE_INFO[o.code].fin ? ff : 1 });
    e.vol += o.vol; e.n++; if (o.code === "EW") insA += o.area * 0.9;
  });
  var order = ["EW", "PR", "IW", "SL", "FR", "ST", "BW"], els = [];
  order.forEach(function (k) { if (byCode[k] && byCode[k].vol > 0.0001) els.push(byCode[k]); });
  var totalVol = 0; els.forEach(function (e) { totalVol += e.vol; });
  var comp = { materials: 0, moulds: 0, labour: 0, overhead: 0, transport: 0, erection: 0 }, groups = {};
  els.forEach(function (e) {
    e.rebar = e.vol * R.rebarKg;
    e.mat = e.vol * R.conc * e.fin + e.rebar * R.rebarP;
    e.moulds = e.vol * R.mould; e.labour = e.vol * R.hours * R.lab;
    e.overhead = (e.mat + e.moulds + e.labour) * R.oh;
    e.cost = e.mat + e.moulds + e.labour + e.overhead;
    comp.materials += e.mat; comp.moulds += e.moulds; comp.labour += e.labour; comp.overhead += e.overhead;
    groups[e.group] = (groups[e.group] || 0) + e.cost;
  });
  var insulM2 = insA, insulCost = insulM2 * R.insul; comp.materials += insulCost; groups["Envelope"] = (groups["Envelope"] || 0) + insulCost;
  var inserts = Math.ceil(totalVol / R.insertM3); var insertCost = inserts * R.insert; comp.materials += insertCost; groups["Structure"] = (groups["Structure"] || 0) + insertCost;
  var weight = totalVol * R.density; var loads = Math.ceil(weight / R.loadT);
  comp.transport = loads * R.load; comp.erection = totalVol * R.erect;
  groups["Transport & erection"] = comp.transport + comp.erection;
  var cost = 0; Object.keys(comp).forEach(function (k) { cost += comp[k]; });
  var price = cost * (1 + R.margin);
  var parts = { conc: 0, rebar: 0 }; els.forEach(function (e) { parts.conc += e.vol * R.conc * e.fin; parts.rebar += e.rebar * R.rebarP; });
  return { parts: parts, els: els, pieces: L.pcs.length, vol: totalVol, weight: weight, loads: loads, rebar: totalVol * R.rebarKg, insulM2: insulM2, insulCost: insulCost, inserts: inserts, insertCost: insertCost,
    comp: comp, groups: groups, cost: cost, price: price, vat: price * R.vat, total: price * (1 + R.vat) };
}
