/* ============================================================
   CATATAN KEUANGAN — app.js
   Frontend PWA: input cepat, dashboard, grafik, riwayat,
   edit/hapus, antrean offline, sinkron ke Google Sheets.
   ============================================================ */
'use strict';

/* ---------------- Penyimpanan lokal ---------------- */
const LS = { conn: 'kk.conn', cache: 'kk.cache', queue: 'kk.queue', prefs: 'kk.prefs' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* penuh / privat */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* abaikan */ } },
};

/* ---------------- State ---------------- */
const cache = store.get(LS.cache, {});
const prefs = store.get(LS.prefs, {});
const state = {
  conn: store.get(LS.conn, null),           // { url, key, name, sheetUrl }
  tx: cache.tx || [],                        // data dari server
  categories: cache.categories || { in: [], out: [] },
  sheetUrl: cache.sheetUrl || '',
  lastSync: cache.lastSync || 0,
  loaded: !!cache.lastSync,
  queue: store.get(LS.queue, []),            // operasi yang belum terkirim
  inflight: null,
  syncing: 0,
  syncError: null,
  seq: 0,
  view: 'home',
  period: prefs.period || 'month',
  custom: prefs.custom || null,
  hist: { q: '', type: 'all', cat: '', from: '', to: '', limit: 60 },
  form: { mode: 'add', type: 'out', category: '', editing: null },
  detail: null,
};
if (state.period === 'custom' && !state.custom) state.period = 'month';

/* ---------------- Helper DOM & format ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
const rp = (n) => (n < 0 ? '−' : '') + 'Rp ' + nf.format(Math.abs(Math.round(n || 0)));
const rpSigned = (t) => (t.type === 'in' ? '+' : '−') + rp(t.amount);
function rpCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e9) return nf1.format(n / 1e9) + ' M';
  if (a >= 1e6) return nf1.format(n / 1e6) + ' jt';
  if (a >= 1e3) return nf1.format(n / 1e3) + ' rb';
  return nf.format(n);
}
const pct = (n) => nf1.format(n) + '%';

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const todayD = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 86400000);
const DF = {
  long: new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  day: new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }),
  short: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }),
  shortY: new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
  month: new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' }),
  mon: new Intl.DateTimeFormat('id-ID', { month: 'short' }),
  monY: new Intl.DateTimeFormat('id-ID', { month: 'short', year: '2-digit' }),
  time: new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' }),
};
function dayLabel(isoStr) {
  const t = iso(todayD());
  if (isoStr === t) return 'Hari ini';
  if (isoStr === iso(addDays(todayD(), -1))) return 'Kemarin';
  return DF.day.format(parseISO(isoStr));
}
const newId = () => 'tx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8).padEnd(6, '0');

/* ---------------- Ikon kategori ---------------- */
const UNCAT = 'Belum dikategorikan';
const EMOJI = [
  [/belum dikategorikan/i, '🏷️'],
  [/makan|minum|kuliner|kopi|resto|jajan|food/i, '🍜'], [/transport|bensin|ojek|parkir|tol|bbm|grab|gojek/i, '🛵'],
  [/belanja|shopping|groceries/i, '🛍️'], [/tagihan|listrik|pln|pdam|\bair\b/i, '🧾'], [/pulsa|internet|wifi|kuota/i, '📶'],
  [/hiburan|nonton|game|film|langganan|streaming/i, '🎬'], [/kesehatan|obat|dokter|klinik|bpjs/i, '💊'],
  [/pendidikan|kursus|buku|sekolah|kuliah/i, '📚'], [/rumah|tangga|dapur|sewa|kos/i, '🏠'],
  [/sedekah|donasi|zakat|infa/i, '🤲'], [/gaji|salary/i, '💼'], [/bonus|thr/i, '🎉'],
  [/freelance|usaha|bisnis|jualan|proyek/i, '💡'], [/investasi|dividen|saham|bunga|reksa/i, '📈'],
  [/hadiah|kado|angpao/i, '🎁'], [/cicilan|utang|hutang|kredit|pinjam/i, '💳'], [/tabung|saving/i, '🐷'],
  [/pakaian|baju|fashion/i, '👕'], [/olahraga|gym|fitness/i, '🏋️'], [/hewan|kucing|anjing|pet/i, '🐾'],
  [/anak|bayi/i, '🧸'], [/liburan|travel|wisata|hotel/i, '✈️'], [/asuransi/i, '🛡️'], [/pajak/i, '🏛️'],
  [/kecantikan|salon|skincare/i, '💄'], [/lainnya|lain/i, '✨'],
];
function catEmoji(name, type) {
  for (const [re, e] of EMOJI) if (re.test(name || '')) return e;
  return type === 'in' ? '💰' : '📦';
}

/* ============================================================
   API
   ============================================================ */
function apiError(msg, code) { const e = new Error(msg); e.code = code; return e; }

async function api(action, payload = {}, conn = state.conn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch(conn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // hindari preflight CORS
      body: JSON.stringify(Object.assign({ action, key: conn.key }, payload)),
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } catch (e) {
    throw apiError(navigator.onLine ? 'Tidak bisa terhubung ke server.' : 'Tidak ada koneksi internet.', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
  let data;
  try { data = await res.json(); } catch (e) {
    throw apiError('Respons server tidak valid. Cek URL Web App dan izin akses "Siapa saja".', 'BAD_RESPONSE');
  }
  if (!data.ok) throw apiError(data.error || 'Terjadi kesalahan di server.', data.code || 'SERVER');
  return data.data;
}
const RETRYABLE = ['NETWORK', 'BUSY', 'BAD_RESPONSE'];

/* ============================================================
   DATA: gabungan data server + antrean lokal
   ============================================================ */
function saveCache() {
  store.set(LS.cache, { tx: state.tx, categories: state.categories, sheetUrl: state.sheetUrl, lastSync: state.lastSync });
}
function saveQueue() { store.set(LS.queue, state.queue); }

let _visibleMemo = null;
function invalidate() { _visibleMemo = null; }
function visibleTx() {
  if (_visibleMemo) return _visibleMemo;
  const map = new Map(state.tx.map((t) => [t.id, t]));
  for (const op of state.queue) {
    if (op.op === 'delete') map.delete(op.id);
    else map.set(op.tx.id, Object.assign({}, op.tx, { pending: true }));
  }
  _visibleMemo = Array.from(map.values()).sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.created || '').localeCompare(a.created || ''));
  return _visibleMemo;
}

