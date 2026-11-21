/* de/kino lüğət — montaj masası */
(function () {
  'use strict';

  // Google Sheets: cədvəl "linki olan hər kəs baxa bilər" olanda sayt məlumatı birbaşa oradan oxuyur.
  var SHEET_ID = '1Gl9ctU4BHU2B7Kb4RzGeK1VIqRLqLDvMswpC0NDrl5U';
  var DEFAULT_TERM = 'kadrxarici-mekan';
  var AZ = 'A B C Ç D E Ə F G Ğ H X I İ J K Q L M N O Ö P R S Ş T U Ü V Y Z'.split(' ');
  var N = AZ.length;

  var state = { kanallar: [], terms: [], bySlug: {}, byName: {}, order: [], open: {}, sel: null, zoom: 1, booted: false };
  var $ = function (id) { return document.getElementById(id); };
  var mobile = function () { return window.matchMedia('(max-width:760px)').matches; };
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- köməkçilər ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function upAz(ch) { return ch === 'i' ? 'İ' : ch === 'ı' ? 'I' : ch.toUpperCase(); }
  function letterIdx(name) {
    var c = upAz((name || '').trim().charAt(0));
    var i = AZ.indexOf(c);
    return i < 0 ? 0 : i;
  }
  var TR = { 'ə': 'e', 'Ə': 'e', 'ı': 'i', 'I': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ü': 'u', 'Ü': 'u', 'ş': 's', 'Ş': 's', 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g' };
  function fold(s) { return String(s || '').replace(/[əƏıIİöÖüÜşŞçÇğĞ]/g, function (c) { return TR[c]; }).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[ʼ'`]/g, ''); }
  function slug(s) { return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function azKey(s) {
    // A–Z sıralaması üçün açar: hər hərf öz indeksinə çevrilir
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var k = AZ.indexOf(upAz(s.charAt(i)));
      var ch = s.charAt(i);
      out += k < 0 ? (/\s/.test(ch) ? ' ' : /\d/.test(ch) ? '0' + ch : '~' + ch.toLowerCase()) : String.fromCharCode(65 + k);
    }
    return out;
  }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return Math.abs(h); }

  // ---------- məlumat ----------
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { f += '"'; i++; } else { q = false; } } else { f += c; }
      } else if (c === '"') { q = true; }
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else if (c !== '\r') { f += c; }
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  function fromSheet(termRows, kanalRows) {
    var K = kanalRows.slice(1).filter(function (r) { return r[0]; }).map(function (r) {
      return { kod: r[0].trim(), ad: r[1], kanal: r[2], alt: r[3], tesvir: r[4] };
    });
    var T = termRows.slice(1).filter(function (r) { return r[0] && r[1] && (r[9] || 'bəli').trim().toLowerCase() !== 'xeyr'; }).map(function (r) {
      return { termin: r[0].trim(), kanal: r[1].trim(), alt: (r[2] || '').trim(), orijinal: r[3], tarif: r[4], tanimaq: r[5], elaqeli: r[6], dekino: r[7], sxem: (r[8] || '').trim() };
    });
    return { kanallar: K, terminler: T };
  }
  function sheetURL(tab) { return 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab); }
  function loadSheet() {
    if (!window.fetch) return Promise.reject();
    var ctl = window.AbortController ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    var opt = ctl ? { signal: ctl.signal } : {};
    return Promise.all([fetch(sheetURL('Terminlər'), opt), fetch(sheetURL('Kanallar'), opt)]).then(function (rs) {
      clearTimeout(t);
      if (!rs[0].ok || !rs[1].ok) throw new Error('sheet');
      return Promise.all([rs[0].text(), rs[1].text()]);
    }).then(function (tx) {
      if (/^\s*</.test(tx[0])) throw new Error('not csv');
      var d = fromSheet(parseCSV(tx[0]), parseCSV(tx[1]));
      if (!d.terminler.length || !d.kanallar.length) throw new Error('empty');
      return d;
    });
  }

  function ingest(d) {
    state.kanallar = d.kanallar.map(function (k) {
      return { kod: k.kod, ad: k.ad, ch: k.kanal, audio: /^A/i.test(k.kanal), subs: String(k.alt || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean), tesvir: k.tesvir };
    });
    var known = {};
    state.kanallar.forEach(function (k) { known[k.kod] = k; });
    state.terms = d.terminler.filter(function (t) { return known[t.kanal]; }).map(function (t) {
      var o = {
        name: t.termin, kanal: t.kanal, alt: t.alt || 'Digər', orig: t.orijinal || '', def: t.tarif || '',
        how: String(t.tanimaq || '').split('|').map(function (s) { return s.trim(); }).filter(Boolean),
        rel: String(t.elaqeli || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean),
        post: (t.dekino || '').trim(), sxem: (t.sxem || '').trim()
      };
      o.slug = slug(o.name); o.idx = letterIdx(o.name); o.key = azKey(o.name);
      var k = known[o.kanal];
      if (k.subs.indexOf(o.alt) < 0) k.subs.push(o.alt);
      return o;
    });
    state.bySlug = {}; state.byName = {};
    state.terms.forEach(function (t) { state.bySlug[t.slug] = t; state.byName[t.name.toLowerCase()] = t; });
    state.order = state.terms.slice().sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
  }

  // ---------- timeline ----------
  function renderRuler() {
    var has = {};
    state.terms.forEach(function (t) { has[t.idx] = (has[t.idx] || 0) + 1; });
    $('ruler').innerHTML = AZ.map(function (ch, i) {
      return '<button type="button" data-i="' + i + '" class="' + (has[i] ? 'has' : '') + '"' + (has[i] ? ' title="' + ch + ': ' + has[i] + ' termin"' : ' disabled') + '>' + ch + '</button>';
    }).join('');
  }

  function renderTracks() {
    var groups = [
      { label: 'V · FORMA: kinonun dili', items: state.kanallar.filter(function (k) { return !k.audio; }) },
      { label: 'A · KONTEKST: kinonun dünyası', items: state.kanallar.filter(function (k) { return k.audio; }) }
    ];
    var html = '';
    var t0 = 0.2;
    groups.forEach(function (g) {
      if (!g.items.length) return;
      html += '<div class="grp">' + esc(g.label) + '</div>';
      g.items.forEach(function (k) {
        var terms = state.terms.filter(function (t) { return t.kanal === k.kod; });
        var open = !!state.open[k.kod];
        html += '<div class="track' + (open ? ' open' : '') + '" data-k="' + esc(k.kod) + '">';
        html += '<div class="row"><button type="button" class="thead" aria-expanded="' + open + '" title="' + esc(k.tesvir || '') + '">' +
          '<span class="chip ' + (k.audio ? 'a' : 'v') + '">' + esc(k.ch) + '</span>' +
          '<span class="tname"><b>' + esc(k.ad) + '</b><small>' + esc(k.kod) + ' · ' + terms.length + ' termin</small></span>' +
          '<span class="arrow" aria-hidden="true">▸</span></button>';
        html += '<div class="lane">';
        if (open) {
          html += '<span class="lane-note">' + k.subs.length + ' alt kanal açıqdır</span>';
        } else {
          var seen = {};
          terms.forEach(function (t, j) {
            var dup = seen[t.idx] || 0; seen[t.idx] = dup + 1;
            var h = 46 + hash(t.name) % 40;
            var top = k.audio ? (100 - h) / 2 : 100 - h - 12;
            html += '<button type="button" class="tick' + (k.audio ? ' a' : '') + (state.sel === t ? ' on' : '') + '" data-s="' + t.slug + '" title="' + esc(t.name) + '" aria-label="' + esc(t.name) + '" style="left:calc(' + ((t.idx + 0.5) / N * 100).toFixed(3) + '% + ' + (dup * 6 - 2) + 'px);top:' + top + '%;height:' + h + '%;animation-delay:' + (state.booted ? 0 : (t0 + j * 0.05)).toFixed(2) + 's"></button>';
          });
        }
        html += '</div></div>';
        if (open) {
          html += '<div class="subs">';
          k.subs.forEach(function (s) {
            var list = terms.filter(function (t) { return t.alt === s; }).sort(function (a, b) { return a.key < b.key ? -1 : 1; });
            if (!list.length) return;
            html += '<div class="sub"><div class="shead" title="' + esc(s) + '">↳ ' + esc(s) + '</div><div class="slane">';
            list.forEach(function (t, j) {
              html += '<button type="button" class="clip' + (state.sel === t ? ' on' : '') + '" data-s="' + t.slug + '" data-i="' + t.idx + '" style="animation-delay:' + (j * 0.06).toFixed(2) + 's">' + esc(t.name) + '</button>';
            });
            html += '</div></div>';
          });
          html += '</div>';
        }
        html += '</div>';
        t0 += 0.12;
      });
    });
    $('tracks').innerHTML = html;
    layoutClips();
    var allOpen = state.kanallar.every(function (k) { return state.open[k.kod]; });
    $('toggleAll').textContent = allOpen ? 'Hamısını yığ' : 'Hamısını aç';
  }

  var measureCtx = null;
  function textW(s) {
    if (!measureCtx) { measureCtx = document.createElement('canvas').getContext('2d'); }
    measureCtx.font = '500 13px Poppins, sans-serif';
    return Math.ceil(measureCtx.measureText(s).width) + 22;
  }
  function layoutClips() {
    var lanes = document.querySelectorAll('.slane');
    if (mobile()) {
      lanes.forEach(function (l) { l.style.height = ''; l.querySelectorAll('.clip').forEach(function (c) { c.style.left = ''; c.style.top = ''; }); });
      return;
    }
    lanes.forEach(function (lane) {
      var W = lane.clientWidth, rowsEnd = [], clips = Array.prototype.slice.call(lane.querySelectorAll('.clip'));
      var items = clips.map(function (c) {
        var w = textW(c.textContent);
        var left = (+c.getAttribute('data-i')) / N * W + 2;
        if (left + w > W - 2) left = Math.max(2, W - 2 - w);
        return { el: c, left: left, w: w };
      }).sort(function (a, b) { return a.left - b.left; });
      items.forEach(function (it) {
        var r = 0;
        while (r < rowsEnd.length && rowsEnd[r] > it.left - 4) r++;
        rowsEnd[r] = it.left + it.w;
        it.el.style.left = it.left.toFixed(1) + 'px';
        it.el.style.top = (6 + r * 34) + 'px';
      });
      lane.style.height = (12 + Math.max(1, rowsEnd.length) * 34 - 6) + 'px';
    });
  }

  function movePlayhead() {
    var t = state.sel;
    if (!t) return;
    $('ph').style.left = 'calc(' + ((t.idx + 0.5) / N * 100).toFixed(3) + '% - 1px)';
    $('phTag').textContent = AZ[t.idx];
    document.querySelectorAll('#ruler button').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-i') === t.idx); });
  }

  function setZoom(z) {
    state.zoom = z;
    $('tlInner').style.width = (z * 100) + '%';
    layoutClips();
    // seçilmiş termini görünən yerdə saxla
    var sc = $('tlScroll');
    if (state.sel && z > 1) {
      var laneW = $('tlInner').clientWidth - 212;
      var x = 212 + (state.sel.idx + 0.5) / N * laneW;
      sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
    }
  }

  // ---------- monitor ----------
  function kanalOf(t) { for (var i = 0; i < state.kanallar.length; i++) if (state.kanallar[i].kod === t.kanal) return state.kanallar[i]; return null; }

  function renderMonitor() {
    var t = state.sel;
    if (!t) return;
    var k = kanalOf(t);
    var pos = state.order.indexOf(t);
    var prev = state.order[(pos - 1 + state.order.length) % state.order.length];
    var next = state.order[(pos + 1) % state.order.length];
    var num = ('00' + (state.terms.filter(function (x) { return x.kanal === t.kanal; }).indexOf(t) + 1)).slice(-3);
    $('monLabel').innerHTML = '<span class="red2">▶</span> PROGRAM · ' + esc(k.ch) + ' ' + esc(k.kod) + ' · ' + esc(t.alt) + ' · ' + num;
    $('prevName').textContent = prev.name;
    $('nextName').textContent = next.name;
    $('prev').setAttribute('data-s', prev.slug);
    $('next').setAttribute('data-s', next.slug);

    var how = t.how.length ? '<div class="how"><h3>NECƏ TANIMAQ OLAR</h3>' + t.how.map(function (h) { return '<p>' + esc(h) + '</p>'; }).join('') + '</div>' : '';
    var meta = '<dl class="meta">' + (t.orig ? '<dt>ORİJİNAL</dt><dd>' + esc(t.orig) + '</dd>' : '') + '<dt>KANAL</dt><dd>' + esc(k.ad) + ' → ' + esc(t.alt) + '</dd></dl>';
    var fig = DIAGRAMS[t.sxem]
      ? '<figure class="fig">' + DIAGRAMS[t.sxem].svg + '<figcaption>' + esc(DIAGRAMS[t.sxem].cap) + '</figcaption></figure>'
      : '<div class="nofig">Bu termin üçün sxem hələ çəkilməyib.</div>';
    var rel = t.rel.map(function (r) { return state.byName[r.toLowerCase()]; }).filter(Boolean);
    var relHtml = rel.length ? '<div><h3>ƏLAQƏLİ</h3><div class="rel" style="margin-top:12px">' + rel.map(function (r) {
      return '<button type="button" data-s="' + r.slug + '">' + esc(r.name) + '<small>' + esc(r.kanal) + '</small></button>';
    }).join('') + '</div></div>' : '';
    var post = '';
    if (t.post) {
      var url = /^https?:/.test(t.post) ? t.post : 'https://www.dekino.org/p/' + t.post.replace(/^\/?(p\/)?/, '');
      post = '<a class="post" href="' + esc(url) + '"><span class="mono">DE/KİNO-DA ↗</span><b>' + esc(postTitle(url)) + '</b></a>';
    }
    $('mon').innerHTML =
      '<article class="art swap"><h2>' + esc(t.name) + '</h2>' + meta + (t.def ? '<p class="def">' + esc(t.def) + '</p>' : '') + how + '</article>' +
      '<aside class="side swap" style="animation-delay:.12s">' + fig + relHtml + post + '</aside>';
    document.title = t.name + ' · de/kino lüğət';
  }
  var POSTS = {
    'the-hand-of-god-filmindn-oyrncyimiz': 'The Hand of God filmindən öyrənəcəyimiz beş kino anlayışı',
    'close-2022-filmi-nyi-itirrk-kisi': 'Close (2022)',
    'normal-people-ulduzlar-mullifin-mudafisin': 'Normal People',
    'diktaturann-kolgsind-montaj-qzl-palma': 'Diktaturanın kölgəsində montaj',
    'qisas-yoxsa-bagslama-it-was-just': 'Qisas, yoxsa bağışlama? It Was Just an Accident',
    'minotaur-2026-ckilisindn-drslr-hqiqi': 'Minotaur (2026)'
  };
  function postTitle(url) { var m = url.match(/\/p\/([^/?#]+)/); return (m && POSTS[m[1]]) || 'Yazını oxu'; }

  // ---------- seçim ----------
  function select(t, opts) {
    opts = opts || {};
    if (!t) return;
    var changed = state.sel !== t;
    state.sel = t;
    if (!state.open[t.kanal] && opts.openTrack !== false) { state.open[t.kanal] = true; renderTracks(); }
    else {
      document.querySelectorAll('.clip.on,.tick.on').forEach(function (e) { e.classList.remove('on'); });
      document.querySelectorAll('[data-s="' + t.slug + '"]').forEach(function (e) { if (e.classList.contains('clip') || e.classList.contains('tick')) e.classList.add('on'); });
    }
    movePlayhead();
    if (changed || opts.force) renderMonitor();
    try { history.replaceState(null, '', '#' + t.slug); } catch (e) { /* bə'zi çərçivələrdə icazə yoxdur */ }
    if (opts.scroll) {
      var m = $('monitor');
      var r = m.getBoundingClientRect();
      if (r.top > window.innerHeight * 0.55 || r.top < -40) m.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    }
  }

  // ---------- axtarış ----------
  var active = -1, found = [];
  function search(q) {
    var f = fold(q).trim();
    var box = $('results');
    if (!f) { box.hidden = true; $('q').setAttribute('aria-expanded', 'false'); return; }
    found = state.order.map(function (t) {
      var n = fold(t.name), o = fold(t.orig), d = fold(t.def);
      var s = n.indexOf(f) === 0 ? 0 : n.indexOf(f) > -1 ? 1 : o.indexOf(f) > -1 ? 2 : d.indexOf(f) > -1 ? 3 : -1;
      return { t: t, s: s };
    }).filter(function (x) { return x.s > -1; }).sort(function (a, b) { return a.s - b.s; }).slice(0, 8).map(function (x) { return x.t; });
    active = found.length ? 0 : -1;
    box.innerHTML = found.length ? found.map(function (t, i) {
      return '<li role="option" id="r' + i + '" data-s="' + t.slug + '" aria-selected="' + (i === active) + '">' + esc(t.name) + '<span>' + esc(t.kanal) + ' · ' + esc(t.alt) + '</span></li>';
    }).join('') : '<li class="empty">Belə termin hələ yoxdur. Təklif etmək üçün aşağıdakı linkə bax.</li>';
    box.hidden = false;
    $('q').setAttribute('aria-expanded', 'true');
  }
  function markActive() {
    document.querySelectorAll('#results li[role=option]').forEach(function (li, i) { li.setAttribute('aria-selected', String(i === active)); });
    if (active > -1) $('q').setAttribute('aria-activedescendant', 'r' + active);
  }
  function pick(t) { $('q').value = ''; $('results').hidden = true; $('q').setAttribute('aria-expanded', 'false'); select(t, { scroll: true }); }

  // ---------- hadisələr ----------
  function bind() {
    $('tracks').addEventListener('click', function (e) {
      var h = e.target.closest('.thead');
      if (h) {
        var k = h.parentNode.parentNode.getAttribute('data-k');
        state.open[k] = !state.open[k];
        renderTracks();
        return;
      }
      var s = e.target.closest('[data-s]');
      if (s) select(state.bySlug[s.getAttribute('data-s')], { scroll: true });
    });
    $('ruler').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]');
      if (!b || b.disabled) return;
      var i = +b.getAttribute('data-i');
      var t = state.order.filter(function (x) { return x.idx === i; })[0];
      if (t) select(t, { scroll: false });
    });
    $('mon').addEventListener('click', function (e) {
      var s = e.target.closest('button[data-s]');
      if (s) select(state.bySlug[s.getAttribute('data-s')], { scroll: true });
    });
    ['prev', 'next'].forEach(function (id) {
      $(id).addEventListener('click', function () { select(state.bySlug[$(id).getAttribute('data-s')]); });
    });
    $('toggleAll').addEventListener('click', function () {
      var allOpen = state.kanallar.every(function (k) { return state.open[k.kod]; });
      state.kanallar.forEach(function (k) { state.open[k.kod] = !allOpen; });
      renderTracks();
    });
    $('zoom').addEventListener('input', function () { setZoom(+this.value); });
    var q = $('q');
    q.addEventListener('input', function () { search(q.value); });
    q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' && found.length) { active = (active + 1) % found.length; markActive(); e.preventDefault(); }
      else if (e.key === 'ArrowUp' && found.length) { active = (active - 1 + found.length) % found.length; markActive(); e.preventDefault(); }
      else if (e.key === 'Enter' && active > -1) { pick(found[active]); e.preventDefault(); }
      else if (e.key === 'Escape') { q.value = ''; search(''); }
    });
    $('results').addEventListener('mousedown', function (e) {
      var li = e.target.closest('li[data-s]');
      if (li) { e.preventDefault(); pick(state.bySlug[li.getAttribute('data-s')]); }
    });
    q.addEventListener('blur', function () { setTimeout(function () { $('results').hidden = true; q.setAttribute('aria-expanded', 'false'); }, 120); });
    document.addEventListener('keydown', function (e) {
      var typing = /INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || '');
      if ((e.key === '/' && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) { e.preventDefault(); q.focus(); return; }
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        if (e.target.closest && e.target.closest('input[type=range]')) return;
        select(state.bySlug[$(e.key === 'ArrowRight' ? 'next' : 'prev').getAttribute('data-s')]);
      }
    });
    window.addEventListener('hashchange', function () { var t = state.bySlug[location.hash.slice(1)]; if (t && t !== state.sel) select(t, { scroll: true }); });
    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(layoutClips, 120); });
  }

  function stat() {
    $('stat').textContent = 'REC · ' + state.terms.length + ' TERMİN · ' + state.kanallar.length + ' KANAL';
  }

  function boot(d) {
    var prevSlug = state.sel && state.sel.slug;
    ingest(d);
    stat();
    renderRuler();
    var start = state.bySlug[prevSlug] || state.bySlug[location.hash.slice(1)] || state.bySlug[DEFAULT_TERM] || state.order[0];
    state.open = state.open || {};
    if (!state.booted) state.open[start.kanal] = true;
    state.sel = null;
    renderTracks();
    if (!state.booted && !reduced) {
      // ilk açılışda pleyhed A-dan seçilmiş hərfə "scrub" edir
      $('ph').style.transition = 'none';
      $('ph').style.left = '0%';
      void $('ph').offsetWidth;
      $('ph').style.transition = '';
      setTimeout(function () { select(start, { openTrack: false, force: true }); }, 450);
      state.sel = start; renderMonitor(); state.sel = null;
    } else {
      select(start, { openTrack: false, force: true });
    }
    if (!state.booted) bind();
    state.booted = true;
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutClips);
  }

  // ---------- sxemlər ----------
  var C = '#F5F1EA', R = '#FF2E3B', G = '#4A4A4A', M = "font-family:'DM Mono',monospace;font-size:10px";
  function svg(inner, label) { return '<svg viewBox="0 0 320 200" role="img" aria-label="' + esc(label) + '"><rect width="320" height="200" fill="#0D0D0D"/>' + inner + '</svg>'; }
  function fig(x, y, h, col, extra) { var w = Math.round(h * 0.42); return '<rect x="' + (x - w / 2) + '" y="' + (y - h) + '" width="' + w + '" height="' + h + '" rx="' + (w / 2) + '" fill="' + col + '"' + (extra || '') + '/>'; }
  function cam(x, y, col) { return '<g stroke="' + col + '" stroke-width="1.5" fill="none"><rect x="' + (x - 13) + '" y="' + (y - 8) + '" width="20" height="16" rx="2"/><path d="M' + (x + 7) + ' ' + (y - 4) + ' L' + (x + 14) + ' ' + (y - 8) + ' L' + (x + 14) + ' ' + (y + 8) + ' L' + (x + 7) + ' ' + (y + 4) + '"/></g>'; }
  var DIAGRAMS = {
    'kadrxarici': { cap: 'Görünməyən mənbə kadrın içinə səs və baxışla daxil olur.', svg: svg(
      '<rect x="22" y="20" width="276" height="160" fill="none" stroke="' + G + '" stroke-dasharray="4 4"/>' +
      '<rect x="50" y="44" width="160" height="112" fill="none" stroke="' + C + '" stroke-width="1.5"/>' +
      '<text x="56" y="38" fill="#A3A3A3" style="' + M + '">KADR</text>' + fig(118, 130, 36, C) +
      '<line x1="132" y1="104" x2="250" y2="104" stroke="' + R + '" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<circle class="ring" cx="264" cy="112" r="16" fill="none" stroke="' + R + '" stroke-width="1.5"/>' +
      '<circle class="ring" cx="264" cy="112" r="16" fill="none" stroke="' + R + '" stroke-width="1.5" style="animation-delay:.87s"/>' +
      '<circle class="ring" cx="264" cy="112" r="16" fill="none" stroke="' + R + '" stroke-width="1.5" style="animation-delay:1.74s"/>' +
      fig(264, 130, 36, R) + '<text x="236" y="168" fill="' + R + '" style="' + M + '">səs, baxış</text>', 'Kadrxarici məkan sxemi') },
    'ucde-bir': { cap: 'Əsas obyekt xətlərin kəsişməsində: kadr tarazlanır, amma statik qalmır.', svg: svg(
      '<rect x="30" y="20" width="260" height="160" fill="none" stroke="' + C + '" stroke-width="1.5"/>' +
      '<g stroke="#6B6B6B"><line x1="116.7" y1="20" x2="116.7" y2="180"/><line x1="203.3" y1="20" x2="203.3" y2="180"/><line x1="30" y1="73.3" x2="290" y2="73.3"/><line x1="30" y1="126.7" x2="290" y2="126.7"/></g>' +
      '<circle class="ring" cx="203.3" cy="73.3" r="9" fill="none" stroke="' + R + '" stroke-width="1.5"/>' +
      '<circle cx="203.3" cy="73.3" r="8" fill="' + R + '"/>' + fig(203.3, 150, 60, C, ' opacity=".35"'), 'Üçdə bir qaydası sxemi') },
    'qayda-180': { cap: 'Kamera xəttin bir tərəfində qalır. Xətti keçən kamera istiqaməti qarışdırır.', svg: svg(
      '<line x1="18" y1="96" x2="302" y2="96" stroke="' + R + '" stroke-width="1.5" stroke-dasharray="6 5"/>' +
      '<text x="270" y="88" fill="' + R + '" style="' + M + '">180°</text>' +
      '<circle cx="118" cy="96" r="11" fill="' + C + '"/><circle cx="202" cy="96" r="11" fill="' + C + '"/>' +
      '<text x="111" y="70" fill="#A3A3A3" style="' + M + '">A</text><text x="196" y="70" fill="#A3A3A3" style="' + M + '">B</text>' +
      cam(100, 150, C) + cam(162, 168, C) + cam(224, 150, C) +
      '<path d="M100 140 L118 104 M162 158 L160 108 M224 140 L202 104" stroke="#6B6B6B" stroke-dasharray="2 3"/>' +
      cam(160, 34, '#6B6B6B') + '<path d="M146 22 L174 46 M174 22 L146 46" stroke="' + R + '" stroke-width="2"/>', '180 dərəcə qaydası sxemi') },
    'dolly-zoom': { cap: 'Fiqur yerində qalır, fon isə "nəfəs alır": kamera yaxınlaşır, obyektiv uzaqlaşır.', svg: svg(
      '<g class="dz"><rect x="40" y="20" width="240" height="160" fill="none" stroke="#6B6B6B"/><rect x="100" y="58" width="120" height="84" fill="none" stroke="' + C + '" stroke-width="1.2"/>' +
      '<path d="M40 20 L100 58 M280 20 L220 58 M40 180 L100 142 M280 180 L220 142" stroke="#6B6B6B"/></g>' +
      fig(160, 128, 44, R) + '<text x="14" y="190" fill="#A3A3A3" style="' + M + '">dolly ↗  zoom ↙</text>', 'Dolly zoom sxemi') },
    'sahe-derinliyi': { cap: 'Yalnız ortadakı plan kəskindir: diqqət oraya yönəlir.', svg: svg(
      '<defs><filter id="bl" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>' +
      fig(70, 150, 70, C, ' opacity=".45" filter="url(#bl)"') + fig(160, 160, 100, C) + fig(250, 140, 52, C, ' opacity=".4" filter="url(#bl)"') +
      '<line x1="118" y1="176" x2="202" y2="176" stroke="' + R + '" stroke-width="2"/><line x1="118" y1="170" x2="118" y2="182" stroke="' + R + '" stroke-width="2"/><line x1="202" y1="170" x2="202" y2="182" stroke="' + R + '" stroke-width="2"/>' +
      '<text x="128" y="194" fill="' + R + '" style="' + M + '">kəskin zona</text>', 'Sahə dərinliyi sxemi') },
    'kulesov': { cap: 'Sifət eynidir. Yanındakı kadr dəyişəndə tamaşaçının oxuduğu hiss dəyişir.', svg: svg(
      '<rect x="36" y="56" width="96" height="72" rx="3" fill="none" stroke="' + C + '" stroke-width="1.5"/>' +
      '<ellipse cx="84" cy="92" rx="18" ry="22" fill="none" stroke="' + C + '" stroke-width="1.5"/><circle cx="77" cy="88" r="2" fill="' + C + '"/><circle cx="91" cy="88" r="2" fill="' + C + '"/><line x1="78" y1="102" x2="90" y2="102" stroke="' + C + '" stroke-width="1.5"/>' +
      '<text x="146" y="98" fill="' + R + '" style="font-family:\'DM Mono\',monospace;font-size:18px">+</text>' +
      '<rect x="172" y="56" width="96" height="72" rx="3" fill="none" stroke="' + C + '" stroke-width="1.5"/>' +
      '<g class="kc"><path d="M196 92 Q220 120 244 92 Z" fill="none" stroke="' + C + '" stroke-width="1.5"/><text x="194" y="160" fill="#A3A3A3" style="' + M + '">şorba → aclıq</text></g>' +
      '<g class="kc" style="animation-delay:-6s"><path d="M210 70 L230 70 L238 84 L230 116 L210 116 L202 84 Z" fill="none" stroke="' + C + '" stroke-width="1.5"/><text x="194" y="160" fill="#A3A3A3" style="' + M + '">tabut → kədər</text></g>' +
      '<g class="kc" style="animation-delay:-3s"><circle cx="220" cy="80" r="7" fill="none" stroke="' + C + '" stroke-width="1.5"/><rect x="213" y="90" width="14" height="24" rx="7" fill="none" stroke="' + C + '" stroke-width="1.5"/><text x="194" y="160" fill="#A3A3A3" style="' + M + '">uşaq → sevgi</text></g>' +
      '<text x="284" y="98" fill="' + R + '" style="font-family:\'DM Mono\',monospace;font-size:18px">?</text>', 'Kuleşov effekti sxemi') }
  };

  // ---------- başlanğıc ----------
  function start() {
    fetch('data.json').then(function (r) { return r.json(); }).then(function (d) {
      boot(d);
      loadSheet().then(function (live) { boot(live); }).catch(function () { /* cədvəl əlçatmazdır: ehtiyat məlumat qalır */ });
    }).catch(function () {
      loadSheet().then(boot).catch(function () { $('mon').innerHTML = '<p class="def">Lüğət yüklənmədi. Səhifəni yenilə.</p>'; });
    });
  }
  start();
})();
