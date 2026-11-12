/* ============================================================
   分栏打印 · 排版引擎
   几何全部用毫米推导；预览与打印共用同一份纸张样式。
   兼容目标：Chrome 83（ES5 语法 + 老 CSS）
   ============================================================ */
(function () {
  'use strict';

  var MM_PER_PT = 25.4 / 72;
  var PX_PER_MM = 96 / 25.4;
  var REF_PX = 100;

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = document.documentElement.style;
  var nf = new Intl.NumberFormat('zh-CN');

  var FACE = {
    song: '"SimSun","宋体","Songti SC",serif',
    hei: '"SimHei","黑体","Microsoft YaHei",sans-serif'
  };

  var S = {
    orient: 'landscape',
    cols: 2,
    face: 'song',
    fontPt: 8,
    lh: 1.2,
    gutter: 6,
    margin: 10,
    shade: true,
    foot: true,
    title: '',
    zoom: 'fit',
    preset: 'auto',
    widths: null
  };

  var D = { header: [], rows: [], name: '' };
  var WRAW = null;
  var WRAW_CACHE = {};
  var dataVer = 0;
  var LAYOUT = null;
  var PAGES = [];
  var GEN = 0;

  /* ---------------- 纸张样式（预览与打印共用） ---------------- */

  var SHEET_CSS = [
    '.sheet{box-sizing:border-box;width:var(--pw);height:var(--ph);padding:var(--m);',
    'display:flex;flex-direction:column;background:#fff;color:#000;',
    'font-family:var(--sheet-font);font-size:var(--fontsz);overflow:hidden;border-radius:2px}',
    '.sheet .ttl{flex:none;height:var(--titleh);font-weight:700;font-size:var(--titlesz);',
    'line-height:var(--titlelh);text-align:center;white-space:nowrap;overflow:hidden}',
    '.sheet .flow{flex:none;height:var(--flowh);display:flex;align-items:flex-start;overflow:hidden}',
    '.sheet .col{flex:none;width:var(--colw)}',
    '.sheet .col + .col{margin-left:var(--gut)}',
    '.sheet .grid{display:grid;grid-template-columns:var(--gt);background:#fff;',
    'border-left:var(--R) solid #14161a;border-top:0}',
    '.sheet .grid.hd{border-top:var(--R) solid #14161a}',
    '.sheet .grid > *{background:#fff;overflow:hidden;white-space:nowrap;text-overflow:clip;',
    'border-right:var(--R) solid #14161a;border-bottom:var(--R) solid #14161a;',
    'padding:var(--pv) var(--px);line-height:var(--lhmm);letter-spacing:var(--ls)}',
    '.sheet .grid > .wrapcell{white-space:normal;word-break:break-all}',
    '.sheet .grid > .th{font-weight:700}',
    '.sheet.shade .grid > .th{background:#eceef1}',
    '.sheet .grid > .hlcell{position:relative;overflow:visible}',
    '.sheet .foot{flex:none;height:var(--footh);font-size:var(--footsz);line-height:var(--footh);',
    'text-align:center;white-space:nowrap}',
    '.sheet .hdl{position:absolute;left:100%;top:0;bottom:0;width:11px;margin-left:-5.5px;',
    'cursor:ew-resize;z-index:3;background:transparent;touch-action:none;display:block}',
    '.sheet .hdl::after{content:"";position:absolute;top:0;bottom:2mm;left:5px;width:2px;background:transparent}',
    '.sheet .hdl:hover::after{background:var(--accent)}'
  ].join('');

  function injectSheetCSS() {
    if ($('#sheet-css')) return;
    var st = document.createElement('style');
    st.id = 'sheet-css';
    st.textContent = SHEET_CSS + '\n.sheet{outline:1px solid rgba(0,0,0,.10)}' +
      '\n@media print{.sheet .hdl{display:none}}';
    document.head.appendChild(st);
  }

  /* ---------------- 文本宽度测量 ----------------
     逐串 measureText 在 8000 行上要 5 万次调用，低配机上是秒级。
     改成先建"字符→宽度"表（几十到几百个字符），再求和。
     建表后用抽样串与 measureText 对拍，误差超限则退回逐串测量。 */

  var mctx = document.createElement('canvas').getContext('2d');

  // 字符集：同一份数据只扫一遍
  var CHARSET = { ver: -1, list: [] };
  function charList() {
    if (CHARSET.ver === dataVer) return CHARSET.list;
    var seen = {}, list = [], i, j, k, s2, ch;
    for (i = 0; i < D.rows.length; i++) {
      var r = D.rows[i];
      for (j = 0; j < r.length; j++) {
        s2 = r[j];
        if (!s2) continue;
        for (k = 0; k < s2.length; k++) {
          ch = s2.charAt(k);
          if (!seen[ch]) { seen[ch] = 1; list.push(ch); }
        }
      }
    }
    for (j = 0; j < D.header.length; j++) {
      s2 = D.header[j] || '';
      for (k = 0; k < s2.length; k++) {
        ch = s2.charAt(k);
        if (!seen[ch]) { seen[ch] = 1; list.push(ch); }
      }
    }
    CHARSET = { ver: dataVer, list: list };
    return list;
  }

  // 用真实排版量单字宽度（canvas 在小字号下会偏窄，不能用）
  function charWidthsDOM(face, bold, fontPt) {
    var list = charList();
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:pre;pointer-events:none;' +
      'font-family:' + FACE[face] + ';font-size:' + fontPt + 'pt;font-weight:' + (bold ? '700' : '400');
    document.body.appendChild(host);
    var tbl = new Float32Array(65536);
    for (var i = 0; i < list.length; i++) {
      host.textContent = list[i];
      tbl[list[i].charCodeAt(0)] = host.getBoundingClientRect().width;
    }
    document.body.removeChild(host);
    return tbl;
  }

  function sumW(str, tbl) {
    var w = 0, n = str.length;
    for (var i = 0; i < n; i++) w += tbl[str.charCodeAt(i)];
    return w;
  }

  var MEAS = { key: '', w: null };

  function measure(force) {
    var key = S.face + '|' + S.fontPt + '|' + dataVer;
    if (!force && MEAS.key === key) { WRAW = MEAS.w; return; }
    var n = D.header.length, rows = D.rows.length, i, j;

    var hT = charWidthsDOM(S.face, true, S.fontPt);
    var bT = charWidthsDOM(S.face, false, S.fontPt);

    var head = new Float32Array(n);
    var cols = [];
    var mx = new Float32Array(n);
    for (j = 0; j < n; j++) { head[j] = sumW(D.header[j] || '', hT); cols.push(new Float32Array(rows)); }

    for (i = 0; i < rows; i++) {
      var r = D.rows[i];
      for (j = 0; j < n; j++) {
        var t = r[j];
        if (!t) continue;
        var v = sumW(t, bT);
        cols[j][i] = v;
        if (v > mx[j]) mx[j] = v;
      }
    }

    WRAW = { head: head, cols: cols, n: n, max: mx };
    MEAS = { key: key, w: WRAW };
  }

  // 版式推荐用的快速估算：canvas 100px + 8% 余量，只求排序方向正确
  var FAST = { key: '', max: null, head: null };
  function fastWidths() {
    var key = S.face + '|' + dataVer;
    if (FAST.key === key) return FAST;
    var list = charList(), n = D.header.length, i, j;
    mctx.font = REF_PX + 'px ' + FACE[S.face];
    var bT = new Float32Array(65536);
    for (j = 0; j < list.length; j++) bT[list[j].charCodeAt(0)] = mctx.measureText(list[j]).width;
    mctx.font = '700 ' + REF_PX + 'px ' + FACE[S.face];
    var hT = new Float32Array(65536);
    for (j = 0; j < list.length; j++) hT[list[j].charCodeAt(0)] = mctx.measureText(list[j]).width;

    var head = new Float32Array(n), max = new Float32Array(n);
    for (j = 0; j < n; j++) head[j] = sumW(D.header[j] || '', hT);
    for (i = 0; i < D.rows.length; i++) {
      var r = D.rows[i];
      for (j = 0; j < n; j++) {
        var t = r[j];
        if (!t) continue;
        var v = sumW(t, bT);
        if (v > max[j]) max[j] = v;
      }
    }
    FAST = { key: key, max: max, head: head };
    return FAST;
  }

  /* ---------------- 版式计算 ---------------- */

  var RULE = 0.26;

  function geomOf(orient, cols, fontPt, lh, margin, gutter) {
    var pw = orient === 'landscape' ? 297 : 210;
    var ph = orient === 'landscape' ? 210 : 297;
    var fontMm = fontPt * MM_PER_PT;
    var lineMm = fontMm * lh;
    var padV = Math.max(0.3, fontMm * 0.13);
    var padX = Math.max(0.55, fontMm * 0.26);
    var cellH = lineMm + padV * 2;
    var titleSize = S.title ? Math.max(11 * MM_PER_PT, fontMm * 1.7) : 0;
    var titleH = S.title ? titleSize * 1.55 + 4 : 0;
    var headH = cellH;
    var footH = S.foot ? fontMm * 1.35 + 4.5 : 0;
    var colW = (pw - margin * 2 - (cols - 1) * gutter) / cols;
    var colH = ph - margin * 2 - titleH - headH - footH;
    return {
      pw: pw, ph: ph, fontMm: fontMm, lineMm: lineMm, padV: padV, padX: padX,
      cellH: cellH, titleSize: titleSize, titleH: titleH, headH: headH,
      footH: footH, colW: colW, colH: colH, margin: margin, cols: cols, gutter: gutter
    };
  }

  // 按内容分配列宽；返回每列宽度与需要的字距收紧量
  function fitW(nat, flr, avail, padX, n, override) {
    var sum = function (a) { var t = 0; for (var q = 0; q < a.length; q++) t += a[q]; return t; };
    var wantAt = function (kk) {
      var o = new Array(n);
      for (var q = 0; q < n; q++) o[q] = Math.max(nat[q], flr[q]) * (1 - kk) + padX * 2;
      return o;
    };
    var kk = 0;
    if (sum(wantAt(0)) > avail) {
      for (kk = 0.005; kk <= 0.0601; kk += 0.005) if (sum(wantAt(kk)) <= avail) break;
      if (kk > 0.06) kk = 0.06;
    }
    var wantW = wantAt(kk);
    var floorW = new Array(n);
    for (var q1 = 0; q1 < n; q1++) floorW[q1] = flr[q1] * (1 - kk) + padX * 2;
    var fs = sum(floorW);
    var cramped = false;
    var W;

    if (override && override.length === n) {
      var s2 = sum(override);
      W = override.map(function (v) { return v * avail / s2; });
    } else if (fs >= avail) {
      var p = avail / fs;
      W = floorW.map(function (v) { return v * p; });
      cramped = true;
    } else {
      var extra = [], es = 0;
      for (var q2 = 0; q2 < n; q2++) { var e = Math.max(0, wantW[q2] - floorW[q2]); extra.push(e); es += e; }
      var slack = avail - fs;
      W = floorW.slice();
      if (es <= slack) {
        for (var q3 = 0; q3 < n; q3++) W[q3] = wantW[q3];
        var rest = (slack - es) / n;
        for (var q4 = 0; q4 < n; q4++) W[q4] += rest;
      } else {
        var p2 = slack / es;
        for (var q5 = 0; q5 < n; q5++) W[q5] = floorW[q5] + extra[q5] * p2;
      }
    }
    return { W: W, k: kk, cramped: cramped };
  }

  function scaledWidths() {
    var n = WRAW.n;
    var nat = new Array(n), flr = new Array(n);
    for (var j = 0; j < n; j++) {
      nat[j] = WRAW.max[j] / PX_PER_MM;
      flr[j] = WRAW.head[j] / PX_PER_MM * 1.09;
    }
    return { nat: nat, flr: flr, n: n };
  }

  // 只做可行性估算，不扫全表（用于版式推荐）；用 canvas 宽度 + 8% 余量
  function estimate(orient, cols, fontPt, lh, margin, gutter) {
    var g = geomOf(orient, cols, fontPt, lh, margin, gutter);
    var n = WRAW.n;
    var fw = fastWidths();
    var scale = (fontPt * 4 / 3) / REF_PX / PX_PER_MM * 1.08;
    var nat = new Array(n), flr = new Array(n);
    for (var j = 0; j < n; j++) { nat[j] = fw.max[j] * scale; flr[j] = fw.head[j] * scale * 1.09; }
    var avail = g.colW - RULE;
    if (avail <= 0) return { ok: false, pages: 1e9, k: 0 };
    var f = fitW(nat, flr, avail, g.padX, n, null);
    for (var j2 = 0; j2 < n; j2++) {
      var need = Math.max(nat[j2], flr[j2]) * (1 - f.k) + g.padX * 2;
      if (f.W[j2] < need - 0.02) return { ok: false, pages: 1e9, k: f.k, wrap: true };
    }
    var perCol = Math.floor((g.colH - g.headH) / g.cellH);
    if (perCol < 1) return { ok: false, pages: 1e9, k: f.k };
    return { ok: true, pages: Math.ceil(D.rows.length / (perCol * cols)), k: f.k, cramped: f.cramped };
  }

  function compute() {
    measure(false);
    var g = geomOf(S.orient, S.cols, S.fontPt, S.lh, S.margin, S.gutter);
    var n = WRAW.n;
    var R = RULE;
    var sw = scaledWidths();
    var nat = sw.nat, flr = sw.flr;
    var avail = g.colW - R;
    var f = fitW(nat, flr, avail, g.padX, n, S.widths);
    var W = f.W, kk = f.k;

    var inner = new Array(n), need = new Array(n);
    for (var q = 0; q < n; q++) {
      inner[q] = W[q] - g.padX * 2;
      need[q] = Math.max(nat[q], flr[q]) * (1 - kk) + g.padX * 2;
    }

    var rows = D.rows.length;
    var hs = new Float32Array(rows);
    var wrapCount = 0;

    for (var i2 = 0; i2 < rows; i2++) {
      var rr = D.rows[i2], lines = 1;
      for (var j2 = 0; j2 < n; j2++) {
        if (!rr[j2]) continue;
        var wv = WRAW.cols[j2][i2] / PX_PER_MM * (1 - kk);
        if (wv > inner[j2] + 0.01) {
          var L2 = Math.ceil(wv / inner[j2]);
          if (L2 > lines) lines = L2;
        }
      }
      if (lines > 1) wrapCount++;
      hs[i2] = g.cellH + (lines - 1) * g.lineMm;
    }

    var bodyCap = g.colH - g.headH;
    PAGES = [];
    var idx = 0;
    while (idx < rows) {
      var page = [];
      for (var c2 = 0; c2 < S.cols; c2++) {
        var st = idx, acc = 0;
        while (idx < rows && acc + hs[idx] <= bodyCap) { acc += hs[idx]; idx++; }
        if (idx === st) idx++;
        page.push([st, idx]);
        if (idx >= rows) break;
      }
      PAGES.push(page);
      if (PAGES.length > 4000) break;
    }

    LAYOUT = {
      n: n, pw: g.pw, ph: g.ph, m: g.margin, R: R, gut: g.gutter, colW: g.colW, colH: g.colH,
      fontMm: g.fontMm, lineMm: g.lineMm, padV: g.padV, padX: g.padX, cellH: g.cellH,
      titleSize: g.titleSize, titleH: g.titleH, headH: g.headH, footH: g.footH,
      W: W, inner: inner, need: need, k: kk, tight: kk > 0, cramped: f.cramped,
      wraps: wrapCount, total: PAGES.length
    };
    return LAYOUT;
  }

  /* ---------------- 几何变量 ---------------- */

  function geomVars() {
    var L = LAYOUT;
    return [
      '--pw:' + L.pw + 'mm', '--ph:' + L.ph + 'mm', '--m:' + L.m + 'mm',
      '--gut:' + L.gut + 'mm', '--colw:' + L.colW + 'mm', '--R:' + L.R + 'mm',
      '--pv:' + (L.padV - L.R / 2) + 'mm', '--px:' + (L.padX - L.R / 2) + 'mm', '--lhmm:' + L.lineMm + 'mm',
      '--gt:' + L.W.map(function (w) { return w.toFixed(3) + 'mm'; }).join(' '),
      '--ls:' + (-L.k).toFixed(3) + 'em',
      '--titleh:' + L.titleH + 'mm', '--titlesz:' + L.titleSize + 'mm',
      '--titlelh:' + (L.titleSize * 1.55) + 'mm',
      '--flowh:' + (L.colH + L.headH) + 'mm', '--footh:' + L.footH + 'mm',
      '--footsz:' + S.fontPt + 'pt', '--fontsz:' + S.fontPt + 'pt',
      '--sheet-font:' + FACE[S.face]
    ].join(';');
  }

  // 只写到承载纸张的容器上，避免整页样式重算
  var GEOM_HOSTS = ['#stage', '#heroPaper', '#printRoot'];

  function applyGeom() {
    var L = LAYOUT;
    var vars = {
      '--pw': L.pw + 'mm', '--ph': L.ph + 'mm', '--m': L.m + 'mm',
      '--gut': L.gut + 'mm', '--colw': L.colW + 'mm', '--R': L.R + 'mm',
      '--pv': (L.padV - L.R / 2) + 'mm', '--px': (L.padX - L.R / 2) + 'mm', '--lhmm': L.lineMm + 'mm',
      '--gt': L.W.map(function (w) { return w.toFixed(3) + 'mm'; }).join(' '),
      '--ls': (-L.k).toFixed(3) + 'em',
      '--titleh': L.titleH + 'mm', '--titlesz': L.titleSize + 'mm',
      '--titlelh': (L.titleSize * 1.55) + 'mm',
      '--flowh': (L.colH + L.headH) + 'mm', '--footh': L.footH + 'mm',
      '--footsz': S.fontPt + 'pt', '--fontsz': S.fontPt + 'pt'
    };
    for (var i = 0; i < GEOM_HOSTS.length; i++) {
      var el = $(GEOM_HOSTS[i]);
      if (!el) continue;
      for (var k in vars) el.style.setProperty(k, vars[k]);
    }
  }

  /* ---------------- 单页内容 ---------------- */

  var ESCRE = /[&<>"]/;

  function esc(s) {
    if (!ESCRE.test(s)) return s;
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function sheetInner(pi, handles) {
    var L = LAYOUT;
    var total = PAGES.length;
    var page = PAGES[pi];
    var n = L.n;
    var out = '';

    if (S.title) out += '<div class="ttl">' + esc(S.title) + '</div>';
    out += '<div class="flow">';

    for (var c = 0; c < page.length; c++) {
      var a = page[c][0], b = page[c][1];
      var isHandleCol = handles && pi === 0 && c === 0;

      out += '<div class="col"><div class="grid hd">';
      for (var j = 0; j < n; j++) {
        var last = j === n - 1;
        var hl = isHandleCol && !last;
        out += '<div class="th' + (hl ? ' hlcell' : '') + '">' + esc(D.header[j] || '');
        if (hl) out += '<i class="hdl" data-j="' + j + '"></i>';
        out += '</div>';
      }
      out += '</div><div class="grid bd">';

      for (var i = a; i < b; i++) {
        var r = D.rows[i];
        for (var j2 = 0; j2 < n; j2++) {
          var t = r[j2] || '';
          var wr = t && (WRAW.cols[j2][i] / PX_PER_MM * (1 - L.k) > L.inner[j2] + 0.01);
          out += wr ? '<div class="td wrapcell">' + esc(t) + '</div>' : '<div class="td">' + esc(t) + '</div>';
        }
      }
      out += '</div></div>';
    }

    out += '</div>';
    if (S.foot) out += '<div class="foot">第 ' + (pi + 1) + ' 页 共 ' + total + ' 页</div>';
    return out;
  }

  var HTML_CACHE = {};
  var CACHE_GEN = -1;

  function pageInner(pi) {
    if (CACHE_GEN !== GEN) { HTML_CACHE = {}; CACHE_GEN = GEN; }
    if (!HTML_CACHE[pi]) HTML_CACHE[pi] = sheetInner(pi, true);
    return HTML_CACHE[pi];
  }

  /* ---------------- 预览（虚拟化） ---------------- */

  var V = { scale: 1, wpx: 0, hpx: 0, gap: 22, pad: 20, nodes: {}, first: -1, last: -1 };

  function stageScale() {
    var stage = $('#stage');
    if (S.zoom !== 'fit') return parseFloat(S.zoom);
    var avail = stage.clientWidth - 28;
    return Math.min(1, Math.max(0.1, avail / (LAYOUT.pw * PX_PER_MM)));
  }

  function layoutPreview() {
    var inner = $('#stageInner');
    var s = stageScale();
    V.scale = s;
    V.wpx = LAYOUT.pw * PX_PER_MM * s;
    V.hpx = LAYOUT.ph * PX_PER_MM * s;
    V.gap = 22;
    V.pad = 20;

    for (var k in V.nodes) { if (V.nodes[k].parentNode) V.nodes[k].parentNode.removeChild(V.nodes[k]); }
    V.nodes = {};
    V.first = -1; V.last = -1;

    var h = V.pad * 2 + PAGES.length * (V.hpx + V.gap) - V.gap;
    inner.style.height = (h > 0 ? h : 0) + 'px';
    syncWindow(true);
  }

  function syncWindow(force) {
    if (!PAGES.length) { $('#stageInner').innerHTML = ''; V.nodes = {}; return; }
    var stage = $('#stage');
    var inner = $('#stageInner');
    var top = stage.scrollTop;
    var vh = stage.clientHeight || 600;
    var per = V.hpx + V.gap;

    var first = Math.max(0, Math.floor((top - V.pad) / per) - 1);
    var last = Math.min(PAGES.length - 1, Math.ceil((top + vh - V.pad) / per) + 1);
    if (!force && first === V.first && last === V.last) return;
    V.first = first; V.last = last;

    var k;
    for (k in V.nodes) {
      var idx = +k;
      if (idx < first || idx > last) {
        if (V.nodes[k].parentNode) V.nodes[k].parentNode.removeChild(V.nodes[k]);
        delete V.nodes[k];
      }
    }

    for (var i = first; i <= last; i++) {
      if (V.nodes[i]) continue;
      var wrap = document.createElement('div');
      wrap.className = 'pagewrap' + (force ? '' : ' fresh');
      wrap.style.top = (V.pad + i * per) + 'px';
      wrap.style.height = V.hpx + 'px';
      wrap.innerHTML = '<div class="pgbox" style="width:' + V.wpx.toFixed(1) + 'px;height:' + V.hpx.toFixed(1) + 'px">' +
        '<div class="sheet" style="transform:scale(' + V.scale.toFixed(4) + ');transform-origin:top left" data-ui>' +
        pageInner(i) + '</div></div>';
      inner.appendChild(wrap);
      V.nodes[i] = wrap;
    }
  }

  var scrollTick = false;
  function onStageScroll() {
    if (scrollTick) return;
    scrollTick = true;
    setTimeout(function () { scrollTick = false; syncWindow(false); }, 16);
  }

  /* ---------------- 首屏那张纸 ---------------- */

  function renderHero() {
    var host = $('#heroPaper');
    if (!host || !PAGES.length) return;
    var maxW = Math.min(window.innerWidth - 40, 1240);
    var s = Math.min(1.12, Math.max(0.62, maxW / (LAYOUT.pw * PX_PER_MM)));
    var w = LAYOUT.pw * PX_PER_MM * s;
    var h = LAYOUT.ph * PX_PER_MM * s;
    host.innerHTML = '<div class="hero-frame" style="width:' + w.toFixed(0) + 'px;height:' + h.toFixed(0) + 'px">' +
      '<div class="sheet" style="transform:scale(' + s.toFixed(4) + ');transform-origin:top left" data-ui>' +
      pageInner(0) + '</div></div>';
  }

  /* ---------------- 数字 ---------------- */

  function countTo(el, to) {
    if (!el) return;
    var from = Number(el.getAttribute('data-v') || 0);
    el.setAttribute('data-v', to);
    if (from === to) { el.textContent = nf.format(to); return; }
    var t0 = performance.now(), dur = 420;
    function step(t) {
      var p = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = nf.format(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function updateStats() {
    var lab = $('#sRowsLabel');
    if (lab) lab.textContent = D.name === '示例数据' ? '行数据（示例）' : '行数据';
    countTo($('#sRows'), D.rows.length);
    countTo($('#sPages'), PAGES.length);
    countTo($('#sSheets'), Math.ceil(PAGES.length / 2));
    var rl = $('#pRangeLabel');
    if (rl) rl.textContent = PAGES.length ? '页码范围（共 ' + PAGES.length + ' 页）' : '页码范围';
  }

  /* ---------------- 重算 ---------------- */

  var renderTimer = null;

  function recalc(fast) {
    compute();
    GEN++;
    updateStats();
    if (fast) {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(function () { paint(true); }, 80);
    } else {
      paint(false);
    }
  }

  var dirty = { hero: true, tiles: true };

  function inView(el, margin) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > -margin && r.top < window.innerHeight + margin;
  }

  function buildVisible() {
    if (dirty.hero && inView($('#heroPaper'), 200)) { renderHero(); dirty.hero = false; }
    if (dirty.tiles && inView($('#tileFlow'), 300)) { buildTiles(); dirty.tiles = false; }
  }

  function paint(fast) {
    applyGeom();
    layoutPreview();
    dirty.hero = true;
    dirty.tiles = true;
    buildVisible();
    syncControls();
  }

  /* ---------------- 版式预设 ---------------- */

  function pagesFor(orient, cols, fontPt, lh, margin, gutter) {
    return estimate(orient, cols, fontPt, lh, margin, gutter);
  }

  function bestFor(fonts, lh, margins, gutter) {
    var best = null;
    var orients = ['landscape', 'portrait'];
    for (var o = 0; o < orients.length; o++) {
      for (var c = 1; c <= 3; c++) {
        for (var f = 0; f < fonts.length; f++) {
          for (var mi = 0; mi < margins.length; mi++) {
            var res = pagesFor(orients[o], c, fonts[f], lh, margins[mi], gutter);
            if (!res.ok || res.cramped || res.k > 0.035) continue;
            var score = res.pages * 1000 - fonts[f] * 20 - margins[mi];
            if (!best || score < best.score) {
              best = { score: score, orient: orients[o], cols: c, fontPt: fonts[f], pages: res.pages, margin: margins[mi] };
            }
          }
        }
      }
    }
    return best;
  }

  function applyPreset(kind) {
    S.preset = kind;
    S.widths = null;
    if (kind === 'auto') {
      var b = bestFor([10, 9.5, 9, 8.5, 8, 7.5, 7], 1.2, [8, 10, 12, 14], 6);
      if (b) { S.orient = b.orient; S.cols = b.cols; S.fontPt = b.fontPt; S.lh = 1.2; S.margin = b.margin; S.gutter = 6; }
    } else if (kind === 'clear') {
      S.orient = 'portrait'; S.cols = 1; S.fontPt = 9; S.lh = 1.45; S.margin = 15; S.gutter = 0;
    } else {
      var bt = bestFor([6, 6.5], 1.1, [7], 5);
      if (bt) { S.orient = bt.orient; S.cols = bt.cols; S.fontPt = bt.fontPt; S.lh = 1.1; S.margin = bt.margin; S.gutter = 5; }
      else { S.fontPt = 6; S.lh = 1.1; S.margin = 7; S.gutter = 5; S.orient = 'landscape'; S.cols = 2; }
    }
    recalc(false);
  }

  /* ---------------- 控件同步 ---------------- */

  // 先读后写：连续读 offsetLeft 会强制重排，混着写会让每次读都重新布局
  var SEG_NAMES = ['preset', 'orient', 'cols', 'face', 'zoom'];

  function syncSegs(map) {
    var plan = [], i, k;
    for (i = 0; i < SEG_NAMES.length; i++) {
      k = SEG_NAMES[i];
      var seg = $('.seg[data-seg="' + k + '"]');
      if (!seg || !(k in map)) continue;
      var btns = $$('button', seg), active = null;
      for (var j = 0; j < btns.length; j++) {
        if (btns[j].getAttribute('data-v') === String(map[k])) { active = btns[j]; break; }
      }
      plan.push({ seg: seg, btns: btns, active: active });
    }
    // 只读
    for (i = 0; i < plan.length; i++) {
      plan[i].x = plan[i].active ? plan[i].active.offsetLeft : 0;
      plan[i].w = plan[i].active ? plan[i].active.offsetWidth : 0;
    }
    // 再写
    for (i = 0; i < plan.length; i++) {
      var p = plan[i];
      for (var q = 0; q < p.btns.length; q++) {
        p.btns[q].setAttribute('aria-pressed', p.btns[q] === p.active ? 'true' : 'false');
      }
      var ind = $('.seg-ind', p.seg);
      if (ind) { ind.style.setProperty('--x', p.x + 'px'); ind.style.setProperty('--w', p.w + 'px'); }
    }
  }

  function syncSeg(name, value) {
    var m = {};
    m[name] = value;
    syncSegs(m);
  }

  function syncControls() {
    syncSegs({ preset: S.preset, orient: S.orient, cols: S.cols, face: S.face, zoom: S.zoom });
    if ($('#rFont')) { $('#rFont').value = S.fontPt; $('#oFont').textContent = String(S.fontPt).replace(/\.0$/, '') + ' pt'; }
    if ($('#rLh')) { $('#rLh').value = S.lh; $('#oLh').textContent = Number(S.lh).toFixed(2); }
    if ($('#rGut')) { $('#rGut').value = S.gutter; $('#oGut').textContent = S.gutter + ' mm'; }
    if ($('#rMar')) { $('#rMar').value = S.margin; $('#oMar').textContent = S.margin + ' mm'; }
    if ($('#cShade')) $('#cShade').checked = S.shade;
    if ($('#cFoot')) $('#cFoot').checked = S.foot;
    var note = $('#stageNote');
    if (note) {
      note.textContent = LAYOUT && LAYOUT.tight
        ? '这一栏偏紧，列宽已压到刚好放得下。拖表头边线可以自己分。'
        : '预览就是打印结果。滚动时按需渲染，所以很快。';
    }
  }

  /* ---------------- 放大片段 ---------------- */

  function miniGrid(rowList, fs, colList) {
    var L = LAYOUT;
    var sum = 0;
    for (var q = 0; q < colList.length; q++) sum += L.W[colList[q]];
    var gt = colList.map(function (j) { return (L.W[j] / sum * 100).toFixed(3) + '%'; }).join(' ');
    var shade = S.shade ? '#eceef1' : '#fff';
    var out = '<div class="zoomui" style="font-size:' + fs + 'px">' +
      '<div style="display:grid;grid-template-columns:' + gt + ';gap:1px;padding:1px;background:#14161a">';
    for (var i = 0; i < colList.length; i++) {
      out += '<div style="background:' + shade + ';padding:.16em .3em;white-space:nowrap;overflow:hidden;font-weight:700">' + esc(D.header[colList[i]] || '') + '</div>';
    }
    for (var r = 0; r < rowList.length; r++) {
      for (var k = 0; k < colList.length; k++) {
        var v = rowList[r][colList[k]] || '';
        out += '<div style="background:#fff;padding:.16em .3em;white-space:nowrap;overflow:hidden">' + esc(v) + '</div>';
      }
    }
    out += '</div></div>';
    return out;
  }

  function buildTiles() {
    if (!WRAW || !D.rows.length) return;
    var flow = $('#tileFlow');
    if (flow) flow.innerHTML = miniGrid(D.rows.slice(0, 8), 15, [1, 2, 3]);

    var head = $('#tileHead');
    if (head) head.innerHTML = miniGrid(D.rows.slice(0, 6), 16, [1, 2, 3]);

    var foot = $('#tileFoot');
    if (foot) foot.innerHTML = '<div class="footui" style="font-size:24px">' + (S.foot ? '第 3 页 共 ' + PAGES.length + ' 页' : '第 3 页') + '</div>';

    var drag = $('#tileDrag');
    if (drag) {
      var sh = S.shade ? '#eceef1' : '#fff';
      var w0 = LAYOUT.W[0], w1 = LAYOUT.W[1], s2 = w0 + w1;
      var g1 = (w0 / s2 * 100).toFixed(3) + '%', g2 = (w1 / s2 * 100).toFixed(3) + '%';
      var dv = '<div class="zoomui" style="font-size:15px">' +
        '<div style="display:grid;grid-template-columns:' + g1 + ' ' + g2 + ';gap:1px;padding:1px;background:#14161a">' +
        '<div style="background:' + sh + ';padding:.16em .3em;font-weight:700;white-space:nowrap;position:relative">' +
        esc(D.header[0] || '') + '<i style="position:absolute;right:-2px;top:0;bottom:0;width:2px;background:var(--accent)"></i></div>' +
        '<div style="background:' + sh + ';padding:.16em .3em;font-weight:700;white-space:nowrap;overflow:hidden">' + esc(D.header[1] || '') + '</div>';
      for (var di = 0; di < 3 && di < D.rows.length; di++) {
        dv += '<div style="background:#fff;padding:.16em .3em;white-space:nowrap;overflow:hidden">' + esc(D.rows[di][0] || '') + '</div>';
        dv += '<div style="background:#fff;padding:.16em .3em;white-space:nowrap;overflow:hidden">' + esc(D.rows[di][1] || '') + '</div>';
      }
      dv += '</div></div>';
      drag.innerHTML = dv;
    }
  }

  /* ---------------- 拖拽列宽 ---------------- */

  var drag = null;

  var stageEl = $('#stage');
  if (stageEl) {
    stageEl.addEventListener('pointerdown', function (e) {
      var h = e.target && e.target.closest ? e.target.closest('.hdl') : null;
      if (!h || !LAYOUT) return;
      e.preventDefault();
      var j = Number(h.getAttribute('data-j'));
      drag = { j: j, x0: e.clientX, w0: LAYOUT.W.slice(), sum: LAYOUT.W[j] + LAYOUT.W[j + 1], live: null };
      if (h.setPointerCapture && e.pointerId != null) { try { h.setPointerCapture(e.pointerId); } catch (er) {} }
      h.addEventListener('pointermove', onDragMove);
      h.addEventListener('pointerup', onDragEnd);
      h.addEventListener('pointercancel', onDragEnd);
    });
  }

  function onDragMove(e) {
    if (!drag) return;
    var dx = (e.clientX - drag.x0) / (PX_PER_MM * V.scale);
    var j = drag.j;
    var minA = Math.max(5, LAYOUT.need[j] * 0.5);
    var minB = Math.max(5, LAYOUT.need[j + 1] * 0.5);
    var a = Math.max(minA, Math.min(drag.w0[j] + dx, drag.sum - minB));
    var next = drag.w0.slice();
    next[j] = a;
    next[j + 1] = drag.sum - a;
    root.setProperty('--gt', next.map(function (w) { return w.toFixed(3) + 'mm'; }).join(' '));
    drag.live = next;
  }

  function onDragEnd(e) {
    if (!drag) return;
    var h = e.currentTarget;
    h.removeEventListener('pointermove', onDragMove);
    h.removeEventListener('pointerup', onDragEnd);
    h.removeEventListener('pointercancel', onDragEnd);
    if (drag.live) {
      S.widths = drag.live;
      S.preset = 'custom';
      drag = null;
      recalc(false);
      var nt = $('#stageNote');
      if (nt) nt.textContent = '列宽已按你拖的比例排。换字号或方向会回到按内容自动分配。';
    } else {
      drag = null;
    }
  }

  /* ---------------- 打印（独立窗口） ---------------- */

  function parseRange(str, n) {
    str = (str || '').replace(/\s+/g, '');
    if (!str) { var all = []; for (var q = 0; q < n; q++) all.push(q); return all; }
    var out = [], seen = {};
    var parts = str.split(/[,，;；]+/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i]; if (!p) continue;
      var m = p.match(/^(\d+)[-~](\d+)$/);
      var a, b;
      if (m) { a = +m[1]; b = +m[2]; }
      else if (/^\d+$/.test(p)) { a = b = +p; }
      else continue;
      if (a > b) { var t = a; a = b; b = t; }
      a = Math.max(1, a); b = Math.min(n, b);
      for (var k = a; k <= b; k++) if (!seen[k]) { seen[k] = 1; out.push(k - 1); }
    }
    out.sort(function (x, y) { return x - y; });
    if (!out.length) { for (var q2 = 0; q2 < n; q2++) out.push(q2); }
    return out;
  }

  function buildDoc(list) {
    var L = LAYOUT;
    var bodies = [];
    for (var i = 0; i < list.length; i++) {
      bodies.push('<div class="pg"><div class="sheet' + (S.shade ? ' shade' : '') + '">' + sheetInner(list[i], false) + '</div></div>');
    }
    var css = [
      '@page{size:A4 ' + (S.orient === 'landscape' ? 'landscape' : 'portrait') + ';margin:0}',
      'html,body{margin:0;padding:0;background:#fff;color:#000}',
      '*{box-sizing:border-box}',
      ':root{' + geomVars() + '}',
      '.pg{width:' + L.pw + 'mm;height:calc(' + L.ph + 'mm - 0.3mm);overflow:hidden;',
      'page-break-after:always;page-break-inside:avoid;break-after:page;break-inside:avoid}',
      '.pg:last-child{page-break-after:auto;break-after:auto}',
      SHEET_CSS,
      '.sheet{outline:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}'
    ].join('\n');

    var t = S.title ? S.title.replace(/[<>&"]/g, '') : '分栏打印';

    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + t + '</title>' +
      '<style>' + css + '</style>' +
      '<style>.hint{position:fixed;left:0;right:0;bottom:0;background:#f5f5f7;color:#333;font:13px/1.6 sans-serif;' +
      'padding:8px 16px;text-align:center;z-index:9}@media print{.hint{display:none !important}}</style>' +
      '</head><body>' + bodies.join('') +
      '<div class="hint">打印对话框没有自动弹出时，按 Ctrl+P（或 ⌘P）。关掉这个窗口不会影响你的表格。</div>' +
      '<script>window.onload=function(){setTimeout(function(){try{window.focus();window.print()}catch(e){}},150)};' +
      'window.onafterprint=function(){try{window.close()}catch(e){}};<\/script>' +
      '</body></html>';
  }

  function buildPagePrint(list) {
    var st = $('#printSize');
    if (!st) { st = document.createElement('style'); st.id = 'printSize'; document.head.appendChild(st); }
    st.textContent = '@page{size:A4 ' + (S.orient === 'landscape' ? 'landscape' : 'portrait') + ';margin:0}' +
      'html,body{margin:0;padding:0}' +
      '.pg{width:' + LAYOUT.pw + 'mm;height:calc(' + LAYOUT.ph + 'mm - 0.3mm);overflow:hidden;' +
      'page-break-after:always;break-after:page;page-break-inside:avoid}' +
      '.pg:last-child{page-break-after:auto;break-after:auto}' +
      '.sheet{outline:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}';
    var parts = [];
    for (var i = 0; i < list.length; i++) {
      parts.push('<div class="pg"><div class="sheet' + (S.shade ? ' shade' : '') + '">' + sheetInner(list[i], false) + '</div></div>');
    }
    $('#printRoot').innerHTML = parts.join('');
  }

  window.addEventListener('beforeprint', function () {
    var pr = $('#printRoot');
    if (!pr || !PAGES.length) return;
    if (!pr.innerHTML) {
      var all = [];
      for (var i = 0; i < PAGES.length; i++) all.push(i);
      buildPagePrint(all);
    }
  });

  function doPrint() {
    if (!PAGES.length) return;
    var list = parseRange($('#pRange') ? $('#pRange').value : '', PAGES.length);
    var btn = $('#printBtn');
    if (btn) btn.setAttribute('disabled', 'disabled');

    var w = null;
    try { w = window.open('', '_blank'); } catch (e) { w = null; }

    if (!w) {
      if (btn) btn.removeAttribute('disabled');
      buildPagePrint(list);
      window.print();
      setTimeout(function () { $('#printRoot').innerHTML = ''; }, 2000);
      return;
    }

    try {
      w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>正在生成打印版面</title></head>' +
        '<body style="margin:0;font-family:sans-serif"><div style="padding:48px;font-size:15px;color:#555">正在生成打印版面，共 ' + list.length + ' 页…</div></body></html>');
      w.document.close();
    } catch (e) {}

    setTimeout(function () {
      try {
        var html = buildDoc(list);
        w.document.open();
        w.document.write(html);
        w.document.close();
      } catch (e) {
        try { w.close(); } catch (e2) {}
      }
      if (btn) btn.removeAttribute('disabled');
    }, 60);
  }

  /* ---------------- 读文件 ---------------- */

  function p2(n) { return (n < 10 ? '0' : '') + n; }

  function buildSample() {
    var rows = [];
    var team = ['甲班', '乙班', '丙班'];
    var notes = ['无异常', '无异常', '无异常', '压力偏低', '运转有异响', '接口轻微渗漏'];
    var state = ['已闭环', '已闭环', '待复核'];
    for (var i = 0; i < 1200; i++) {
      var d = new Date(2025, 0, 1 + Math.floor(i * 90 / 1200));
      var ymd = '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate());
      rows.push([
        String(i + 1),
        'SB-' + ymd + '-' + ('000' + (i % 1000)).slice(-4),
        ymd,
        team[i % 3],
        notes[i % 6] === '无异常' ? '正常' : '异常',
        notes[i % 6],
        state[i % 3]
      ]);
    }
    return {
      header: ['序号', '设备编号', '巡检日期', '巡检班组', '巡检结果', '异常记录', '处理状态'],
      rows: rows,
      name: '示例数据'
    };
  }

  function loadSample() {
    D = buildSample();
    dataVer++;
    measure(true);
    compute();
    GEN++;
    updateStats();
    paint();
  }

  function useSheet(name) {
    var wb = D.book;
    if (!wb) return;
    var ws = wb.Sheets[name];
    if (!ws) return;
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
    if (!aoa.length) return;

    var hi = 0, best = -1;
    for (var i = 0; i < Math.min(5, aoa.length); i++) {
      var c = 0;
      for (var q = 0; q < aoa[i].length; q++) if (String(aoa[i][q]).trim() !== '') c++;
      if (c > best) { best = c; hi = i; }
    }

    var header = aoa[hi].map(function (v) { return String(v).trim(); });
    var n = header.length;
    while (n > 0 && header[n - 1] === '') n--;
    header = header.slice(0, n);
    if (!n) return;

    var rows = [];
    for (var r = hi + 1; r < aoa.length; r++) {
      var src = aoa[r];
      var cells = new Array(n);
      var any = false;
      for (var j = 0; j < n; j++) {
        var v2 = src[j];
        var t = v2 == null ? '' : String(v2).trim();
        cells[j] = t;
        if (t) any = true;
      }
      if (any) rows.push(cells);
    }

    D = { header: header, rows: rows, name: name, book: wb };
    dataVer++;

    if (hi > 0 && !S.title) {
      var above = aoa[0].filter(function (v) { return String(v).trim() !== ''; });
      if (above.length === 1) {
        S.title = String(above[0]).trim().slice(0, 40);
        if ($('#tTitle')) $('#tTitle').value = S.title;
      }
    }

    measure(true);
    applyPreset('auto');
    renderSheetPick(name);
  }

  function renderSheetPick(name) {
    var host = $('#sheetPick');
    if (!host) return;
    var names = (D.book && D.book.SheetNames) || [];
    if (names.length < 2) { host.innerHTML = ''; host.style.display = 'none'; return; }
    host.style.display = '';
    var out = '<span class="note" style="margin-right:10px">工作表</span>';
    for (var i = 0; i < names.length; i++) {
      out += '<button type="button" data-sheet="' + esc(names[i]) + '"' + (names[i] === name ? ' aria-pressed="true"' : '') + '>' + esc(names[i]) + '</button>';
    }
    host.innerHTML = out;
  }

  function readFile(file) {
    var fr = new FileReader();
    fr.onload = function (e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
        D.book = wb;
        useSheet(wb.SheetNames[0]);
      } catch (err) {
        var note = $('#stageNote');
        if (note) note.textContent = '这个文件读不出来：' + err.message;
      }
    };
    fr.readAsArrayBuffer(file);
  }

  /* ---------------- 事件 ---------------- */

  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.seg button') : null;
    if (btn) {
      var seg = btn.closest('.seg');
      var name = seg.getAttribute('data-seg');
      var v = btn.getAttribute('data-v');
      if (name === 'preset') { applyPreset(v); return; }
      if (name === 'orient') { S.orient = v; S.widths = null; S.preset = 'custom'; }
      if (name === 'cols') { S.cols = Number(v); S.widths = null; S.preset = 'custom'; }
      if (name === 'face') { S.face = v; measure(true); S.widths = null; }
      if (name === 'zoom') { S.zoom = v; syncSeg('zoom', v); layoutPreview(); return; }
      recalc(false);
      return;
    }

    var sheetBtn = e.target.closest ? e.target.closest('[data-sheet]') : null;
    if (sheetBtn) { useSheet(sheetBtn.getAttribute('data-sheet')); return; }

    var pick = e.target.closest ? e.target.closest('[data-pick]') : null;
    if (pick) { e.preventDefault(); $('#file').click(); return; }

    var smp = e.target.closest ? e.target.closest('[data-sample]') : null;
    if (smp) { e.preventDefault(); loadSample(); return; }
  });

  function bindRange(id, out, fmtFn, key, parse) {
    var el = $('#' + id), o = $('#' + out);
    if (!el) return;
    el.addEventListener('input', function () {
      S[key] = parse(el.value);
      o.textContent = fmtFn(S[key]);
      if (key === 'fontPt' || key === 'margin' || key === 'gutter') S.widths = null;
      S.preset = 'custom';
      recalc(true);
    });
    el.addEventListener('change', function () { recalc(false); });
  }

  bindRange('rFont', 'oFont', function (v) { return String(v).replace(/\.0$/, '') + ' pt'; }, 'fontPt', parseFloat);
  bindRange('rLh', 'oLh', function (v) { return Number(v).toFixed(2); }, 'lh', parseFloat);
  bindRange('rGut', 'oGut', function (v) { return v + ' mm'; }, 'gutter', parseFloat);
  bindRange('rMar', 'oMar', function (v) { return v + ' mm'; }, 'margin', parseFloat);

  if ($('#cShade')) $('#cShade').addEventListener('change', function () { S.shade = this.checked; recalc(false); });
  if ($('#cFoot')) $('#cFoot').addEventListener('change', function () { S.foot = this.checked; recalc(false); });

  var titleTimer = null;
  if ($('#tTitle')) $('#tTitle').addEventListener('input', function () {
    var v = this.value.trim();
    clearTimeout(titleTimer);
    titleTimer = setTimeout(function () { S.title = v; recalc(false); }, 260);
  });

  if ($('#printBtn')) $('#printBtn').addEventListener('click', doPrint);

  if ($('#file')) $('#file').addEventListener('change', function () {
    if (this.files && this.files[0]) readFile(this.files[0]);
    this.value = '';
  });

  var dragDepth = 0;
  function dropOn() { if (document.body.className.indexOf('dropping') < 0) document.body.className += ' dropping'; }
  function dropOff() { document.body.className = document.body.className.replace(/\s*dropping\b/g, ''); }

  window.addEventListener('dragenter', function (e) {
    if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'File') < 0) return;
    dragDepth++;
    dropOn();
  });
  window.addEventListener('dragover', function (e) { e.preventDefault(); });
  window.addEventListener('dragleave', function () {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) dropOff();
  });
  window.addEventListener('drop', function (e) {
    e.preventDefault();
    dragDepth = 0;
    dropOff();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]);
  });

  /* 焦点样式：鼠标点不显示描边，键盘操作显示（:focus-visible 的替代） */
  document.addEventListener('mousedown', function () { dropOff; document.documentElement.className += ' using-mouse'; }, true);
  document.addEventListener('keydown', function () {
    document.documentElement.className = document.documentElement.className.replace(/\s*using-mouse\b/g, '');
  }, true);

  /* FAQ 互斥展开（替代 details[name]） */
  function bindDetails() {
    var list = $$('.acc details');
    for (var i = 0; i < list.length; i++) {
      (function (d) {
        d.addEventListener('toggle', function () {
          if (!d.open) return;
          for (var k = 0; k < list.length; k++) if (list[k] !== d) list[k].open = false;
        });
      })(list[i]);
    }
  }

  /* 入场 */
  function observeReveals() {
    var els = $$('.rv');
    if (!('IntersectionObserver' in window)) {
      for (var i = 0; i < els.length; i++) els[i].className += ' in';
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.className += ' in';
          io.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    for (var k = 0; k < els.length; k++) io.observe(els[k]);
  }

  /* 尺寸变化 */
  var winScrollTick = false;
  window.addEventListener('scroll', function () {
    if (winScrollTick) return;
    winScrollTick = true;
    setTimeout(function () { winScrollTick = false; buildVisible(); }, 120);
  }, { passive: true });

  var rzTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(function () {
      if (!LAYOUT) return;
      layoutPreview();
      dirty.tiles = true;
      buildVisible();
      syncSegs({ preset: S.preset, orient: S.orient, cols: S.cols, face: S.face, zoom: S.zoom });
    }, 160);
  });

  /* ---------------- 启动 ---------------- */

  function boot() {
    injectSheetCSS();
    loadSample();
    applyPreset('auto');
    bindDetails();
    observeReveals();
    var stage = $('#stage');
    if (stage) stage.addEventListener('scroll', onStageScroll, { passive: true });
    setTimeout(function () {
      syncSegs({ preset: S.preset, orient: S.orient, cols: S.cols, face: S.face, zoom: S.zoom });
    }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.__fp = {
    S: S,
    get D() { return D; },
    get layout() { return LAYOUT; },
    get pages() { return PAGES.length; },
    get rendered() { return Object.keys(V.nodes).length; },
    doc: function (a) { return buildDoc(parseRange(a || '', PAGES.length)); },
    time: function () {
      var t0 = performance.now(); measure(true); var t1 = performance.now();
      compute(); var t2 = performance.now(); paint(); var t3 = performance.now();
      return { measure: Math.round(t1 - t0), compute: Math.round(t2 - t1), paint: Math.round(t3 - t2) };
    },
    ranges: function () { return PAGES.map(function (p) { return [p[0][0], p[p.length - 1][1]]; }); }
  };
})();