function enqueue(op) {
  const q = state.queue;
  const id = op.op === 'delete' ? op.id : op.tx.id;
  const idx = q.findIndex((o) => o !== state.inflight && (o.op === 'delete' ? o.id : o.tx.id) === id);
  if (idx > -1) {
    const prev = q[idx];
    if (op.op === 'update' && (prev.op === 'add' || prev.op === 'update')) {
      prev.tx = op.tx; // gabungkan edit ke operasi yang belum terkirim
      saveQueue(); invalidate(); return;
    }
    if (op.op === 'delete' && prev.op === 'add') {
      q.splice(idx, 1); // belum pernah sampai server → cukup batalkan
      saveQueue(); invalidate(); toast('success', 'Transaksi dihapus'); return;
    }
    if (op.op === 'delete' && prev.op === 'update') q.splice(idx, 1);
  }
  op.attempts = 0;
  q.push(op);
  saveQueue(); invalidate();
}

function applyToBase(op, result) {
  if (op.op === 'delete') state.tx = state.tx.filter((t) => t.id !== op.id);
  else {
    const t = Object.assign({}, op.tx, result || {}, { created: op.tx.created });
    delete t.pending;
    const i = state.tx.findIndex((x) => x.id === t.id);
    if (i > -1) state.tx[i] = t; else state.tx.push(t);
  }
  state.seq++;
  saveCache();
}

const OP_MSG = { add: 'Tersimpan ke spreadsheet', update: 'Perubahan disimpan', delete: 'Transaksi dihapus' };
let flushing = null;
function flushQueue() {
  if (flushing) return flushing;
  if (!state.conn || !state.queue.length) return Promise.resolve(false);
  flushing = (async () => {
    state.syncing++; updateSyncUI();
    let changed = false;
    try {
      while (state.queue.length) {
        const op = state.queue[0];
        state.inflight = op;
        try {
          const payload = op.op === 'delete' ? { id: op.id } : { tx: stripTx(op.tx) };
          const result = await api(op.op, payload);
          applyToBase(op, op.op === 'delete' ? null : result);
          state.queue.splice(state.queue.indexOf(op), 1);
          saveQueue(); invalidate(); changed = true;
          state.syncError = null;
          toast('success', OP_MSG[op.op]);
        } catch (e) {
          if (RETRYABLE.includes(e.code)) {
            if (!op.attempts) toast('warn', 'Belum terkirim — disimpan di HP & dikirim otomatis saat online');
            op.attempts = (op.attempts || 0) + 1; saveQueue();
            state.syncError = e;
            break;
          }
          if (e.code === 'AUTH') { state.syncError = e; handleAuthFail(); break; }
          // Ditolak server (validasi / tidak ditemukan): buang operasi ini.
          state.queue.splice(state.queue.indexOf(op), 1);
          saveQueue(); invalidate(); changed = true;
          toast('error', 'Gagal: ' + e.message);
        }
      }
    } finally {
      state.inflight = null;
      state.syncing--;
      flushing = null;
      updateSyncUI();
      if (changed) render();
    }
    return changed;
  })();
  return flushing;
}
function stripTx(t) {
  return { id: t.id, type: t.type, date: t.date, category: t.category, amount: t.amount, note: t.note || '' };
}

async function refresh(opts = {}) {
  if (!state.conn) return;
  state.syncing++; updateSyncUI();
  try {
    await flushQueue();
    for (let attempt = 0; attempt < 2; attempt++) {
      const seq = state.seq;
      const data = await api('list');
      if (seq !== state.seq) continue; // ada perubahan saat memuat → muat ulang
      state.tx = data.transactions || [];
      state.categories = data.categories || state.categories;
      state.sheetUrl = data.spreadsheetUrl || state.sheetUrl;
      state.lastSync = Date.now();
      state.loaded = true;
      state.syncError = null;
      saveCache(); invalidate();
      break;
    }
    if (opts.toast) toast('success', 'Data terbaru dimuat');
  } catch (e) {
    state.syncError = e;
    if (e.code === 'AUTH') handleAuthFail();
    else if (!opts.silent) toast(RETRYABLE.includes(e.code) ? 'warn' : 'error', e.message + (state.loaded ? ' Menampilkan data tersimpan.' : ''));
  } finally {
    state.syncing--;
    updateSyncUI();
    render();
  }
}

function handleAuthFail() {
  toast('error', 'Kunci akses tidak berlaku. Silakan hubungkan ulang.');
  showOnboarding(state.conn);
}

/* ============================================================
   PERIODE & PERHITUNGAN
   ============================================================ */
function getRange(period = state.period) {
  const t = todayD();
  let from, to, prevFrom, prevTo, prevLabel, label;
  if (period === 'today') {
    from = to = t; prevFrom = prevTo = addDays(t, -1); prevLabel = 'kemarin';
    label = DF.long.format(t);
  } else if (period === 'week') {
    from = addDays(t, -((t.getDay() + 6) % 7)); to = addDays(from, 6);
    prevFrom = addDays(from, -7); prevTo = addDays(prevFrom, daysBetween(iso(from), iso(t)));
    prevLabel = 'minggu lalu';
    label = `${DF.short.format(from)} – ${DF.shortY.format(to)}`;
  } else if (period === 'custom' && state.custom) {
    from = parseISO(state.custom.from); to = parseISO(state.custom.to);
    const len = daysBetween(iso(from), iso(to)) + 1;
    prevTo = addDays(from, -1); prevFrom = addDays(from, -len); prevLabel = 'periode sebelumnya';
    label = `${DF.shortY.format(from)} – ${DF.shortY.format(to)}`;
  } else {
    from = new Date(t.getFullYear(), t.getMonth(), 1); to = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    const prevLast = new Date(t.getFullYear(), t.getMonth(), 0).getDate();
    prevFrom = new Date(t.getFullYear(), t.getMonth() - 1, 1);
    prevTo = new Date(t.getFullYear(), t.getMonth() - 1, Math.min(t.getDate(), prevLast));
    prevLabel = 'bulan lalu';
    label = DF.month.format(from);
  }
  // Bagian periode yang sudah berjalan (untuk rata-rata & perbandingan yang adil)
  let elapsedEnd = to > t ? t : to;
  if (elapsedEnd < from) elapsedEnd = from;
  return {
    from: iso(from), to: iso(to), cmpTo: iso(elapsedEnd),
    days: daysBetween(iso(from), iso(elapsedEnd)) + 1,
    prevFrom: iso(prevFrom), prevTo: iso(prevTo), prevLabel, label,
  };
}

