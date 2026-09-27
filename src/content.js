// Runs on the purchase-history page. Walks pagination, loads each receipt in a
// hidden same-origin iframe (N in parallel), parses it and saves it immediately.
const msg = m => new Promise(r => chrome.runtime.sendMessage(m, r));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HIST = 'https://www.lidl.de/mre/purchase-history?client_id=GermanyEcommerceClient&country_code=de&language=de-DE&page=1';
const CARD = 'a[href*="purchase-detail"]';
const MON = { januar: 1, februar: 2, 'märz': 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const eu = d => pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
const safe = s => String(s || '').replace(/[\\/:*?"<>| ]+/g, '_').replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const num = s => (s ? parseFloat(s.replace(',', '.')) : 0);
const de = n => n.toFixed(2).replace('.', ',');
const csvq = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';

async function waitFor(root, sel, ms) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const e = root().querySelector(sel);
    if (e) return e;
    await sleep(250);
  }
  return null;
}

// "16.09.2026" / "16.9.26" -> "2026-09-16"
function parseEU(s) {
  s = s.trim();
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return y + '-' + pad(m[2]) + '-' + pad(m[1]);
}

// ---------- UI ----------
const CSS = `
#lx-fab{position:fixed;bottom:20px;right:20px;z-index:999999;width:64px;height:64px;border:0;padding:0;background:none;cursor:pointer;filter:drop-shadow(0 4px 10px #0005);transition:transform .15s}
#lx-fab:hover{transform:scale(1.08)}
#lx-fab img{width:100%;height:100%;display:block}
#lx-fab span{position:absolute;top:-8px;left:-12px;background:#e60a14;color:#fff;font:bold 12px system-ui,sans-serif;padding:2px 7px;border-radius:10px;display:none}
#lx{display:none;max-height:calc(100vh - 40px);overflow-y:auto;position:fixed;bottom:20px;right:20px;z-index:999999;width:400px;background:#fff;color:#1e2124;font:15px/1.4 system-ui,sans-serif;border-radius:16px;box-shadow:0 4px 24px #0004;overflow:hidden}
#lx.open{display:block}
#lx h2{position:relative;overflow:hidden;margin:0;padding:0 12px;height:68px;background:#0050aa;color:#fff;font-size:18px;display:flex;align-items:center}
#lx h2 .ttl{display:flex;flex-direction:column;line-height:1.15}
#lx h2 small{font-size:12px;font-weight:normal;opacity:.85}
#lx h2 .mark{width:46px;height:48px;margin-right:10px;filter:drop-shadow(0 1px 2px #0004)}
#lx h2 .x{position:absolute;right:6px;top:6px;width:34px;height:34px;border:0;border-radius:6px 10px 6px 6px;background:#ffffff26;color:#fff;font-size:22px;line-height:1;font-weight:bold;cursor:pointer;padding:0}
#lx h2 .x:hover{background:#ffffff4d}
#lx .b{padding:14px 16px}
#lx label{display:block;font-size:13px;color:#555;margin-bottom:4px}
#lx .row{display:flex;gap:10px;margin-bottom:10px;align-items:end}
#lx .row>div{flex:1}
#lx input{width:100%;box-sizing:border-box;font-size:16px;padding:8px 10px;border:1px solid #bbb;border-radius:6px}
#lx .pre{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
#lx .pre button{font-size:13px;padding:4px 10px;border:1px solid #0050aa;background:#fff;color:#0050aa;border-radius:14px;cursor:pointer}
#lx .act{display:flex;gap:8px}
#lx .act button{flex:1 1 auto;white-space:nowrap;font-size:16px;padding:10px 14px;border:0;border-radius:6px;cursor:pointer}
#lx #lx-start{background:#0050aa;color:#fff}
#lx #lx-stop,#lx #lx-open{background:#eee}
#lx .bar{height:10px;background:#eee;border-radius:5px;margin:14px 0 8px;overflow:hidden}
#lx .bar div{height:100%;width:0;background:#2a9d4a;transition:width .3s}
#lx .st{font-size:14px}
#lx .st b{display:inline-block;min-width:80px}
#lx .log{margin-top:10px;height:140px;overflow:auto;background:#f5f5f5 var(--lx-logo) no-repeat center/280px;border-radius:6px;padding:6px 8px;font:12px/1.4 monospace;white-space:pre-wrap}
#lx .err{color:#c00}
`;
let E = {};
function ui() {
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const b = document.createElement('div');
  b.id = 'lx';
  b.innerHTML = `<h2><img class="mark" id="lx-mark" alt=""><span class="ttl">Kassensturz<small>Kassenbon-Export für Lidl Plus</small></span><button class="x" id="lx-close" title="Minimieren">–</button></h2><div class="b">
    <div class="row"><div><label>Von (TT.MM.JJJJ)</label><input id="lx-from" placeholder="leer = alle"></div>
    <div><label>Bis (TT.MM.JJJJ)</label><input id="lx-to" placeholder="leer = heute"></div>
    <div style="flex:0 0 70px"><label>Parallel</label><input id="lx-conc" type="number" value="3" min="1" max="8"></div></div>
    <div class="pre"><button data-p="m0">Dieser Monat</button><button data-p="m1">Letzter Monat</button><button data-p="d30">30 Tage</button><button data-p="y0">Dieses Jahr</button><button data-p="y1">Letztes Jahr</button><button data-p="all">Alles</button></div>
    <div class="act"><button id="lx-start">Start</button><button id="lx-stop">Stop</button><button id="lx-open">Ordner öffnen</button></div>
    <div class="bar"><div id="lx-bar"></div></div>
    <div class="st"><div><b>Liste</b> <span id="lx-list">–</span></div><div><b>Bons</b> <span id="lx-prog">–</span></div><div><b>Ordner</b> <span id="lx-dir">–</span></div></div>
    <div class="log" id="lx-log"></div></div>`;
  b.style.setProperty('--lx-logo', 'url("' + chrome.runtime.getURL('logo-watermark.svg') + '")');
  b.querySelector('#lx-mark').src = chrome.runtime.getURL('receipt-mark.svg');
  document.body.appendChild(b);
  const fab = document.createElement('button');
  fab.id = 'lx-fab';
  fab.title = 'Kassensturz – Kassenbons exportieren';
  fab.innerHTML = '<img alt=""><span></span>';
  fab.querySelector('img').src = chrome.runtime.getURL('icon.svg');
  document.body.appendChild(fab);
  E.panel = b; E.fab = fab; E.badge = fab.querySelector('span');
  const toggle = open => {
    b.classList.toggle('open', open);
    fab.style.display = open ? 'none' : '';
    try { sessionStorage.setItem('lx-open', open ? '1' : ''); } catch (e) {}
  };
  fab.onclick = () => toggle(true);
  b.querySelector('#lx-close').onclick = () => toggle(false);
  let wasOpen = '';
  try { wasOpen = sessionStorage.getItem('lx-open'); } catch (e) {}
  toggle(!!wasOpen);
  for (const id of ['from', 'to', 'conc', 'start', 'stop', 'open', 'bar', 'list', 'prog', 'dir', 'log']) E[id] = b.querySelector('#lx-' + id);
  b.querySelectorAll('.pre button').forEach(x => x.onclick = () => preset(x.dataset.p));
  E.start.onclick = start;
  E.open.onclick = () => lastDl ? msg({ t: 'show', id: lastDl }) : log('Noch nichts gespeichert', true);
  E.stop.onclick = () => { stopFlag = true; log('Stop gedrückt'); };
}
function preset(p) {
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const r = {
    m0: [new Date(y, m, 1), n],
    m1: [new Date(y, m - 1, 1), new Date(y, m, 0)],
    d30: [new Date(n - 30 * 864e5), n],
    y0: [new Date(y, 0, 1), n],
    y1: [new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)],
    all: null,
  }[p];
  E.from.value = r ? eu(r[0]) : '';
  E.to.value = r ? eu(r[1]) : '';
}
function log(s, err) {
  console.log('[Kassensturz]', s);
  const d = document.createElement('div');
  if (err) d.className = 'err';
  d.textContent = new Date().toTimeString().slice(0, 8) + ' ' + s;
  E.log.appendChild(d);
  E.log.scrollTop = 1e9;
}

