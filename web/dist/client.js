import { morph, hasSelection } from './morph.js';
import { buildRows, summarize, keep, OUTCOME } from './history.js';
import { ORDER, NAME, KEYS, decimalsOf } from './types.js';
const $ = (id) => document.getElementById(id);
let DEC = 2;
const f = (x, d) => (x == null ? '–' : x.toFixed(d ?? DEC));
const sg = (x, d) => (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d ?? DEC);
const lvl = (p, k) => (p && p.valid ? { POC: p.poc, VAH: p.vah, VAL: p.val }[k] : undefined);
const EFF = { bull: ['BULL', 'up'], bear: ['BEAR', 'dn'], bal: ['BAL', 'in'] };
let msg = null;
let recvAt = 0;
let showAll = false;
let histTag = null; // profil yang sedang dibuka di dialog histori
let histLimit = 50;
let histFilter = 'all';
let lastPx = null;
let full = null; // bias terbaru dari server
let ladFollow = true; // true = level map selalu dipusatkan ke harga; false = posisi scroll pengguna dipertahankan
let progUntil = 0; // abaikan event scroll sampai waktu ini (scroll yang kita lakukan sendiri)
// ---------- logika konteks
function where(price, p) {
    if (!p || !p.valid || p.vah == null || p.val == null || p.poc == null)
        return { t: 'n/a', c: 'mu' };
    if (price > p.vah)
        return { t: `Di atas VAH ${sg(price - p.vah)}`, c: 'up' };
    if (price < p.val)
        return { t: `Di bawah VAL ${sg(price - p.val)}`, c: 'dn' };
    return { t: `Di dalam VA · ${price >= p.poc ? 'atas' : 'bawah'} POC`, c: 'in' };
}
function openChip(o) {
    if (!o || o.state === 'n/a')
        return '<span class="chip">n/a</span>';
    const m = {
        'Above VAH': ['Di atas VAH', 'up'], 'Below VAL': ['Di bawah VAL', 'dn'], 'Inside VA': ['Di dalam VA', 'in'],
    };
    const [t, c] = m[o.state] ?? [o.state, 'in'];
    const extra = o.dist != null ? ` ${o.dist.toFixed(DEC)}` : o.poc_side ? ` · ${o.poc_side} POC` : '';
    return `<span class="chip ${c}">${t}${extra}</span>`;
}
function migration(d, pv) {
    const dp = d.poc - pv.poc;
    const dvah = d.vah, dval = d.val, pvah = pv.vah, pval = pv.val;
    const ov = Math.max(0, Math.min(dvah, pvah) - Math.max(dval, pval));
    const pct = dvah > dval ? Math.round((100 * ov) / (dvah - dval)) : 0;
    const rel = dval > pvah ? 'VA lebih tinggi, tanpa overlap' : dvah < pval ? 'VA lebih rendah, tanpa overlap' : `VA overlap ${pct}%`;
    return `<b class="${dp >= 0 ? 'up' : 'dn'}">POC ${dp >= 0 ? '▲' : '▼'} ${Math.abs(dp).toFixed(DEC)}</b> · ${rel}`;
}
function cell(p, k, dev) {
    const v = lvl(p, k);
    if (v == null || !p)
        return '<td class="mu">–</td>';
    if (dev)
        return `<td>${f(v)}</td>`;
    const t = p.touch[k];
    return t ? `<td class="tc" title="disentuh dari ${t.dir}, ${t.t_ny}">${f(v)}</td>` : `<td class="nk" title="naked (belum tersentuh)">${f(v)}</td>`;
}
function levels(s) {
    const out = [];
    for (const t of ORDER) {
        const P = s.profiles[t];
        if (!P)
            continue;
        const d = P.developing;
        if (d && d.valid)
            for (const k of KEYS)
                out.push({ price: lvl(d, k), label: `${k} ${d.name}`, tag: t, cls: 'dev' });
        P.items.forEach((p, i) => {
            if (!p.valid)
                return;
            for (const k of KEYS) {
                const naked = !p.touch[k];
                if (naked || i === P.items.length - 1)
                    out.push({ price: lvl(p, k), label: `${naked ? 'n' : ''}${k} ${p.name}`, tag: t, cls: naked ? 'nkr' : 'prev' });
            }
        });
    }
    return out.sort((a, b) => b.price - a.price);
}
// ---------- tampilan
function biasPanel(s, fb) {
    if (!fb)
        return '<section class="panel s-bias"><div class="ph"><b>Bias</b><small>menunggu data dari server…</small></div></section>';
    const vd = (v) => `<span class="vd ${v.cls}">${v.text}</span>`;
    const chip = (b) => { const [t, c] = EFF[b.eff]; return `<span class="eb ${c}">${t}</span>`; };
    const rows = fb.tags.map((t, i) => {
        const b = fb.live[i], cl = fb.closed[i], P = s.profiles[t];
        if (!b)
            return `<div class="br"><div class="bn"><i class="tg ${t}">${t}</i>${NAME[t]}<b class="lb mu">N/A</b></div></div>`;
        const lcv = P.developing?.lc;
        const clTxt = cl
            ? `<span class="k">Close terakhir<small>${P.tpo_min}m · ${f(lcv)} · ${(P.developing?.lc_ny ?? '').slice(6)}</small></span>${chip(cl)}<span class="${cl.sc}">${cl.status}</span>`
            : `<span class="k">Close terakhir</span><span class="mu">Belum ada letter yang selesai di periode ini</span>`;
        return `<div class="br ${b.cls}">
      <div class="bn"><i class="tg ${t}">${t}</i>${NAME[t]}<b class="lb ${b.cls}">${b.label}</b></div>
      <div class="bo mu">${b.open}</div>
      <div class="bc c">${clTxt}</div>
      <div class="bc l"><span class="k">Realtime<small>${f(s.price)}</small></span>${chip(b)}<span class="${b.sc}">${b.status}</span></div></div>`;
    }).join('');
    return `<section class="panel s-bias"><div class="ph"><b>Bias</b><small>Open periode berjalan vs Value Area periode sebelumnya</small></div>
    <div class="vrow">
      <div class="vcell"><span class="vl">Dasar <small>dari Open</small></span>${vd(fb.vBase)}</div>
      <div class="vcell"><span class="vl">Progres <small>close terakhir</small></span>${vd(fb.vClose)}</div>
      <div class="vcell"><span class="vl">Progres <small>realtime</small></span>${vd(fb.vLive)}</div></div>
    <div class="bm">${rows}</div></section>`;
}
function card(P, s) {
    const d = P.developing, n = P.items.length, pv = P.items[n - 1], p2 = P.items[n - 2];
    const st = P.settings;
    const ex = st.week_start ? `minggu mulai ${st.week_start}` : st.session_hours ? `sesi ${st.session_hours} jam` : st.micro_min ? `${st.micro_min} menit` : `mulai ${st.start}`;
    let facts = '';
    if (d && d.valid) {
        const w = where(s.price, d);
        facts += `<div><span>Harga vs VA now</span><b class="chip ${w.c}">${w.t}</b></div>`;
    }
    facts += `<div><span>Open vs VA ${pv ? pv.name : ''}</span>${openChip(s.context.open_vs_va[P.tag])}</div>`;
    if (d && d.valid && pv && pv.valid)
        facts += `<div class="f-mig"><span>Migrasi vs ${pv.name}</span><span style="color:var(--tx)">${migration(d, pv)}</span></div>`;
    const cols = [d ?? undefined, pv, p2];
    const head = cols.map((p, i) => `<th${i === 2 ? ' data-c3' : ''}>${p ? p.name : ''}<small>${p ? p.start_ny.slice(0, 5) : ''}${i === 0 ? ' · now' : ''}</small></th>`).join('');
    const rows = KEYS.map((k) => `<tr><td>${k}</td>${cols.map((p, i) => (i === 2 ? cell(p, k, false).replace('<td', '<td data-c3') : cell(p, k, i === 0))).join('')}</tr>`).join('');
    const plain = (label, g) => `<tr class="hl"><td>${label}</td>${cols.map((p, i) => `<td${i === 2 ? ' data-c3' : ''}>${p && p.valid ? g(p) : '–'}</td>`).join('')}</tr>`;
    return `<section class="card ${P.tag}"><div class="ph clk" data-hist="${P.tag}" title="Lihat histori ${NAME[P.tag]}">
      <i class="tg ${P.tag}" style="margin:0">${P.tag}</i><b>${NAME[P.tag]}</b><small>TPO ${P.tpo_min}m · ${ex}${d ? ' · ' + d.letters + ' huruf' : ''}</small>
      <span class="sp"><button data-hist="${P.tag}">Histori ▸</button></span></div>
    <div class="bd"><div class="facts">${facts}</div>
    <div class="tw"><table><tr><th></th>${head}</tr>${rows}${plain('High', (p) => f(p.high))}${plain('Low', (p) => f(p.low))}</table></div></div></section>`;
}
function ladder(s) {
    const all = levels(s), atr = s.atr || 1;
    const list = showAll ? all : all.filter((l) => Math.abs(l.price - s.price) <= 3 * atr);
    let rows = '', placed = false, prev = null;
    const pxRow = `<tr class="px" id="pxrow"><td colspan="4">▶ ${f(s.price)} · harga sekarang</td></tr>`;
    for (const l of list) {
        if (!placed && l.price < s.price) {
            rows += pxRow;
            placed = true;
            prev = null;
        }
        const d = l.price - s.price;
        const cf = prev != null && Math.abs(prev - l.price) < 0.1 * atr ? ' cf' : '';
        rows += `<tr class="${l.cls}${cf}"><td>${f(l.price)}</td><td><i class="tg ${l.tag}">${l.tag}</i>${l.label}</td>
      <td class="${d >= 0 ? 'up' : 'dn'}" title="${Math.round(Math.abs(d) / s.point)} pt">${sg(d)}</td><td class="mu">${(Math.abs(d) / atr).toFixed(1)}×</td></tr>`;
        prev = l.price;
    }
    if (!placed)
        rows += pxRow;
    return `<aside class="panel s-lvl"><div class="ph"><b>Level map</b><span class="sp"><button id="lctr" title="Pusatkan ke harga sekarang">⌖ Pusat</button>
      <label class="ck"><input type="checkbox" id="all" ${showAll ? 'checked' : ''}> semua</label></span></div>
    <div class="lh">${showAll ? 'Semua level' : '±3 ATR'} · <span class="am">kuning = naked</span> · <i>miring = developing</i> · garis putus = confluence (&lt;0.1 ATR)</div>
    <div class="ladwrap" id="ladwrap"><table class="lad"><tr><th>Harga</th><th>Level</th><th>Jarak</th><th>ATR</th></tr>${rows}</table></div></aside>`;
}
// ---------- histori per profil
const GROUPS = [
    { g: 'inside', title: 'Open di dalam VA (balance)', outs: ['bal-in', 'bal-up', 'bal-dn'] },
    { g: 'above', title: 'Open di atas VAH', outs: ['bull-acc', 'bull-fail', 'bull-rev'] },
    { g: 'below', title: 'Open di bawah VAL', outs: ['bear-acc', 'bear-fail', 'bear-rev'] },
];
const FILTERS = [
    ['all', 'Semua'], ['bal', 'Open inside (balance)'], ['bal-in', 'Balance → tetap inside'],
    ['bal-brk', 'Balance → breakout'], ['out', 'Open di luar VA'],
];
function posChip(w) {
    if (!w)
        return '<span class="mu">–</span>';
    if (w.pos === 'above')
        return `<span class="chip up">Atas VAH +${w.dist.toFixed(DEC)}</span>`;
    if (w.pos === 'below')
        return `<span class="chip dn">Bawah VAL −${w.dist.toFixed(DEC)}</span>`;
    return '<span class="chip in">Dalam VA</span>';
}
function histRow(r) {
    const p = r.p, pv = r.pv;
    if (!p.valid)
        return `<tr><td>${p.name}<small>${p.start_ny}</small></td><td colspan="13" class="mu" style="text-align:left">periode tidak valid / data kurang</td></tr>`;
    const oc = r.outcome ? `<span class="chip ${OUTCOME[r.outcome].cls}">${OUTCOME[r.outcome].text}</span>` : '<span class="mu">–</span>';
    const probe = [r.probeUp > 0 ? `<span class="up">↑ ${r.probeUp.toFixed(DEC)}</span>` : '', r.probeDn > 0 ? `<span class="dn">↓ ${r.probeDn.toFixed(DEC)}</span>` : ''].filter(Boolean).join(' ') || '<span class="mu">–</span>';
    const rng = p.high != null && p.low != null ? f(p.high - p.low) : '–';
    const mig = r.pocShift == null ? '–' : `<span class="${r.pocShift >= 0 ? 'up' : 'dn'}">${r.pocShift >= 0 ? '▲' : '▼'} ${Math.abs(r.pocShift).toFixed(DEC)}</span>`;
    const ov = r.overlap == null ? '–' : r.overlap + '%';
    const nk = r.live ? '<span class="mu">–</span>' : ['POC', 'VAH', 'VAL'].map((k) => `<span class="${p.touch[k] ? 'mu' : 'am'}" title="${p.touch[k] ? 'sudah disentuh' : 'naked'}">${k}${p.touch[k] ? '✔' : '○'}</span>`).join(' ');
    const ref = pv && pv.valid ? ` title="VA ${pv.name}: ${f(pv.val)} – ${f(pv.vah)} · POC ${f(pv.poc)}"` : '';
    const closeCell = p.close == null && !r.live ? '<span class="mu">–</span>' : posChip(r.close);
    const closeVal = r.live ? '' : p.close != null ? `<small>${f(p.close)}</small>` : '';
    return `<tr class="${r.live ? 'live' : ''}"><td>${p.name}${r.live ? ' <i class="tg W">now</i>' : ''}<small>${p.start_ny}</small></td>
    <td${ref}>${posChip(r.open)}<small>${f(p.open)}</small></td><td${ref}>${closeCell}${closeVal}</td><td>${oc}</td><td>${probe}</td>
    <td>${f(p.poc)}</td><td>${f(p.vah)}</td><td>${f(p.val)}</td><td>${f(p.high)}</td><td>${f(p.low)}</td><td>${rng}</td><td>${mig}</td><td>${ov}</td><td class="nkc">${nk}</td></tr>`;
}
function histSummary(rows) {
    const st = summarize(rows);
    return GROUPS.map(({ g, title, outs }) => {
        const s = st.find((x) => x.group === g);
        if (!s.n)
            return `<div class="sb"><b>${title}</b><span class="mu"> · n=0</span></div>`;
        const chips = outs.map((o) => {
            const c = s.counts[o] ?? 0;
            const t = OUTCOME[o].text.split('→')[1].trim();
            return `<span class="chip ${OUTCOME[o].cls}">${t} ${Math.round((100 * c) / s.n)}% <span class="mu">(${c})</span></span>`;
        }).join(' ');
        return `<div class="sb"><b>${title}</b><span class="mu"> · n=${s.n}</span><div class="chips2">${chips}</div></div>`;
    }).join('');
}
function histShell() {
    const s = msg?.s.data;
    if (!s || !histTag)
        return '';
    const P = s.profiles[histTag];
    const tabs = ORDER.filter((t) => s.profiles[t]).map((t) => `<button data-htab="${t}" class="${t === histTag ? 'on' : ''}">${NAME[t]}</button>`).join('');
    const lim = [20, 50, 100, 200].map((n) => `<option value="${n}" ${n === histLimit ? 'selected' : ''}>${n} periode</option>`).join('');
    const flt = FILTERS.map(([v, t]) => `<option value="${v}" ${v === histFilter ? 'selected' : ''}>${t}</option>`).join('');
    return `<div class="hh"><div class="tabs">${tabs}<button id="hx" class="x" title="Tutup">✕</button></div><span class="mu">TPO ${P.tpo_min}m · ${P.items.length} periode selesai tersedia</span>
    <span class="sp"><select id="hlim">${lim}</select><select id="hflt">${flt}</select></span></div>
    <div class="mu hnote">Open &amp; Close tiap periode dibandingkan dengan Value Area <b>periode sebelumnya</b> (arahkan kursor / tekan lama pada sel untuk melihat VA-nya). Baris “now” memakai harga sekarang sebagai close dan tidak masuk statistik.</div>
    <div id="hdata"></div>`;
}
function updateHist() {
    const s = msg?.s.data;
    const box = document.getElementById('hdata');
    if (!s || !histTag || !box)
        return;
    const P = s.profiles[histTag];
    const all = buildRows(P.items, P.developing, s.price).slice(0, histLimit + 1);
    const rows = all.filter((r) => keep(r, histFilter));
    const noClose = !P.items.some((p) => p.close != null);
    morph(box, `${noClose ? '<div class="warn">Data close belum ada di snapshot — restart engine (python mcdash.py) agar kolom Close/Hasil terisi.</div>' : ''}
    <div class="sums">${histSummary(all)}</div>
    <div class="hwrap"><table class="ht"><thead><tr><th>Periode</th><th>Open vs VA-1</th><th>Close vs VA-1</th><th>Hasil</th><th>Probe luar VA-1</th><th>POC</th><th>VAH</th><th>VAL</th><th>High</th><th>Low</th><th>Range</th><th>Migrasi POC</th><th>Overlap VA</th><th>Naked</th></tr></thead>
    <tbody>${rows.map(histRow).join('') || '<tr><td colspan="14" class="mu">Tidak ada periode yang cocok dengan filter.</td></tr>'}</tbody></table></div>`);
}
function openHist(tag) {
    histTag = tag;
    $('hbody').innerHTML = histShell();
    updateHist();
    const d = $('hdlg');
    if (!d.open)
        d.showModal();
}
function showStatus() {
    if (!msg?.s)
        return;
    const age = msg.now - msg.s.meta.ts + (Date.now() - recvAt) / 1000;
    const dead = age > 20;
    const st = msg.s.meta.status;
    $('dot').className = dead || st !== 'live' ? '' : 'ok';
    $('st').textContent = dead ? `engine tidak merespons (${Math.round(age)} dtk)` : st;
}
// Posisikan baris "harga sekarang" tepat di tengah vertikal kotak level map.
function centerLadder() {
    const wrap = document.getElementById('ladwrap'), px = document.getElementById('pxrow');
    if (!wrap || !px || !wrap.clientHeight)
        return;
    const top = px.getBoundingClientRect().top - wrap.getBoundingClientRect().top + wrap.scrollTop;
    progUntil = Date.now() + 200;
    wrap.scrollTop = top - wrap.clientHeight / 2 + px.offsetHeight / 2;
}
function render() {
    if (!msg?.s)
        return;
    const { meta, data: s } = msg.s;
    showStatus();
    const b = $('banner');
    b.style.display = meta.config_error ? 'block' : 'none';
    b.textContent = meta.config_error ? `Konfigurasi ditolak, memakai yang lama: ${meta.config_error}` : '';
    const app = $('app');
    if (!s) {
        app.textContent = meta.status;
        return;
    }
    DEC = decimalsOf(s.point);
    $('sym').textContent = s.symbol;
    const px = $('px');
    const pxText = f(s.price);
    if (px.textContent !== pxText)
        px.textContent = pxText;
    if (lastPx != null && s.price !== lastPx) { // kedip hijau/merah saat harga berubah
        px.classList.remove('fu', 'fd');
        void px.offsetWidth;
        px.classList.add(s.price > lastPx ? 'fu' : 'fd');
    }
    lastPx = s.price;
    $('asof').textContent = `${s.asof_ny} ${s.tz}`;
    $('atr').textContent = `ATR ${f(s.atr)} · naked ${s.context.naked_count}`;
    const cards = ORDER.filter((t) => s.profiles[t]).map((t) => card(s.profiles[t], s)).join('');
    morph(app, `${biasPanel(s, full)}<div class="cards s-prof">${cards}</div>${ladder(s)}`); // update di tempat: seleksi teks tetap
    if (ladFollow && !hasSelection())
        centerLadder();
    if (histTag && $('hdlg').open)
        updateHist();
}
// ---------- update realtime: tick harga datang lewat jalur cepat, tampilan digabung maks ~8x/detik
let tick = null;
let timer = 0, lastRender = 0;
function schedule() {
    if (timer)
        return;
    timer = window.setTimeout(() => { timer = 0; lastRender = performance.now(); render(); }, Math.max(0, 120 - (performance.now() - lastRender)));
}
function onTick(j) {
    tick = { p: j.p, wall: j.wall, age0: j.age, recv: performance.now() };
    if (j.bias)
        full = j.bias; // server hanya mengirim bias bila berubah
    if (msg?.s?.data) {
        msg.s.data.price = j.p;
        schedule();
    }
}
function updateAge() {
    const el = $('age');
    if (!tick) {
        el.textContent = '';
        return;
    }
    const age = tick.age0 + (performance.now() - tick.recv) / 1000;
    el.textContent = age < 100 ? `${age.toFixed(1)}s` : '>99s';
    el.className = age < 3 ? 'up' : age < 15 ? 'am' : 'dn';
}
function connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (e) => {
        const j = JSON.parse(e.data);
        const k = j.k;
        if (k === 'tick')
            return onTick(j);
        if (k === 'meta') { // detak/ status sumber data, tanpa membawa ulang snapshot
            if (msg?.s) {
                msg.s.meta = j.meta;
                msg.now = j.now;
                recvAt = Date.now();
                schedule();
            }
            return;
        }
        // Frame k:"chart" adalah siaran khusus halaman /chart (server menyiar-kan ke semua klien WS).
        // Snapshot selalu punya field "s"; apa pun tanpa "s" bukan snapshot dan tidak boleh menggantikan state.
        if (k === 'chart' || !j.s)
            return;
        msg = j;
        recvAt = Date.now();
        full = j.bias ?? null;
        schedule();
    };
    ws.onclose = () => { $('dot').className = ''; $('st').textContent = 'terputus dari server…'; setTimeout(connect, 2000); };
}
// ---------- event
$('app').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'all') {
        showAll = t.checked;
        render();
    }
});
$('app').addEventListener('click', (e) => {
    const el = e.target;
    if (el.closest('#lctr')) {
        ladFollow = true;
        centerLadder();
        return;
    }
    const h = el.closest('[data-hist]');
    if (h && (el.closest('button') || !hasSelection()))
        openHist(h.dataset.hist); // memblok teks di judul tidak membuka histori
});
$('app').addEventListener('scroll', (e) => {
    if (e.target.id === 'ladwrap' && Date.now() > progUntil)
        ladFollow = false;
}, true);
$('hdlg').addEventListener('click', (e) => {
    const t = e.target;
    if (t.id === 'hx')
        return $('hdlg').close();
    const tab = t.closest('[data-htab]');
    if (tab)
        openHist(tab.dataset.htab);
});
$('hdlg').addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'hlim') {
        histLimit = Number(t.value);
        updateHist();
    }
    if (t.id === 'hflt') {
        histFilter = t.value;
        updateHist();
    }
});
// ---------- dialog config
$('bcfg').onclick = async () => {
    $('err').textContent = '';
    const raw = await (await fetch('/api/config')).text();
    try {
        $('ta').value = JSON.stringify(JSON.parse(raw), null, 2);
    }
    catch {
        $('ta').value = raw;
    }
    $('dlg').showModal();
};
$('bx').onclick = () => $('dlg').close();
$('bs').onclick = async () => {
    const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: $('ta').value });
    if (r.ok)
        $('dlg').close();
    else
        $('err').textContent = (await r.json()).detail;
};
function tgMsg(t, ok = false) { const m = $('tgmsg'); m.textContent = t; m.className = ok ? 'ok' : ''; }
async function tgRefresh() {
    const j = (await (await fetch('/api/telegram')).json());
    const kv = [
        ['Kredensial', j.configured ? '<b class="up">terpasang</b>' : '<b class="dn">belum</b> — isi telegram.json (token + chat_id)'],
        ['Notifikasi otomatis', j.enabled ? '<b class="up">aktif</b>' : '<b class="am">mati</b>'],
        ['Chat', j.chat ?? '–'], ['Terkirim', String(j.sent)], ['Terakhir', j.last_sent ? `${j.last_sent}${j.last_reason ? ' · ' + j.last_reason : ''}` : '–'],
    ];
    if (j.last_error)
        kv.push(['Error terakhir', `<span class="dn">${j.last_error}</span>`]);
    $('tgst').innerHTML = kv.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('');
    $('tgta').value = JSON.stringify(j.settings, null, 2).replace(/\[\s+([^\]]*?)\s+\]/g, (_m, g) => `[${g.replace(/\s*\n\s*/g, ' ')}]`);
}
async function tgPost(path, body) {
    tgMsg('mengirim…', true);
    const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const j = (await r.json());
    if (r.ok)
        tgMsg('Berhasil.', true);
    else
        tgMsg(j.detail ?? 'Gagal');
    void tgRefresh();
}
$('btg').onclick = () => { tgMsg(''); void tgRefresh(); $('tgdlg').showModal(); };
$('tgx').onclick = () => $('tgdlg').close();
$('tgsend').onclick = () => void tgPost('/api/telegram/send');
$('tgtest').onclick = () => void tgPost('/api/telegram/test');
$('tgsave').onclick = () => void tgPost('/api/telegram/settings', $('tgta').value);
if (new URLSearchParams(location.search).has('embed'))
    document.body.classList.add('embed'); // ?embed=1 -> tanpa logo, untuk dipasang di halaman lain
setInterval(showStatus, 3000);
setInterval(updateAge, 250);
connect();