function summarize(list, from, to) {
  const s = { in: 0, out: 0, net: 0, count: 0, byCat: new Map(), maxOut: null };
  for (const t of list) {
    if (!t.date || t.date < from || t.date > to) continue;
    s.count++;
    if (t.type === 'in') s.in += t.amount;
    else {
      s.out += t.amount;
      s.byCat.set(t.category, (s.byCat.get(t.category) || 0) + t.amount);
      if (!s.maxOut || t.amount > s.maxOut.amount) s.maxOut = t;
    }
  }
  s.net = s.in - s.out;
  return s;
}

function buildInsights(full) {
  const list = visibleTx();
  const r = getRange();
  const cur = summarize(list, r.from, r.to);
  const curCmp = summarize(list, r.from, r.cmpTo);
  const prev = summarize(list, r.prevFrom, r.prevTo);
  const items = [];

  const top = Array.from(cur.byCat.entries()).sort((a, b) => b[1] - a[1])[0];
  items.push(top
    ? { ico: catEmoji(top[0], 'out'), label: 'Pengeluaran terbesar', value: esc(top[0]), sub: `${rp(top[1])} · ${pct(top[1] / cur.out * 100)}` }
    : { ico: '🏷️', label: 'Pengeluaran terbesar', value: '—', sub: 'Belum ada pengeluaran' });

  items.push({ ico: '📅', label: 'Rata-rata harian', value: rp(curCmp.out / r.days), sub: `dari ${r.days} hari berjalan` });
  items.push(deltaItem(curCmp.out, prev.out, 'out', r.prevLabel));

  if (full) {
    items.push(deltaItem(curCmp.in, prev.in, 'in', r.prevLabel));
    items.push(cur.maxOut
      ? { ico: '🧾', label: 'Transaksi terbesar', value: rp(cur.maxOut.amount), sub: `${esc(cur.maxOut.category)} · ${dayLabel(cur.maxOut.date)}` }
      : { ico: '🧾', label: 'Transaksi terbesar', value: '—', sub: 'Belum ada pengeluaran' });
    const rate = cur.in > 0 ? (cur.net / cur.in) * 100 : null;
    items.push({
      ico: '🐷', label: 'Rasio tabungan',
      value: rate == null ? '—' : pct(rate),
      sub: rate == null ? 'Belum ada pemasukan' : (rate >= 0 ? 'pemasukan yang tersisa' : 'pengeluaran melebihi pemasukan'),
    });
  }
  return items;
}

function deltaItem(cur, prev, kind, prevLabel) {
  const label = (kind === 'out' ? 'Pengeluaran' : 'Pemasukan') + ' vs ' + prevLabel;
  const ico = kind === 'out' ? '⚖️' : '💹';
  if (!prev) {
    return { ico, label, value: cur ? 'Belum bisa dibandingkan' : '—', sub: `Belum ada data ${prevLabel}`, wide: true };
  }
  const p = ((cur - prev) / prev) * 100;
  let value;
  if (Math.abs(p) < 0.5) value = '<span class="delta">＝ Sama</span>';
  else {
    const up = p > 0;
    const good = kind === 'out' ? !up : up;
    const word = kind === 'out' ? (up ? 'lebih boros' : 'lebih hemat') : (up ? 'lebih tinggi' : 'lebih rendah');
    value = `<span class="delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${pct(Math.abs(p))}</span> ${word}`;
  }
  return { ico, label, value, sub: `${rp(cur)} vs ${rp(prev)} ${prevLabel} (periode setara)`, wide: true };
}

function renderInsights(el, items) {
  el.innerHTML = items.map((it, i) => `
    <div class="insight${it.wide ? ' wide' : ''}" style="animation-delay:${i * 40}ms">
      <div class="i-ico" aria-hidden="true">${it.ico}</div>
      <p class="i-label">${esc(it.label)}</p>
      <p class="i-value">${it.value}</p>
      <p class="i-sub">${it.sub}</p>
    </div>`).join('');
}

/* ============================================================
   RENDER
   ============================================================ */
function render() {
  renderPeriodUI();
  if (state.view === 'home') renderHome();
  else if (state.view === 'history') renderHistory();
  else if (state.view === 'stats') renderStats();
  else if (state.view === 'settings') renderSettings();
}

function renderPeriodUI() {
  $$('.period-bar .chip').forEach((c) => c.classList.toggle('active', c.dataset.period === state.period));
  const r = getRange();
  $$('[data-period-label]').forEach((el) => { el.textContent = r.label; });
}

function txRow(t, i = 0) {
  return `
    <button class="tx" data-id="${esc(t.id)}" style="animation-delay:${Math.min(i, 10) * 25}ms">
      <span class="tx-ico ${t.type}" aria-hidden="true">${catEmoji(t.category, t.type)}</span>
      <span class="tx-main">
        <span class="tx-cat" style="display:block">${esc(t.category)}${t.pending ? '<span class="tx-badge">tertunda</span>' : ''}</span>
        <span class="tx-note" style="display:block">${esc(t.note || dayLabel(t.date))}</span>
      </span>
      <span class="tx-amt ${t.type}">${rpSigned(t)}</span>
    </button>`;
}

function emptyState(art, title, text, cta) {
  return `<div class="empty"><div class="e-art" aria-hidden="true">${art}</div><h3>${title}</h3><p>${text}</p>${cta || ''}</div>`;
}

function renderHome() {
  const list = visibleTx();
  const r = getRange();
  const s = summarize(list, r.from, r.to);
  const card = $('.balance-card');
  card.classList.toggle('is-loading', !state.loaded && !list.length);
  animateNumber($('#sumNet'), s.net);
  $('#sumIn').textContent = rp(s.in);
  $('#sumOut').textContent = rp(s.out);
  renderInsights($('#insightsHome'), buildInsights(false));

  const uncat = list.filter((t) => t.category === UNCAT).length;
  const notice = $('#uncatNotice');
  notice.hidden = !uncat;
  if (uncat) notice.innerHTML = `<span aria-hidden="true">🏷️</span><span><b>${uncat} transaksi</b> belum dikategorikan</span><span class="n-go">Rapikan ›</span>`;

  const recent = $('#recentList');
  if (!state.loaded && !list.length) {
    recent.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
  } else if (!list.length) {
    recent.innerHTML = emptyState('🪙', 'Belum ada transaksi', 'Catat pemasukan atau pengeluaran pertamamu. Cuma butuh beberapa detik.',
      '<button class="btn btn-primary" data-action="add">+ Tambah transaksi</button>');
  } else {
    recent.innerHTML = list.slice(0, 6).map(txRow).join('');
  }
}

const _numAnim = new WeakMap();
function animateNumber(el, to) {
  const from = _numAnim.get(el) ?? to;
  _numAnim.set(el, to);
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = rp(to); return; }
  const start = performance.now(), dur = 500;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = rp(from + (to - from) * e);
    if (k < 1 && _numAnim.get(el) === to) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ---------------- Riwayat ---------------- */