// ---------- state ----------
let stopFlag = false, running = false;
let S; // run state
let lastDl = null; // any saved download id, used to open the folder

function show() {
  E.list.textContent = S.listDone ? 'fertig · ' + S.found + ' Bons im Zeitraum' : 'Seite ' + S.page + ' · ' + S.found + ' gefunden…';
  E.prog.textContent = S.done + ' / ' + S.found + ' gespeichert · ' + S.active + ' laden' + (S.err ? ' · ' + S.err + ' Fehler' : '');
  E.bar.style.width = (S.found ? 100 * S.done / S.found : 0) + '%';
  E.badge.textContent = S.done + '/' + S.found;
  E.badge.style.display = running && S.found ? 'block' : 'none';
}

async function save(name, content, type, dataUrl) {
  const r = await msg({ t: 'save', folder: S.folder, name, content, type, dataUrl });
  if (r && r.ok) lastDl = r.id;
  if (!r || !r.ok) log('Speichern fehlgeschlagen: ' + name + ' – ' + (r ? r.err : 'keine Antwort vom Hintergrund'), true);
  return r && r.ok;
}

async function start() {
  if (running) return log('Läuft schon');
  const from = parseEU(E.from.value), to = parseEU(E.to.value);
  if (from === null || to === null) return log('Datum ungültig, Format TT.MM.JJJJ', true);
  const conc = Math.max(1, Math.min(8, +E.conc.value || 3));
  // list is newest first: must start at page 1, else newer receipts are skipped
  const u = new URL(location.pathname.includes('purchase-history') ? location.href : HIST);
  if (location.href !== u.href || u.searchParams.get('page') !== '1') {
    sessionStorage.setItem('lx-auto', JSON.stringify({ from: E.from.value, to: E.to.value, conc }));
    u.searchParams.set('page', '1');
    log('Springe zu Seite 1…');
    return (location.href = u.href);
  }
  const n = new Date();
  S = { folder: 'lidl-bons-' + iso(n) + '_' + pad(n.getHours()) + pad(n.getMinutes()), queue: [], results: [], found: 0, done: 0, err: 0, active: 0, page: 1, listDone: false };
  running = true; stopFlag = false;
  E.dir.textContent = 'Downloads/' + S.folder;
  log('Start · Zeitraum ' + (from || 'Anfang') + ' bis ' + (to || 'heute') + ' · ' + conc + ' parallel');
  const workers = [...Array(conc)].map((_, i) => worker(i));
  await collectList(from, to);
  await Promise.all(workers);
  if (S.results.length) {
    log('Schreibe Sammeldateien…');
    await writeSummary();
  }
  log(stopFlag ? 'Abgebrochen. ' + S.done + ' gespeichert.' : 'Fertig. ' + S.done + ' gespeichert, ' + S.err + ' Fehler.');
  running = false;
  show();
}