function allCategories() {
  const set = new Set([...(state.categories.out || []), ...(state.categories.in || [])]);
  visibleTx().forEach((t) => set.add(t.category));
  return Array.from(set);
}

function renderHistory() {
  const h = state.hist;
  const sel = $('#catFilter');
  const cats = allCategories();
  const opts = '<option value="">Semua kategori</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if (sel.dataset.sig !== opts) { sel.innerHTML = opts; sel.dataset.sig = opts; }
  sel.value = cats.includes(h.cat) ? h.cat : '';
  $$('#typeFilter button').forEach((b) => b.classList.toggle('active', b.dataset.type === h.type));
  $('#searchInput').value !== h.q && ($('#searchInput').value = h.q);
  $('#fromFilter').value = h.from; $('#toFilter').value = h.to;

  const q = h.q.trim().toLowerCase();
  const qDigits = q.replace(/[^\d]/g, '');
  const rows = visibleTx().filter((t) => {
    if (h.type !== 'all' && t.type !== h.type) return false;
    if (h.cat && t.category !== h.cat) return false;
    if (h.from && t.date < h.from) return false;
    if (h.to && t.date > h.to) return false;
    if (q) {
      const hay = (t.category + ' ' + (t.note || '')).toLowerCase();
      const amtHit = qDigits && String(Math.round(t.amount)).includes(qDigits);
      if (!hay.includes(q) && !amtHit) return false;
    }
    return true;
  });

  const filtered = h.q || h.cat || h.from || h.to || h.type !== 'all';
  const sumIn = rows.reduce((a, t) => a + (t.type === 'in' ? t.amount : 0), 0);
  const sumOut = rows.reduce((a, t) => a + (t.type === 'out' ? t.amount : 0), 0);
  $('#historyMeta').textContent = rows.length
    ? `${nf.format(rows.length)} transaksi · masuk ${rp(sumIn)} · keluar ${rp(sumOut)}`
    : '';

  const el = $('#historyList');
  if (!state.loaded && !rows.length) {
    el.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    $('#loadMore').hidden = true; return;
  }
  if (!rows.length) {
    el.innerHTML = filtered
      ? emptyState('🔍', 'Tidak ada yang cocok', 'Coba ubah kata kunci atau filter.', '<button class="btn btn-ghost" data-action="reset-filter">Reset filter</button>')
      : emptyState('📒', 'Riwayat masih kosong', 'Transaksi yang kamu catat akan muncul di sini.', '<button class="btn btn-primary" data-action="add">+ Tambah transaksi</button>');
    $('#loadMore').hidden = true; return;
  }

  const shown = rows.slice(0, h.limit);
  const daySum = new Map();
  rows.forEach((t) => daySum.set(t.date, (daySum.get(t.date) || 0) + (t.type === 'in' ? t.amount : -t.amount)));
  let html = '', lastDate = null, i = 0;
  for (const t of shown) {
    if (t.date !== lastDate) {
      lastDate = t.date;
      const ds = daySum.get(t.date);
      html += `<div class="group-head"><span>${t.date ? dayLabel(t.date) : 'Tanpa tanggal'}</span><span class="g-sum">${ds >= 0 ? '+' : '−'}${rp(Math.abs(ds))}</span></div>`;
    }
    html += txRow(t, i++);
  }
  el.innerHTML = html;
  $('#loadMore').hidden = rows.length <= h.limit;
}

/* ---------------- Statistik ---------------- */
function renderStats() {
  const list = visibleTx();
  const r = getRange();
  const s = summarize(list, r.from, r.to);

  // 1) Pengeluaran per kategori — bar horizontal, satu warna, diurutkan
  $('#catTotal').textContent = s.out ? 'Total ' + rp(s.out) : '';
  const cats = Array.from(s.byCat.entries()).sort((a, b) => b[1] - a[1]);
  let rows = cats;
  if (cats.length > 8) {
    const rest = cats.slice(7).reduce((a, c) => a + c[1], 0);
    rows = cats.slice(0, 7).concat([['__other', rest]]);
  }
  const max = rows.length ? rows[0][1] : 0;
  $('#catChart').innerHTML = rows.length ? `<div class="cat-bars">${rows.map(([name, val], i) => {
    const other = name === '__other';
    const label = other ? `${cats.length - 7} kategori lain` : name;
    return `<button class="cat-row" ${other ? '' : `data-cat="${esc(name)}"`} style="text-align:left;width:100%">
      <span class="c-ico" aria-hidden="true">${other ? '⋯' : catEmoji(name, 'out')}</span>
      <span>
        <span class="c-top"><span class="c-name">${esc(label)}</span><span class="c-val">${rp(val)}<small>${pct(val / s.out * 100)}</small></span></span>
        <span class="c-track" style="display:block"><span class="c-fill" style="display:block;width:${Math.max(2, val / max * 100)}%;animation-delay:${i * 50}ms"></span></span>
      </span>
    </button>`;
  }).join('')}</div>` : '<p class="chart-empty">Belum ada pengeluaran di periode ini.</p>';

  // 2) Tren harian (atau bulanan bila periode > 62 hari)
  renderTrend(list, r);

  // 3) Pemasukan vs pengeluaran 6 bulan
  renderMonthly(list);

  renderInsights($('#insightsStats'), buildInsights(true));
}

function renderTrend(list, r) {
  let from = r.from;
  const len = daysBetween(r.from, r.to) + 1;
  const monthly = len > 62;
  if (len < 7) from = iso(addDays(parseISO(r.to), -6));
  const labels = [], keys = [], values = [];
  if (monthly) {
    let d = parseISO(from); d = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = parseISO(r.to);
    while (d <= end) {
      keys.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
      labels.push(DF.monY.format(d)); d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }
  } else {
    for (let d = parseISO(from); iso(d) <= r.to; d = addDays(d, 1)) { keys.push(iso(d)); labels.push(String(d.getDate())); }
  }
  const idx = new Map(keys.map((k, i) => [k, i]));
  keys.forEach(() => values.push(0));
  for (const t of list) {
    if (t.type !== 'out' || !t.date || t.date < from || t.date > r.to) continue;
    const i = idx.get(monthly ? t.date.slice(0, 7) : t.date);
    if (i != null) values[i] += t.amount;
  }
  const total = values.reduce((a, b) => a + b, 0);
  const title = $('#dailyChart').closest('.card').querySelector('h2');
  title.textContent = monthly ? 'Tren pengeluaran bulanan' : 'Tren pengeluaran harian';
  const avg = monthly ? total / Math.max(1, keys.length) : summarize(list, r.from, r.cmpTo).out / r.days;
  $('#dailySub').textContent = total ? `Rata-rata ${rp(avg)}/${monthly ? 'bln' : 'hari'}` : '';

  if (!total) { $('#dailyChart').innerHTML = '<p class="chart-empty">Belum ada pengeluaran untuk ditampilkan.</p>'; return; }
  barChart($('#dailyChart'), {
    labels,
    series: [{ name: 'Pengeluaran', color: 'var(--c-bar)', values }],
    avg: len >= 7 || monthly ? avg : null,
    tipTitle: (i) => monthly ? DF.month.format(parseISO(keys[i] + '-01')) : DF.day.format(parseISO(keys[i])),
  });
}

function renderMonthly(list) {
  const t = todayD();
  const months = [];
  for (let k = 5; k >= 0; k--) months.push(new Date(t.getFullYear(), t.getMonth() - k, 1));
  const keys = months.map((d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`);
  const idx = new Map(keys.map((k, i) => [k, i]));
  const vin = keys.map(() => 0), vout = keys.map(() => 0);
  for (const x of list) {
    const i = x.date ? idx.get(x.date.slice(0, 7)) : null;
    if (i == null) continue;
    if (x.type === 'in') vin[i] += x.amount; else vout[i] += x.amount;
  }
  const any = vin.some(Boolean) || vout.some(Boolean);
  if (!any) {
    $('#monthChart').innerHTML = '<p class="chart-empty">Belum ada data 6 bulan terakhir.</p>';
    $('#monthTable').innerHTML = '';
    return;
  }
  barChart($('#monthChart'), {
    labels: months.map((d) => DF.mon.format(d)),
    series: [
      { name: 'Pemasukan', color: 'var(--c-in)', values: vin },
      { name: 'Pengeluaran', color: 'var(--c-out)', values: vout },
    ],
    tipTitle: (i) => DF.month.format(months[i]),
    tipExtra: (i) => `Saldo ${rp(vin[i] - vout[i])}`,
  });
  $('#monthTable').innerHTML = `<table class="mini-table"><thead><tr><th>Bulan</th><th>Masuk</th><th>Keluar</th><th>Saldo</th></tr></thead><tbody>${
    months.map((d, i) => `<tr><td>${DF.monY.format(d)}</td><td>${rp(vin[i])}</td><td>${rp(vout[i])}</td><td>${rp(vin[i] - vout[i])}</td></tr>`).join('')
  }</tbody></table>`;
}

/* ---------------- Grafik batang SVG ---------------- */
function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
function barPath(x, y, w, h, r) {
  if (h <= 0.5) return '';
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h}Z`;
}

function barChart(el, cfg) {
  const W = 340, H = 190, padL = 44, padR = 8, padT = 12, padB = 24;
  const pw = W - padL - padR, ph = H - padT - padB;
  const n = cfg.labels.length, k = cfg.series.length;
  const maxV = Math.max(1, ...cfg.series.flatMap((s) => s.values), cfg.avg || 0);
  const step = niceStep(maxV / 3);
  const top = Math.ceil(maxV / step) * step;
  const y = (v) => padT + ph - (v / top) * ph;
  const band = pw / n;
  const groupW = Math.min(band * (k > 1 ? 0.74 : 0.66), k > 1 ? 44 : 26);
  const gap = 2;
  const bw = (groupW - gap * (k - 1)) / k;

  let g = '<g class="grid">';
  for (let v = 0; v <= top + 1e-6; v += step) {
    g += `<line x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}"/>`;
    g += `<text class="axis-label" x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v ? rpCompact(v) : '0'}</text>`;
  }
  g += '</g>';

  const every = Math.ceil(n / 7);
  let bars = '', xl = '', hits = '';
  for (let i = 0; i < n; i++) {
    const gx = padL + band * i + (band - groupW) / 2;
    cfg.series.forEach((s, j) => {
      const v = s.values[i];
      const bx = gx + j * (bw + gap);
      bars += `<path class="bar" data-i="${i}" fill="${s.color}" d="${barPath(bx, y(v), bw, y(0) - y(v), Math.min(4, bw / 2))}" style="animation-delay:${i * 18}ms"/>`;
    });
    if (i % every === 0 || i === n - 1 && n <= 12) {
      xl += `<text class="axis-label" x="${padL + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(cfg.labels[i])}</text>`;
    }
    hits += `<rect class="hit" data-i="${i}" x="${padL + band * i}" y="${padT}" width="${band}" height="${ph}"/>`;
  }
  let avg = '';
  if (cfg.avg) {
    avg = `<line x1="${padL}" x2="${W - padR}" y1="${y(cfg.avg)}" y2="${y(cfg.avg)}" stroke="var(--ink-2)" stroke-width="1" stroke-dasharray="4 3" opacity=".55"/>
      <text class="axis-label" x="${W - padR}" y="${y(cfg.avg) - 4}" text-anchor="end">rata-rata</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(cfg.series.map((s) => s.name).join(' dan '))}">
    ${g}${bars}${avg}<line class="baseline" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>${xl}${hits}</svg>`;

  const svg = el.querySelector('svg');
  const show = (i) => {
    el.classList.add('has-focus');
    $$('.bar', el).forEach((b) => b.classList.toggle('focus', +b.dataset.i === i));
    const rect = svg.getBoundingClientRect();
    const sc = rect.width / W;
    const topV = Math.max(...cfg.series.map((s) => s.values[i]));
    const cx = rect.left + (padL + band * i + band / 2) * sc;
    const cy = rect.top + y(topV) * sc;
    const rows = cfg.series.map((s) => `<div class="t-row"><i class="sw" style="background:${s.color}"></i>${esc(s.name)}: ${rp(s.values[i])}</div>`).join('');
    showTooltip(cx, cy, `<div class="t-title">${esc(cfg.tipTitle(i))}</div>${rows}${cfg.tipExtra ? `<div class="t-row" style="opacity:.8">${esc(cfg.tipExtra(i))}</div>` : ''}`);
  };
  const clear = () => { el.classList.remove('has-focus'); $$('.bar', el).forEach((b) => b.classList.remove('focus')); hideTooltip(); };
  svg.addEventListener('pointerdown', (e) => { const h = e.target.closest('.hit'); if (h) { e.stopPropagation(); show(+h.dataset.i); } });
  svg.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const h = e.target.closest('.hit'); if (h) show(+h.dataset.i); });
  svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') clear(); });
  el._clear = clear;
}

function showTooltip(x, y, html) {
  const tip = $('#tooltip');
  tip.innerHTML = html;
  tip.hidden = false;
  const w = tip.offsetWidth;
  const clamped = Math.min(window.innerWidth - w / 2 - 8, Math.max(w / 2 + 8, x));
  tip.style.left = clamped + 'px';
  tip.style.top = Math.max(tip.offsetHeight + 16, y) + 'px';
}
function hideTooltip() {
  $('#tooltip').hidden = true;
  $$('.chart.has-focus').forEach((c) => { c.classList.remove('has-focus'); $$('.bar.focus', c).forEach((b) => b.classList.remove('focus')); });
}

/* ---------------- Pengaturan ---------------- */
function renderSettings() {
  const c = state.conn || {};
  $('#setSheet').textContent = c.name || 'Terhubung';
  const link = $('#openSheet');
  const url = state.sheetUrl || c.sheetUrl;
  link.hidden = !url; if (url) link.href = url;
  const last = state.lastSync ? `Terakhir ${DF.time.format(new Date(state.lastSync))}` : 'Belum pernah';
  $('#setSync').textContent = `${last} · ${state.queue.length} tertunda`;
  $('#setKey').textContent = c.key ? c.key.slice(0, 5) + '-•••••-•••••-•••••' : '—';
}

function updateSyncUI() {
  const pill = $('#syncPill');
  pill.classList.remove('syncing', 'pending', 'error');
  let text = 'Tersinkron';
  if (state.syncing) { pill.classList.add('syncing'); text = 'Menyinkron…'; }
  else if (state.queue.length) { pill.classList.add('pending'); text = `${state.queue.length} tertunda`; }
  else if (state.syncError) { pill.classList.add('error'); text = state.syncError.code === 'NETWORK' ? 'Offline' : 'Gagal sinkron'; }
  $('.sync-text', pill).textContent = text;
  if (state.view === 'settings') renderSettings();
}

/* ============================================================
   NAVIGASI
   ============================================================ */
function go(view) {
  if (!$('#view-' + view)) return;
  hideTooltip();
  state.view = view;
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.goto === view));
  $('#viewTitle').textContent = $('#view-' + view).dataset.title;
  window.scrollTo({ top: 0 });
  render();
}