function cardIds() {
  return [...document.querySelectorAll(CARD)].map(a => new URL(a.href).searchParams.get('t'));
}

async function collectList(from, to) {
  const seen = new Set();
  const n = new Date();
  let year = n.getFullYear(), month = n.getMonth() + 1;
  for (S.page = 1; !stopFlag; S.page++) {
    show();
    if (!(await waitFor(() => document, CARD, 15000))) { log('Keine Bons auf Seite ' + S.page, true); break; }
    await sleep(600);
    const before = cardIds();
    let older = false, added = 0;
    for (const el of document.querySelectorAll('[data-testid="purchase-history-group-date"], ' + CARD)) {
      if (el.matches('[data-testid="purchase-history-group-date"]')) {
        const m = el.textContent.trim().toLowerCase().match(/(\S+)\s+(\d{4})/);
        if (m && MON[m[1]]) { month = MON[m[1]]; year = +m[2]; }
        continue;
      }
      const id = new URL(el.href).searchParams.get('t');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const q = t => (el.querySelector('[data-testid="' + t + '"]')?.textContent || '').replace(/ /g, ' ').trim();
      const date = year + '-' + pad(month) + '-' + pad(parseInt(q('purchase-history-row-date')) || 1);
      if (to && date > to) continue;
      if (from && date < from) { older = true; continue; }
      S.queue.push({ id, href: el.href, date, store: q('purchase-history-row-store'), amount: q('primary-amount') });
      S.found++; added++;
    }
    log('Seite ' + S.page + ': ' + before.length + ' Bons, ' + added + ' im Zeitraum');
    if (older) { log('Älter als Von-Datum erreicht, Liste stoppt'); break; }
    const next = [...document.querySelectorAll('[data-testid="pagination"] button')].pop();
    if (!next || next.disabled || next.className.includes('cursor-not-allowed')) { log('Letzte Seite'); break; }
    next.click();
    let changed = false;
    for (let i = 0; i < 80 && !changed; i++) {
      await sleep(250);
      const c = cardIds();
      changed = c.length > 0 && c[0] !== before[0];
    }
    if (!changed) { log('Nächste Seite lädt nicht, Liste stoppt', true); break; }
  }
  S.listDone = true;
  show();
}