function setPeriod(p) {
  if (p === 'custom') { openRange(); return; }
  state.period = p;
  store.set(LS.prefs, { period: state.period, custom: state.custom });
  render();
}

/* ============================================================
   SHEET (bottom sheet) & DIALOG
   ============================================================ */
let openSheetEl = null;
function openSheet(el) {
  if (openSheetEl && openSheetEl !== el) closeSheet(true);
  hideTooltip();
  const bd = $('#txBackdrop');
  bd.classList.remove('closing'); bd.hidden = false;
  el.classList.remove('closing'); el.hidden = false;
  el.scrollTop = 0;
  openSheetEl = el;
  document.body.style.overflow = 'hidden';
}
function closeSheet(instant) {
  const el = openSheetEl;
  if (!el) return;
  openSheetEl = null;
  const bd = $('#txBackdrop');
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  const done = () => { if (openSheetEl === el) return; el.hidden = true; el.classList.remove('closing'); if (!openSheetEl) { bd.hidden = true; bd.classList.remove('closing'); document.body.style.overflow = ''; } };
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { done(); return; }
  el.classList.add('closing'); bd.classList.add('closing');
  setTimeout(done, 240);
}

function confirmDialog(title, text, yesLabel = 'Hapus') {
  return new Promise((resolve) => {
    const box = $('#confirm');
    $('#confirmTitle').textContent = title;
    $('#confirmText').textContent = text;
    $('#confirmYes').textContent = yesLabel;
    box.hidden = false;
    const finish = (v) => { box.hidden = true; $('#confirmYes').onclick = $('#confirmNo').onclick = box.onclick = null; resolve(v); };
    $('#confirmYes').onclick = () => finish(true);
    $('#confirmNo').onclick = () => finish(false);
    box.onclick = (e) => { if (e.target === box) finish(false); };
    $('#confirmNo').focus();
  });
}

function toast(type, msg, ms = 2800) {
  const host = $('#toastHost');
  while (host.children.length >= 3) host.firstChild.remove();
  const ico = { success: '✓', error: '!', warn: '!', info: 'i' }[type] || 'i';
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.setAttribute('role', type === 'error' ? 'alert' : 'status');
  t.innerHTML = `<span class="t-ico">${ico}</span><span>${esc(msg)}</span>`;
  host.appendChild(t);
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
  t.onclick = kill;
  setTimeout(kill, type === 'error' ? ms + 1800 : ms);
}

/* ============================================================
   FORM TAMBAH / EDIT
   ============================================================ */
const amountEl = () => $('#txAmount');
function parseAmount(s) { const d = String(s || '').replace(/[^\d]/g, ''); return d ? Number(d) : 0; }
function fmtAmountInput(n) { return n ? nf.format(n) : ''; }
function sizeAmount() {
  const el = amountEl();
  const s = el.value || el.placeholder;
  const dots = (s.match(/\./g) || []).length;
  el.style.width = Math.max(1.2, s.length - dots * 0.6 + 0.4) + 'ch'; // lebar mengikuti angka → "Rp" menempel
}

function openTxForm(tx) {
  const f = state.form;
  f.mode = tx ? 'edit' : 'add';
  f.editing = tx || null;
  f.type = tx ? tx.type : (f.lastType || 'out');
  f.category = tx ? tx.category : '';
  $('#txSheetTitle').textContent = tx ? 'Edit transaksi' : 'Tambah transaksi';
  $('#txSave .btn-label').textContent = tx ? 'Simpan perubahan' : 'Simpan';
  $('#txDelete').hidden = !tx;
  amountEl().value = tx ? fmtAmountInput(Math.round(tx.amount)) : '';
  sizeAmount();
  $('#txNote').value = tx ? tx.note || '' : '';
  setFormDate(tx ? tx.date : iso(todayD()));
  ['#amountError', '#catError'].forEach((s) => { $(s).textContent = ''; });
  renderTypeSeg();
  renderCatGrid();
  openSheet($('#txSheet'));
  if (!tx) amountEl().focus(); // langsung muncul keyboard angka
}

function renderTypeSeg() {
  const seg = $('#txType');
  seg.dataset.mode = state.form.type;
  $$('button', seg).forEach((b) => b.classList.toggle('active', b.dataset.type === state.form.type));
}