// each worker owns one hidden iframe and pulls from the queue
async function worker(i) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-5000px;top:0;width:1100px;height:900px;border:0';
  document.body.appendChild(f);
  while (!stopFlag) {
    const it = S.queue.shift();
    if (!it) {
      if (S.listDone) break;
      await sleep(300);
      continue;
    }
    S.active++; show();
    let r = null;
    for (let tries = 0; tries < 2 && !r && !stopFlag; tries++) {
      const res = await loadInFrame(f, it, 60000);
      if (res && res.data) r = res;
      else log((res ? 'Fehler ' + res.error : 'Timeout') + ' · ' + it.date + ' ' + it.store + (tries ? '' : ', neuer Versuch'), true);
    }
    S.active--;
    if (r) {
      const pdf = r.pdf, res_pdfErr = r.pdfErr;
      r = r.data;
      r.store = it.store || r.store;
      r.date = r.date || it.date;
      if (!r.total) r.total = it.amount.replace(/\s*€/, '');
      S.results.push(r);
      const base = safe(r.date + '_' + r.time.replace(':', '') + '_' + r.store + '_' + r.total + 'EUR');
      let ok = await save('json/' + base + '.json', JSON.stringify(r, null, 1), 'application/json');
      if (pdf) ok = (await save('pdf/' + base + '.pdf', null, 'application/pdf', pdf)) && ok;
      else log('Kein PDF für ' + base + ': ' + (res_pdfErr || '?'), true);
      if (ok) { S.done++; log('✓ ' + r.date + ' ' + r.time + ' · ' + r.store + ' · ' + r.total + ' € · ' + r.items.length + ' Artikel'); }
      else S.err++;
    } else if (!stopFlag) S.err++;
    show();
  }
  f.remove();
}

// iframe content script posts {lx, id, data, pdf} or {lx, id, error}
function loadInFrame(f, it, ms) {
  return new Promise(res => {
    const done = v => { clearTimeout(tm); removeEventListener('message', on); res(v); };
    const on = e => { if (e.source === f.contentWindow && e.data && e.data.lx && e.data.id === it.id) done(e.data); };
    const tm = setTimeout(() => done(null), ms);
    addEventListener('message', on);
    f.src = it.href;
  });
}

async function writeSummary() {
  const rs = S.results.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const rows = [['receipt_id', 'date', 'time', 'store', 'receipt_total', 'payment', 'art_id', 'name', 'qty', 'unit_price', 'price', 'discount', 'net_price', 'tax', 'discount_names']];
  for (const r of rs) for (const i of r.items) {
    const disc = i.discounts.reduce((s, d) => s + num(d.amount), 0);
    rows.push([r.id, r.date, r.time, r.store, r.total, r.payment, i.art_id, i.name, i.qty, i.unit_price, i.price, de(disc), de(num(i.price) + disc), i.tax, i.discounts.map(d => d.name).join(' | ')]);
  }
  await save('_alle-artikel.csv', '﻿' + rows.map(r => r.map(csvq).join(';')).join('\n'), 'text/csv');
  await save('_alle.json', JSON.stringify(rs, null, 1), 'application/json');
}

// ---------- parsing ----------
function parse(pre, it, doc) {
  it.amount = it.amount || '';
  const lines = new Map();
  for (const s of pre.querySelectorAll('.purchase_list span[id]')) {
    if (!lines.has(s.id)) lines.set(s.id, []);
    lines.get(s.id).push(s);
  }
  const items = [];
  let cur = null;
  for (const sp of lines.values()) {
    const txt = sp.map(s => s.textContent).join('').replace(/ /g, ' ');
    const d = sp[0].dataset;
    const amt = (txt.match(/(-?\d+,\d\d)\s*[A-Z]?\s*$/) || [])[1];
    if (sp[0].classList.contains('article')) {
      if (d.artDescription && txt.trim().startsWith(d.artDescription)) {
        cur = { art_id: d.artId, name: d.artDescription, qty: d.artQuantity || '1', unit_price: d.unitPrice, tax: d.taxType, price: amt, discounts: [] };
        items.push(cur);
      } else if (cur && !d.artQuantity) {
        const m = txt.match(/^\s*(\d+)\s*(Stk\.?)?\s*x/);
        if (m) cur.qty = m[1];
      }
    } else if (cur && amt && amt.startsWith('-')) {
      cur.discounts.push({ name: txt.replace(amt, '').trim(), amount: amt });
    }
  }
  const text = pre.textContent;
  const dm = text.match(/(\d{2})\.(\d{2})\.(\d{2})\s+(\d{2}:\d{2})\s*$/m);
  const vat = {};
  for (const s of pre.querySelectorAll('.vat_info span[data-tax-type]')) {
    const d = s.dataset;
    vat[d.taxType] = { type: d.taxType, percent: d.taxPercentage, gross: d.taxBaseAmount, tax: d.taxAmount };
  }
  return {
    id: it.id,
    date: dm ? '20' + dm[3] + '-' + dm[2] + '-' + dm[1] : it.date,
    time: dm ? dm[4] : '',
    store: it.store,
    total: (text.match(/Zu zahlen\s+(-?\d+,\d\d)/) || [])[1] || it.amount.replace(/\s*€/, ''),
    payment: pre.querySelector('[data-tender-description]')?.dataset.tenderDescription || '',
    items,
    vat: Object.values(vat),
    coupons: [...doc.querySelectorAll('[data-testid="coupons"] [class*="_item_"]')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    text,
  };
}

// ---------- frame mode: render receipt as PDF, parse, report to parent ----------
async function frameWorker() {
  const id = new URLSearchParams(location.search).get('t');
  const reply = o => parent.postMessage({ lx: true, id, ...o }, location.origin);
  try {
    const pre = await waitFor(() => document, '[data-testid="ticket-' + id + '"] pre', 40000);
    if (!pre) return reply({ error: 'Bon lädt nicht' });
    await waitFor(() => document, '[data-testid="ticket-' + id + '"] canvas', 4000); // barcode
    await sleep(800); // fade-in animation, fonts
    const data = parse(pre, { id, date: '', store: '', amount: '' }, document);
    data.store = document.querySelector('[data-testid="store"] [class*="_title_"]')?.textContent.trim() || '';
    let pdf = null, pdfErr = '';
    try { pdf = renderPdf(pre, id); } catch (e) { pdfErr = String(e && e.message || e); console.error('[Kassensturz] PDF', e); }
    reply({ data, pdf, pdfErr });
  } catch (e) {
    reply({ error: String(e && e.message || e) });
  }
}

// Vector PDF drawn from the receipt DOM: monospace lines with real bold/colour,
// logo and barcode as images. Text stays selectable.
function renderPdf(pre, id) {
  const ticket = document.querySelector('[data-testid="ticket-' + id + '"]');
  const FS = 8.5, LH = FS * 1.3, CW = FS * 0.6, M = 20;
  const rgb = c => (c.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number);

  // lines of {t, bold, color} segments
  const lines = [[]];
  const tw = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode());) {
    const cs = getComputedStyle(n.parentElement);
    const seg = { bold: parseInt(cs.fontWeight) >= 600, color: rgb(cs.color) };
    n.data.split('\n').forEach((part, i) => {
      if (i) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: part.replace(/\u00a0/g, ' '), ...seg });
    });
  }
  while (lines.length && !lines[0].some(s => s.t.trim())) lines.shift();
  while (lines.length && !lines[lines.length - 1].some(s => s.t.trim())) lines.pop();

  const cols = Math.max(42, ...lines.map(l => l.reduce((n, s) => n + s.t.length, 0)));
  const W = cols * CW + 2 * M, inner = W - 2 * M;

  const toPng = src => {
    const c = document.createElement('canvas');
    c.width = src.naturalWidth || src.width; c.height = src.naturalHeight || src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c.toDataURL('image/png');
  };
  const logoEl = ticket.querySelector('img[alt="logo"]');
  const logo = logoEl && logoEl.naturalWidth ? { url: toPng(logoEl), w: 100, h: 100 * logoEl.naturalHeight / logoEl.naturalWidth } : null;
  const bcEl = ticket.querySelector('canvas');
  const bc = bcEl && bcEl.width ? { url: bcEl.toDataURL('image/png'), w: inner, h: inner * bcEl.height / bcEl.width } : null;
  const foot = [...ticket.querySelectorAll('[data-testid^="marketing"]')].flatMap(p => p.innerText.split('\n')).map(s => s.trim()).filter(Boolean);

  const H = M + 18 + (logo ? logo.h + 14 : 0) + lines.length * LH + (bc ? bc.h + 16 : 0) + foot.length * 12 + M;
  const doc = new jspdf.jsPDF({ unit: 'pt', format: [W, H], orientation: H > W ? 'p' : 'l' });
  let y = M + 12;
  doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(0, 0, 0);
  doc.text('Bonkopie', W / 2, y, { align: 'center' });
  y += 6;
  if (logo) { y += 8; doc.addImage(logo.url, 'PNG', (W - logo.w) / 2, y, logo.w, logo.h); y += logo.h; }
  y += 14;
  doc.setFontSize(FS);
  for (const l of lines) {
    let x = M;
    for (const s of l) {
      doc.setFont('courier', s.bold ? 'bold' : 'normal').setTextColor(...s.color);
      doc.text(s.t, x, y);
      x += s.t.length * CW;
    }
    y += LH;
  }
  if (bc) { y += 6; doc.addImage(bc.url, 'PNG', M, y, bc.w, bc.h); y += bc.h + 10; }
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(0, 0, 0);
  for (const f of foot) { y += 12; doc.text(f, W / 2, y, { align: 'center' }); }
  return doc.output('datauristring');
}

if (window.top !== window) {
  if (location.pathname.includes('purchase-detail')) frameWorker();
} else {
  ui();
  const a = sessionStorage.getItem('lx-auto');
  if (a) {
    sessionStorage.removeItem('lx-auto');
    E.fab.click();
    const o = JSON.parse(a);
    E.from.value = o.from; E.to.value = o.to; E.conc.value = o.conc;
    start();
  }
}