function renderCatGrid() {
  const f = state.form;
  let cats = (state.categories[f.type] || []).slice();
  if (!cats.length) cats = f.type === 'in' ? ['Gaji', 'Lainnya'] : ['Makan & Minum', 'Transportasi', 'Belanja', 'Lainnya'];
  if (f.category && !cats.includes(f.category)) cats.unshift(f.category);
  $('#catGrid').innerHTML = cats.map((c) => `
    <button type="button" class="cat-btn${c === f.category ? ' active' : ''}" data-cat="${esc(c)}" aria-pressed="${c === f.category}">
      <span class="e" aria-hidden="true">${catEmoji(c, f.type)}</span><span class="n">${esc(c)}</span>
    </button>`).join('');
}

function setFormDate(d) {
  $('#txDate').value = d;
  const t = iso(todayD()), y = iso(addDays(todayD(), -1));
  $$('[data-quickdate]').forEach((c) => c.classList.toggle('active', (c.dataset.quickdate === '0' && d === t) || (c.dataset.quickdate === '-1' && d === y)));
  $('.date-pick').classList.toggle('active', d !== t && d !== y);
}

function submitTx(e) {
  e && e.preventDefault();
  const f = state.form;
  const amount = parseAmount(amountEl().value);
  const date = $('#txDate').value;
  let ok = true;
  $('#amountError').textContent = '';
  $('#catError').textContent = '';
  if (!amount || amount <= 0) {
    $('#amountError').textContent = 'Nominal wajib diisi dan harus lebih dari 0';
    shake($('.amount-wrap')); ok = false;
  } else if (amount > 1e13) {
    $('#amountError').textContent = 'Nominal terlalu besar'; ok = false;
  }
  if (!f.category) { $('#catError').textContent = 'Pilih kategori dulu'; shake($('#catGrid')); ok = false; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('error', 'Tanggal tidak valid'); ok = false; }
  if (!ok) { if (!amount) amountEl().focus(); return; }

  const tx = {
    id: f.editing ? f.editing.id : newId(),
    type: f.type, date, category: f.category, amount,
    note: $('#txNote').value.trim(),
    created: f.editing ? f.editing.created : new Date().toISOString(),
  };
  if (f.editing) {
    const o = f.editing;
    if (o.type === tx.type && o.date === tx.date && o.category === tx.category && o.amount === tx.amount && (o.note || '') === tx.note) {
      closeSheet(); toast('info', 'Tidak ada perubahan'); return;
    }
  }
  f.lastType = f.type;
  enqueue({ op: f.editing ? 'update' : 'add', tx });
  closeSheet();
  render();
  flushQueue();
}

function shake(el) {
  el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 320 });
}

async function deleteTx(tx) {
  const ok = await confirmDialog('Hapus transaksi?',
    `${tx.category} · ${rpSigned(tx)} · ${dayLabel(tx.date)}. Baris ini akan dihapus dari spreadsheet dan tidak bisa dibatalkan.`);
  if (!ok) return;
  closeSheet();
  enqueue({ op: 'delete', id: tx.id });
  render();
  flushQueue();
}

/* ---------------- Detail ---------------- */
function openDetail(id) {
  const tx = visibleTx().find((t) => t.id === id);
  if (!tx) return;
  state.detail = tx;
  $('#detailBody').innerHTML = `
    <div class="detail-hero">
      <div class="tx-ico ${tx.type}" aria-hidden="true">${catEmoji(tx.category, tx.type)}</div>
      <p class="d-amt" style="color:${tx.type === 'in' ? 'var(--c-in-ink)' : 'var(--ink)'}">${rpSigned(tx)}</p>
      <p class="d-type" style="color:${tx.type === 'in' ? 'var(--c-in-ink)' : 'var(--c-out-ink)'}">${tx.type === 'in' ? '↓ Pemasukan' : '↑ Pengeluaran'}${tx.pending ? ' · tertunda' : ''}</p>
    </div>
    <dl class="detail-list">
      <div><dt>Kategori</dt><dd>${esc(tx.category)}</dd></div>
      <div><dt>Tanggal</dt><dd>${tx.date ? DF.long.format(parseISO(tx.date)) : '—'}</dd></div>
      <div><dt>Catatan</dt><dd>${esc(tx.note || '—')}</dd></div>
      ${tx.created ? `<div><dt>Dicatat</dt><dd>${DF.shortY.format(new Date(tx.created))}, ${DF.time.format(new Date(tx.created))}</dd></div>` : ''}
    </dl>`;
  openSheet($('#detailSheet'));
}

/* ---------------- Periode custom ---------------- */
function openRange() {
  const r = getRange();
  $('#rangeFrom').value = state.custom ? state.custom.from : r.from;
  $('#rangeTo').value = state.custom ? state.custom.to : iso(todayD());
  $('#rangeError').textContent = '';
  openSheet($('#rangeSheet'));
}
function applyRange() {
  const from = $('#rangeFrom').value, to = $('#rangeTo').value;
  if (!from || !to) { $('#rangeError').textContent = 'Isi kedua tanggal'; return; }
  if (from > to) { $('#rangeError').textContent = 'Tanggal awal harus sebelum tanggal akhir'; return; }
  state.custom = { from, to };
  state.period = 'custom';
  store.set(LS.prefs, { period: state.period, custom: state.custom });
  closeSheet();
  render();
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function showOnboarding(prefill) {
  closeSheet(true);
  $('#app').hidden = true;
  $('#onboarding').hidden = false;
  $('#onbUrl').value = (prefill && prefill.url) || '';
  $('#onbKey').value = '';
  $('#onbError').textContent = '';
}

async function submitOnboarding(e) {
  e.preventDefault();
  const url = $('#onbUrl').value.trim();
  const key = $('#onbKey').value.trim().toUpperCase().replace(/\s+/g, '');
  const err = $('#onbError');
  err.textContent = '';
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url)) {
    err.textContent = url.endsWith('/dev')
      ? 'Gunakan URL yang berakhiran /exec (bukan /dev).'
      : 'URL harus berbentuk https://script.google.com/macros/s/…/exec';
    return;
  }
  if (key.length < 10) { err.textContent = 'Kunci akses belum lengkap.'; return; }
  const btn = $('#onbSubmit');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const conn = { url, key };
    const info = await api('ping', {}, conn);
    conn.name = info.name; conn.sheetUrl = info.spreadsheetUrl;
    const changed = !state.conn || state.conn.url !== url;
    state.conn = conn;
    store.set(LS.conn, conn);
    state.categories = info.categories || state.categories;
    state.sheetUrl = info.spreadsheetUrl;
    if (changed) { state.tx = []; state.loaded = false; saveCache(); invalidate(); }
    startApp();
    toast('success', 'Terhubung ke "' + info.name + '"');
  } catch (ex) {
    err.textContent = ex.code === 'AUTH' ? 'Kunci akses salah. Cek lagi (huruf & tanda strip).'
      : ex.code === 'NETWORK' ? 'Tidak bisa terhubung. Cek internet, URL, dan pastikan akses Web App = "Siapa saja".'
        : ex.message;
  } finally {
    btn.classList.remove('loading'); btn.disabled = false;
  }
}

/* ============================================================
   EVENT
   ============================================================ */
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const gotoBtn = t.closest('[data-goto]');
    if (gotoBtn) { go(gotoBtn.dataset.goto); return; }
    const txBtn = t.closest('.tx[data-id]');
    if (txBtn) { openDetail(txBtn.dataset.id); return; }
    const chip = t.closest('.period-bar .chip');
    if (chip) { setPeriod(chip.dataset.period); return; }
    const act = t.closest('[data-action]');
    if (act) {
      if (act.dataset.action === 'add') openTxForm();
      if (act.dataset.action === 'reset-filter') resetFilters();
      return;
    }
    const catRow = t.closest('.cat-row[data-cat]');
    if (catRow) {
      const r = getRange();
      Object.assign(state.hist, { cat: catRow.dataset.cat, type: 'out', from: r.from, to: r.to, q: '', limit: 60 });
      go('history');
      return;
    }
    if (t.closest('[data-close]') || t === $('#txBackdrop')) closeSheet();
  });

  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.chart')) hideTooltip(); });
  window.addEventListener('scroll', hideTooltip, { passive: true });

  $('#fab').addEventListener('click', () => openTxForm());
  $('#uncatNotice').addEventListener('click', () => {
    state.hist = { q: '', type: 'all', cat: UNCAT, from: '', to: '', limit: 60 };
    go('history');
  });

  // Form
  $('#txForm').addEventListener('submit', submitTx);
  $('#txType').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]'); if (!b) return;
    if (state.form.type !== b.dataset.type) { state.form.type = b.dataset.type; state.form.category = ''; }
    renderTypeSeg(); renderCatGrid();
  });
  $('#catGrid').addEventListener('click', (e) => {
    const b = e.target.closest('.cat-btn'); if (!b) return;
    state.form.category = b.dataset.cat;
    $('#catError').textContent = '';
    $$('.cat-btn', $('#catGrid')).forEach((x) => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-pressed', on); });
  });
  amountEl().addEventListener('input', () => {
    const el = amountEl();
    const n = parseAmount(el.value);
    el.value = fmtAmountInput(Math.min(n, 9999999999999));
    sizeAmount();
    if (n) $('#amountError').textContent = '';
  });
  amountEl().addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); amountEl().blur(); } });
  $('#txNote').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTx(); } });
  $$('[data-quickdate]').forEach((c) => c.addEventListener('click', () => setFormDate(iso(addDays(todayD(), +c.dataset.quickdate)))));
  $('#txDate').addEventListener('change', (e) => setFormDate(e.target.value || iso(todayD())));
  $('#txDelete').addEventListener('click', () => { const tx = state.form.editing; if (tx) deleteTx(tx); });

  // Detail
  $('#detailEdit').addEventListener('click', () => { const tx = state.detail; closeSheet(true); openTxForm(tx); });
  $('#detailDelete').addEventListener('click', () => state.detail && deleteTx(state.detail));

  // Range
  $('#rangeApply').addEventListener('click', applyRange);

  // Riwayat
  let deb;
  $('#searchInput').addEventListener('input', (e) => {
    clearTimeout(deb);
    deb = setTimeout(() => { state.hist.q = e.target.value; state.hist.limit = 60; renderHistory(); }, 160);
  });
  $('#typeFilter').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-type]'); if (!b) return;
    state.hist.type = b.dataset.type; state.hist.limit = 60; renderHistory();
  });
  $('#catFilter').addEventListener('change', (e) => { state.hist.cat = e.target.value; state.hist.limit = 60; renderHistory(); });
  $('#fromFilter').addEventListener('change', (e) => { state.hist.from = e.target.value; renderHistory(); });
  $('#toFilter').addEventListener('change', (e) => { state.hist.to = e.target.value; renderHistory(); });
  $('#clearFilters').addEventListener('click', resetFilters);
  $('#loadMore').addEventListener('click', () => { state.hist.limit += 60; renderHistory(); });

  // Pengaturan
  $('#syncNow').addEventListener('click', () => refresh({ toast: true }));
  $('#syncPill').addEventListener('click', () => refresh({ toast: true }));
  $('#changeConn').addEventListener('click', () => showOnboarding(state.conn));
  $('#logout').addEventListener('click', async () => {
    const pending = state.queue.length;
    const ok = await confirmDialog('Putuskan dari HP ini?',
      (pending ? `Ada ${pending} transaksi yang BELUM terkirim dan akan hilang. ` : '') +
      'Data di spreadsheet tetap aman. Kamu perlu memasukkan URL & kunci lagi untuk memakai aplikasi.', 'Putuskan');
    if (!ok) return;
    Object.values(LS).forEach(store.del);
    location.reload();
  });

  // Onboarding
  $('#onbForm').addEventListener('submit', submitOnboarding);

  // Sinkron otomatis
  window.addEventListener('online', () => { toast('info', 'Kembali online'); refresh({ silent: true }); });
  window.addEventListener('offline', () => { state.syncError = apiError('Offline', 'NETWORK'); updateSyncUI(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.conn && !$('#app').hidden) {
      $('#todayLabel').textContent = DF.long.format(todayD());
      if (Date.now() - state.lastSync > 60000 || state.queue.length) refresh({ silent: true });
      else render();
    }
  });
  setInterval(() => { if (state.queue.length && navigator.onLine) flushQueue(); }, 30000);

  // iPhone: angkat bottom sheet di atas keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fix = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.documentElement.style.setProperty('--vvh', vv.height + 'px');
    };
    vv.addEventListener('resize', fix);
    vv.addEventListener('scroll', fix);
  }
}

function resetFilters() {
  state.hist = { q: '', type: 'all', cat: '', from: '', to: '', limit: 60 };
  renderHistory();
}

/* ============================================================
   START
   ============================================================ */
function startApp() {
  $('#onboarding').hidden = true;
  $('#app').hidden = false;
  $('#todayLabel').textContent = DF.long.format(todayD());
  go(state.view || 'home');
  updateSyncUI();
  refresh({ silent: state.loaded });
}

bindEvents();
if (state.conn && state.conn.url && state.conn.key) startApp();
else showOnboarding();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
