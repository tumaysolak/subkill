'use strict';

const api = window.subkill;

// Testlerin ve hata ayiklamanin yakalayabilmesi icin sessiz hatalari topla.
window.__subkillErrors = [];
window.addEventListener('error', (e) => {
  window.__subkillErrors.push(String((e.error && e.error.message) || e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  window.__subkillErrors.push(String((e.reason && e.reason.message) || e.reason));
});

let state = null;
let currentView = 'panel';
let scanResults = null;

/* ---------------- yardimcilar ---------------- */

const CYCLE_LABELS = {
  monthly: 'Aylık', yearly: 'Yıllık', quarterly: '3 aylık',
  weekly: 'Haftalık', usage: 'Kullanım', onetime: 'Tek seferlik'
};

const STATUS_LABELS = {
  active: 'Aktif', trial: 'Deneme', cancelled: 'İptal', paused: 'Duraklatıldı'
};

const CURRENCY_SYMBOLS = { USD: '$', EUR: '€', GBP: '£', TRY: '₺' };

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function tl(amount) {
  const n = Math.round(Number(amount) || 0);
  return `${n.toLocaleString('tr-TR')} ₺`;
}

function native(amount, currency) {
  const sym = CURRENCY_SYMBOLS[currency] || '';
  const n = Number(amount) || 0;
  const s = n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  return currency === 'TRY' ? `${s} ₺` : `${sym}${s}`;
}

function shortDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' });
}

function monthLabel(key) {
  const [y, m] = key.split('-');
  const names = ['Oca', 'Sub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Agu', 'Eyl', 'Eki', 'Kas', 'Ara'];
  return `${names[Number(m) - 1]} ${y.slice(2)}`;
}

let toastTimer;
function toast(message, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, kind === 'err' ? 7000 : 3500);
}

function closeModal() {
  document.getElementById('modalBackdrop').hidden = true;
  document.getElementById('modal').innerHTML = '';
}

function openModal(title, bodyNode, footNodes) {
  const modal = document.getElementById('modal');
  modal.innerHTML = '';
  modal.appendChild(el('h3', { text: title }));
  modal.appendChild(el('div', { class: 'modal-body' }, bodyNode));
  if (footNodes) modal.appendChild(el('div', { class: 'modal-foot' }, footNodes));
  document.getElementById('modalBackdrop').hidden = false;
}

/* ---------------- durum ---------------- */

async function refresh(next) {
  state = next || await api.getState();
  document.getElementById('navCount').textContent = state.subscriptions.length || '';
  const s = state.settings;
  document.getElementById('fxInfo').textContent = s.ratesUpdatedAt
    ? `1$ = ${Number(s.rates.USD).toFixed(2)} ₺ · ${shortDate(s.ratesUpdatedAt)}`
    : `1$ = ${Number(s.rates.USD).toFixed(2)} ₺ · elle`;
  render();
}

function setView(view) {
  currentView = view;
  for (const b of document.querySelectorAll('#nav button')) {
    b.classList.toggle('active', b.dataset.view === view);
  }
  const titles = {
    panel: 'Panel', abonelikler: 'Abonelikler', takvim: 'Yenileme takvimi',
    kartlar: 'Kartlar', tarama: 'Tarama', ayarlar: 'Ayarlar'
  };
  document.getElementById('viewTitle').textContent = titles[view] || view;
  render();
}

function render() {
  const root = document.getElementById('view');
  root.innerHTML = '';
  const fn = {
    panel: viewPanel, abonelikler: viewList, takvim: viewCalendar,
    kartlar: viewCards, tarama: viewScan, ayarlar: viewSettings
  }[currentView];
  root.appendChild(fn());
  root.scrollTop = 0;
}

/* ---------------- panel ---------------- */

function viewPanel() {
  const c = state.computed;
  const wrap = document.createDocumentFragment();

  const dormantYearly = c.dormant.reduce((a, d) => a + d.yearly, 0);
  const overlapMonthly = c.overlaps.reduce((a, o) => a + o.potentialMonthlySaving, 0);

  wrap.appendChild(el('div', { class: 'stats' }, [
    stat('Aylık yük', tl(c.summary.monthly), `${c.summary.count} aktif abonelik`),
    stat('Yıllık yük', tl(c.summary.yearly), 'bugünkü kurla'),
    stat('Kullanılmayanlar', tl(dormantYearly), `${c.dormant.length} abonelik · yıllık`, 'kill'),
    stat('Çakışma tasarrufu', tl(overlapMonthly * 12), `${c.overlaps.length} kategoride · yıllık`, 'good')
  ]));

  // Uyarilar
  const alerts = el('div', { class: 'panel' }, [
    el('h3', {}, ['Aksiyon listesi', el('small', { text: `${c.alerts.length} madde` })])
  ]);
  const body = el('div', { class: 'panel-body tight' });
  if (!c.alerts.length) {
    body.appendChild(el('div', { class: 'empty', text: 'Uyarı yok. Önce Gmail taraması yapıp envanteri kurun.' }));
  } else {
    for (const a of c.alerts.slice(0, 14)) {
      body.appendChild(el('div', { class: `alert ${a.level}` }, [
        el('div', { class: 'dot' }),
        el('div', {}, [
          el('div', { class: 't', text: a.title }),
          el('div', { class: 'd', text: a.detail })
        ])
      ]));
    }
  }
  alerts.appendChild(body);
  wrap.appendChild(alerts);

  // Yaklasan yenilemeler
  const up = el('div', { class: 'panel' }, [el('h3', {}, ['Yaklaşan yenilemeler', el('small', { text: '45 gün' })])]);
  const upBody = el('div', { class: 'panel-body tight' });
  if (!c.upcoming.length) {
    upBody.appendChild(el('div', { class: 'empty', text: 'Yaklaşan yenileme yok.' }));
  } else {
    const t = el('table');
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Servis' }), el('th', { text: 'Tarih' }),
      el('th', { text: 'Kart' }), el('th', { class: 'num', text: 'Tutar' })
    ])));
    const tb = el('tbody');
    for (const u of c.upcoming.slice(0, 12)) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { class: 'row-name', text: u.sub.name })]),
        el('td', { text: `${shortDate(u.sub.nextRenewal)} · ${u.inDays} gün` }),
        el('td', { text: u.sub.cardLast4 || '—' }),
        el('td', { class: 'num', text: native(u.sub.amount, u.sub.currency) })
      ]));
    }
    t.appendChild(tb);
    upBody.appendChild(t);
  }
  up.appendChild(upBody);
  wrap.appendChild(up);

  // Cakismalar
  if (c.overlaps.length) {
    const ov = el('div', { class: 'panel' }, [el('h3', {}, ['Birbirinin işini yapanlar'])]);
    const ovBody = el('div', { class: 'panel-body tight' });
    for (const o of c.overlaps) {
      ovBody.appendChild(el('div', { class: 'alert bilgi' }, [
        el('div', { class: 'dot' }),
        el('div', {}, [
          el('div', { class: 't', text: `${o.categoryLabel} — ${o.count} abonelik` }),
          el('div', {
            class: 'd',
            text: o.items.map((i) => `${i.sub.name} (${tl(i.monthly)}/ay${i.idleDays !== null ? `, ${i.idleDays} gün önce kullanıldı` : ''})`).join('  ·  ')
          }),
          el('div', { class: 'd', text: `Tek servise inersen yılda ${tl(o.potentialMonthlySaving * 12)} kalır.` })
        ])
      ]));
    }
    ov.appendChild(ovBody);
    wrap.appendChild(ov);
  }

  return wrap;
}

function stat(label, value, sub, kind) {
  return el('div', { class: `stat ${kind || ''}` }, [
    el('div', { class: 'label', text: label }),
    el('div', { class: 'value', text: value }),
    el('div', { class: 'sub', text: sub })
  ]);
}

/* ---------------- abonelik listesi ---------------- */

let listFilter = { text: '', status: '', category: '' };

function viewList() {
  const wrap = document.createDocumentFragment();

  const search = el('input', {
    type: 'text', class: 'grow', placeholder: 'Servis ara...', value: listFilter.text,
    oninput: (e) => { listFilter.text = e.target.value; renderTable(); }
  });

  const statusSel = el('select', {
    onchange: (e) => { listFilter.status = e.target.value; renderTable(); }
  }, [
    el('option', { value: '', text: 'Tüm durumlar' }),
    ...Object.entries(STATUS_LABELS).map(([v, t]) => el('option', { value: v, text: t, selected: listFilter.status === v }))
  ]);

  const catSel = el('select', {
    onchange: (e) => { listFilter.category = e.target.value; renderTable(); }
  }, [
    el('option', { value: '', text: 'Tüm kategoriler' }),
    ...Object.entries(state.categories).map(([v, t]) => el('option', { value: v, text: t, selected: listFilter.category === v }))
  ]);

  wrap.appendChild(el('div', { class: 'filters' }, [search, statusSel, catSel]));

  const panel = el('div', { class: 'panel' });
  const body = el('div', { class: 'panel-body tight', id: 'listBody' });
  panel.appendChild(body);
  wrap.appendChild(panel);

  setTimeout(renderTable, 0);
  return wrap;
}

function filteredSubs() {
  const q = listFilter.text.toLowerCase();
  return state.subscriptions.filter((s) => {
    if (q && !`${s.name} ${s.plan || ''} ${s.notes || ''}`.toLowerCase().includes(q)) return false;
    if (listFilter.status && s.status !== listFilter.status) return false;
    if (listFilter.category && s.category !== listFilter.category) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}

function renderTable() {
  const body = document.getElementById('listBody');
  if (!body) return;
  body.innerHTML = '';
  const rows = filteredSubs();

  if (!rows.length) {
    body.appendChild(el('div', {
      class: 'empty',
      text: state.subscriptions.length ? 'Filtreye uyan kayıt yok.' : 'Henüz abonelik yok. Tarama sekmesinden Gmail makbuzlarını tarayın.'
    }));
    return;
  }

  const t = el('table');
  t.appendChild(el('thead', {}, el('tr', {}, [
    el('th', { text: 'Servis' }), el('th', { text: 'Periyot' }),
    el('th', { class: 'num', text: 'Tutar' }), el('th', { class: 'num', text: 'Aylık (TL)' }),
    el('th', { text: 'Yenileme' }), el('th', { text: 'Kart' }),
    el('th', { text: 'Son kullanım' }), el('th', { text: 'Durum' })
  ])));

  const tb = el('tbody');
  const rates = state.settings.rates;
  for (const s of rows) {
    const perMonth = { monthly: 1, yearly: 1 / 12, quarterly: 1 / 3, weekly: 4.345, usage: 1, onetime: 0 }[s.cycle] || 1;
    const monthlyTl = (Number(s.amount) || 0) * perMonth * (rates[s.currency] || 1);
    const idle = s.lastUsedAt ? Math.round((Date.now() - new Date(s.lastUsedAt + 'T00:00:00Z').getTime()) / 86400000) : null;

    const tr = el('tr', { onclick: () => openSubForm(s) }, [
      el('td', {}, [
        el('div', { class: 'row-name', text: s.name }),
        el('div', { class: 'row-sub', text: [s.plan, state.categories[s.category]].filter(Boolean).join(' · ') })
      ]),
      el('td', { text: CYCLE_LABELS[s.cycle] || s.cycle }),
      el('td', { class: 'num', text: native(s.amount, s.currency) }),
      el('td', { class: 'num', text: tl(monthlyTl) }),
      el('td', { text: shortDate(s.nextRenewal) }),
      el('td', { text: s.cardLast4 || '—' }),
      el('td', {}, [idle === null
        ? el('span', { class: 'tag', text: 'bilinmiyor' })
        : el('span', { class: `tag ${idle > (state.settings.dormantDays || 60) ? 'idle' : ''}`, text: `${idle} gün` })]),
      el('td', {}, [el('span', { class: `tag ${s.status}`, text: STATUS_LABELS[s.status] || s.status })])
    ]);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  body.appendChild(t);
}

/* ---------------- abonelik formu ---------------- */

function openSubForm(sub) {
  const s = sub || { status: 'active', currency: 'USD', cycle: 'monthly' };
  const f = {};

  const input = (key, label, opts = {}) => {
    const node = el('input', {
      type: opts.type || 'text',
      value: s[key] === undefined || s[key] === null ? '' : s[key],
      placeholder: opts.placeholder || ''
    });
    f[key] = node;
    return el('div', { class: `field ${opts.full ? 'full' : ''}` }, [el('label', { text: label }), node]);
  };

  const select = (key, label, options) => {
    const node = el('select', {}, options.map(([v, t]) =>
      el('option', { value: v, text: t, selected: s[key] === v })));
    f[key] = node;
    return el('div', { class: 'field' }, [el('label', { text: label }), node]);
  };

  const body = el('div', { class: 'form-grid' }, [
    input('name', 'Servis adı', { full: true, placeholder: 'Anthropic Claude' }),
    input('plan', 'Plan', { placeholder: 'Max 20x' }),
    select('category', 'Kategori', Object.entries(state.categories)),
    input('amount', 'Tutar', { type: 'number', placeholder: '200' }),
    select('currency', 'Para birimi', [['USD', 'USD'], ['EUR', 'EUR'], ['GBP', 'GBP'], ['TRY', 'TRY']]),
    select('cycle', 'Periyot', Object.entries(CYCLE_LABELS)),
    select('status', 'Durum', Object.entries(STATUS_LABELS)),
    input('nextRenewal', 'Sonraki yenileme', { type: 'date' }),
    input('trialEndsAt', 'Deneme bitişi', { type: 'date' }),
    input('cardLast4', 'Kart son 4 hane', { placeholder: '2559' }),
    input('billingEmail', 'Fatura hangi adrese geliyor', { placeholder: 'ornek@gmail.com' }),
    select('loginMethod', 'Giriş yöntemi', [
      ['', 'Seçilmedi'], ['google', 'Google ile giriş'], ['apple', 'Apple ile giriş'],
      ['email', 'E-posta + şifre'], ['sso', 'Kurumsal SSO'], ['magic', 'E-posta linki']
    ]),
    input('loginEmail', 'Giriş adresi', { placeholder: 'hangi hesapla giriyorsun' }),
    input('site', 'Alan adı', { placeholder: 'claude.ai' }),
    input('lastUsedAt', 'Son kullanım', { type: 'date' }),
    el('div', { class: 'field full' }, [
      el('label', { text: 'Not' }),
      (f.notes = el('textarea', { rows: 2, placeholder: 'Şifre yazmayın. Şifre yöneticinizde hangi kayıtla durduğunu yazabilirsiniz.' }))
    ]),
    el('div', { class: 'field full' }, [
      el('div', { class: 'hint', text: 'SubKill parola saklamaz. Burada yalnızca hangi hesapla giriş yaptığınız tutulur.' })
    ])
  ]);
  f.notes.value = s.notes || '';

  const save = async () => {
    const payload = {};
    if (s.id) payload.id = s.id;
    for (const [k, node] of Object.entries(f)) payload[k] = node.value.trim ? node.value.trim() : node.value;
    if (!payload.name) { toast('Servis adı gerekli.', 'err'); return; }
    payload.amount = Number(payload.amount) || 0;
    await refresh(await api.upsertSubscription(payload));
    closeModal();
    toast('Kaydedildi.', 'ok');
  };

  const foot = [
    s.id ? el('button', {
      class: 'danger',
      text: 'Sil',
      onclick: async () => {
        await refresh(await api.removeSubscription(s.id));
        closeModal();
        toast('Silindi.');
      }
    }) : null,
    el('button', { class: 'ghost', text: 'Vazgeç', onclick: closeModal }),
    el('button', { class: 'primary', text: 'Kaydet', onclick: save })
  ].filter(Boolean);

  openModal(s.id ? s.name : 'Yeni abonelik', body, foot);
}

/* ---------------- takvim ---------------- */

function viewCalendar() {
  const wrap = document.createDocumentFragment();
  const cal = state.computed.calendar;
  const max = Math.max(1, ...cal.map((c) => c.total));
  const avg = cal.reduce((a, c) => a + c.total, 0) / (cal.length || 1);

  wrap.appendChild(el('div', { class: 'stats' }, [
    stat('12 aylık toplam', tl(cal.reduce((a, c) => a + c.total, 0)), 'önümüzdeki bir yıl'),
    stat('Ortalama ay', tl(avg), 'aylık ortalama yük'),
    stat('En ağır ay', tl(max), monthLabel(cal.find((c) => c.total === max).month), 'kill')
  ]));

  const panel = el('div', { class: 'panel' }, [el('h3', {}, ['Aylık dağılım', el('small', { text: 'yıllık yenilemeler düştüğü ayda görünür' })])]);
  const body = el('div', { class: 'panel-body' });
  const bars = el('div', { class: 'bars' });

  for (const m of cal) {
    const pct = Math.round((m.total / max) * 100);
    const row = el('div', { class: 'bar-row' }, [
      el('div', { class: 'bar-label', text: monthLabel(m.month) }),
      el('div', { class: 'bar-track' }, [
        el('div', { class: `bar-fill ${m.total > avg * 1.35 ? 'peak' : ''}`, style: `width:${pct}%` })
      ]),
      el('div', { class: 'bar-value', text: tl(m.total) })
    ]);
    row.title = m.items.slice(0, 8).map((i) => `${i.sub.name}: ${tl(i.amount)}`).join('\n');
    bars.appendChild(row);
  }
  body.appendChild(bars);
  panel.appendChild(body);
  wrap.appendChild(panel);
  return wrap;
}

/* ---------------- kartlar ---------------- */

function viewCards() {
  const wrap = document.createDocumentFragment();
  const loads = state.computed.cardLoad;
  const cards = state.cards.slice();

  const panel = el('div', { class: 'panel' }, [
    el('h3', {}, ['Bu ayki kart yükü', el('small', { text: 'limit tanımlayınca aşım uyarısı verir' })])
  ]);
  const body = el('div', { class: 'panel-body tight' });

  if (!loads.length) {
    body.appendChild(el('div', { class: 'empty', text: 'Henüz kart bilgisi yok.' }));
  } else {
    const t = el('table');
    t.appendChild(el('thead', {}, el('tr', {}, [
      el('th', { text: 'Kart' }), el('th', { text: 'Etiket' }),
      el('th', { class: 'num', text: 'Bu ay' }), el('th', { class: 'num', text: 'Limit' }),
      el('th', { text: 'Durum' }), el('th', { class: 'num', text: 'Kalem' })
    ])));
    const tb = el('tbody');
    for (const c of loads) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { class: 'row-name', text: c.last4 })]),
        el('td', { text: c.label || '—' }),
        el('td', { class: 'num', text: tl(c.total) }),
        el('td', { class: 'num', text: c.limit ? tl(c.limit) : '—' }),
        el('td', {}, [el('span', {
          class: `tag ${c.over ? 'idle' : c.warning ? 'trial' : 'active'}`,
          text: c.over ? 'Limit aşılıyor' : c.warning ? `%${Math.round(c.usageRatio * 100)}` : 'Rahat'
        })]),
        el('td', { class: 'num', text: String(c.items.length) })
      ]));
    }
    t.appendChild(tb);
    body.appendChild(t);
  }
  panel.appendChild(body);
  wrap.appendChild(panel);

  // Kart tanimlari
  const edit = el('div', { class: 'panel' }, [el('h3', {}, ['Kart tanımları ve limitler'])]);
  const editBody = el('div', { class: 'panel-body' });
  const list = el('div');

  function drawRows() {
    list.innerHTML = '';
    cards.forEach((c, i) => {
      list.appendChild(el('div', { class: 'filters' }, [
        el('input', { type: 'text', value: c.last4 || '', placeholder: 'Son 4 hane', oninput: (e) => { cards[i].last4 = e.target.value.trim(); } }),
        el('input', { type: 'text', class: 'grow', value: c.label || '', placeholder: 'Etiket (ana kart, iş kartı...)', oninput: (e) => { cards[i].label = e.target.value; } }),
        el('input', { type: 'number', value: c.monthlyLimit || '', placeholder: 'Aylık limit (TL)', oninput: (e) => { cards[i].monthlyLimit = Number(e.target.value) || 0; } }),
        el('button', { class: 'danger small', text: 'Sil', onclick: () => { cards.splice(i, 1); drawRows(); } })
      ]));
    });
  }
  drawRows();

  editBody.appendChild(list);
  editBody.appendChild(el('div', { class: 'filters' }, [
    el('button', { class: 'ghost', text: '+ Kart ekle', onclick: () => { cards.push({ last4: '', label: '', monthlyLimit: 0 }); drawRows(); } }),
    el('button', {
      class: 'primary',
      text: 'Kaydet',
      onclick: async () => {
        await refresh(await api.saveCards(cards.filter((c) => c.last4)));
        toast('Kartlar kaydedildi.', 'ok');
      }
    })
  ]));
  edit.appendChild(editBody);
  wrap.appendChild(edit);

  return wrap;
}

/* ---------------- tarama ---------------- */

function viewScan() {
  const wrap = document.createDocumentFragment();

  const userInput = el('input', { type: 'text', class: 'grow', value: state.settings.gmailUser || '', placeholder: 'ornek@gmail.com' });
  const passInput = el('input', { type: 'password', class: 'grow', placeholder: 'Google uygulama şifresi (16 hane)' });

  const gmailPanel = el('div', { class: 'panel' }, [el('h3', {}, ['Gmail makbuz taraması'])]);
  const gBody = el('div', { class: 'panel-body' }, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Gmail adresi' }), userInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Uygulama şifresi' }), passInput]),
      el('div', { class: 'field full' }, [
        el('div', { class: 'hint' }, [
          'Hesap parolanız değil, Google hesabınızdan üretilen 16 haneli uygulama şifresi gerekir. ',
          el('a', { text: 'myaccount.google.com/apppasswords', onclick: () => api.openExternal('https://myaccount.google.com/apppasswords') }),
          ' adresinden üretebilirsiniz. Şifre işletim sisteminin güvenli kasasında saklanır, veri dosyasına yazılmaz.'
        ])
      ])
    ]),
    el('div', { class: 'filters' }, [
      el('button', {
        class: 'ghost',
        text: 'Bağlantıyı test et',
        onclick: async (e) => {
          e.target.disabled = true;
          const r = await api.gmailTest({ user: userInput.value.trim(), appPassword: passInput.value.trim() });
          e.target.disabled = false;
          toast(r.ok ? 'Bağlantı başarılı.' : r.error, r.ok ? 'ok' : 'err');
        }
      }),
      el('button', { class: 'primary', text: 'Makbuzları tara', id: 'btnScan', onclick: startScan })
    ]),
    el('div', { class: 'progress', id: 'scanProgress', hidden: true }, [el('div')])
  ]);
  gmailPanel.appendChild(gBody);
  wrap.appendChild(gmailPanel);

  async function startScan(e) {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Taranıyor...';
    document.getElementById('scanProgress').hidden = false;

    const stop = api.onProgress((p) => {
      const bar = document.querySelector('#scanProgress > div');
      if (bar && p.total) bar.style.width = `${Math.round((p.done / p.total) * 100)}%`;
    });

    const r = await api.gmailScan({ user: userInput.value.trim(), appPassword: passInput.value.trim() });
    stop();
    btn.disabled = false;
    btn.textContent = 'Makbuzları tara';
    document.getElementById('scanProgress').hidden = true;

    if (!r.ok) { toast(r.error, 'err'); return; }
    scanResults = r.records;
    toast(`${r.scanned} mail tarandı, ${r.records.length} servis bulundu.`, 'ok');
    render();
  }

  if (scanResults && scanResults.length) {
    const checks = [];
    const resPanel = el('div', { class: 'panel' }, [
      el('h3', {}, ['Bulunanlar', el('small', { text: `${scanResults.length} servis` })])
    ]);
    const resBody = el('div', { class: 'panel-body tight' });

    for (const rec of scanResults) {
      const cb = el('input', { type: 'checkbox', checked: true });
      checks.push({ cb, rec });
      const known = state.subscriptions.some((s) => s.name.toLowerCase() === rec.name.toLowerCase());
      resBody.appendChild(el('div', { class: 'checkline' }, [
        cb,
        el('div', {}, [
          el('div', { class: 'row-name', text: rec.name }),
          el('div', { class: 'row-sub', text: `${state.categories[rec.category] || rec.category}${rec.chargeCount > 1 ? ` · ${rec.chargeCount} makbuz` : ''}` })
        ]),
        el('div', { class: 'meta' }, [
          el('div', { text: `${native(rec.amount, rec.currency)} · ${CYCLE_LABELS[rec.cycle] || rec.cycle}` }),
          el('div', { text: `${rec.cardLast4 ? `kart ${rec.cardLast4} · ` : ''}${known ? 'mevcut kayıt güncellenir' : 'yeni'}` })
        ])
      ]));
    }

    resBody.appendChild(el('div', { class: 'filters', style: 'padding:12px' }, [
      el('button', {
        class: 'primary',
        text: 'Seçilenleri envantere ekle',
        onclick: async () => {
          const picked = checks.filter((c) => c.cb.checked).map((c) => c.rec);
          const r = await api.gmailApply(picked);
          scanResults = null;
          await refresh(r.state);
          toast(`${r.result.added} yeni, ${r.result.updated} güncellendi.`, 'ok');
        }
      }),
      el('button', { class: 'ghost', text: 'Sonuçları temizle', onclick: () => { scanResults = null; render(); } })
    ]));

    resPanel.appendChild(resBody);
    wrap.appendChild(resPanel);
  }

  // CSV
  const csv = el('div', { class: 'panel' }, [el('h3', {}, ['Tablo ile çalış'])]);
  csv.appendChild(el('div', { class: 'panel-body' }, [
    el('div', { class: 'hint', text: 'Mevcut Excel/CSV listenizi içeri aktarabilir, envanteri dışarı aktarıp tabloda çalışabilirsiniz. Aynı isimli servisler güncellenir, yenileri eklenir.' }),
    el('div', { class: 'filters', style: 'margin-top:12px' }, [
      el('button', {
        class: 'ghost',
        text: 'CSV içeri aktar',
        onclick: async () => {
          const r = await api.importCsv();
          if (r.ok) { await refresh(r.state); toast(`${r.result.added} yeni, ${r.result.updated} güncellendi.`, 'ok'); }
          else if (r.error) toast(r.error, 'err');
        }
      }),
      el('button', {
        class: 'ghost',
        text: 'CSV dışarı aktar',
        onclick: async () => {
          const r = await api.exportCsv();
          if (r.ok) toast('CSV kaydedildi.', 'ok');
        }
      })
    ])
  ]));
  wrap.appendChild(csv);

  return wrap;
}

/* ---------------- ayarlar ---------------- */

function viewSettings() {
  const wrap = document.createDocumentFragment();
  const s = state.settings;

  const dormant = el('input', { type: 'number', value: s.dormantDays, min: 7 });
  const lookback = el('input', { type: 'number', value: s.lookbackDays, min: 30 });
  const usd = el('input', { type: 'number', value: s.rates.USD, step: '0.01' });
  const eur = el('input', { type: 'number', value: s.rates.EUR, step: '0.01' });
  const gbp = el('input', { type: 'number', value: s.rates.GBP, step: '0.01' });

  const panel = el('div', { class: 'panel' }, [el('h3', {}, ['Eşikler ve kurlar'])]);
  panel.appendChild(el('div', { class: 'panel-body' }, [
    el('div', { class: 'form-grid' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Kullanılmadı sayılma eşiği (gün)' }), dormant]),
      el('div', { class: 'field' }, [el('label', { text: 'Gmail geriye dönük tarama (gün)' }), lookback]),
      el('div', { class: 'field' }, [el('label', { text: 'USD/TRY' }), usd]),
      el('div', { class: 'field' }, [el('label', { text: 'EUR/TRY' }), eur]),
      el('div', { class: 'field' }, [el('label', { text: 'GBP/TRY' }), gbp])
    ]),
    el('div', { class: 'filters', style: 'margin-top:14px' }, [
      el('button', {
        class: 'primary',
        text: 'Kaydet',
        onclick: async () => {
          await refresh(await api.saveSettings({
            dormantDays: Number(dormant.value) || 60,
            lookbackDays: Number(lookback.value) || 400,
            rates: { TRY: 1, USD: Number(usd.value) || 1, EUR: Number(eur.value) || 1, GBP: Number(gbp.value) || 1 }
          }));
          toast('Ayarlar kaydedildi.', 'ok');
        }
      }),
      el('button', { class: 'ghost', text: 'TCMB kurunu çek', onclick: refreshRates })
    ])
  ]));
  wrap.appendChild(panel);

  const data = el('div', { class: 'panel' }, [el('h3', {}, ['Veri'])]);
  const pathLine = el('div', { class: 'hint', text: 'Veri dosyası yükleniyor...' });
  api.dataPath().then((p) => { pathLine.textContent = `Tüm veriler bu dosyada, bilgisayarınızda: ${p}`; });

  data.appendChild(el('div', { class: 'panel-body' }, [
    pathLine,
    el('div', { class: 'filters', style: 'margin-top:12px' }, [
      el('button', { class: 'ghost', text: 'Yedek al (JSON)', onclick: async () => { const r = await api.exportData(); if (r.ok) toast('Yedek kaydedildi.', 'ok'); } }),
      el('button', {
        class: 'ghost',
        text: 'Yedekten yükle',
        onclick: async () => {
          const r = await api.importData();
          if (r.ok) { await refresh(r.state); toast('Veri yüklendi.', 'ok'); }
          else if (r.error) toast(r.error, 'err');
        }
      })
    ]),
    el('div', { class: 'hint', style: 'margin-top:12px', text: 'Yedek dosyasını iCloud Drive veya OneDrive klasörüne koyarsanız başka bir bilgisayarda aynı envanteri açabilirsiniz. SubKill hiçbir veriyi internete göndermez.' })
  ]));
  wrap.appendChild(data);

  return wrap;
}

async function refreshRates() {
  const r = await api.refreshRates();
  if (r.ok) { await refresh(r.state); toast(`Kur güncellendi: 1$ = ${Number(r.rates.USD).toFixed(2)} ₺`, 'ok'); }
  else toast(r.error, 'err');
}

/* ---------------- baslangic ---------------- */

document.getElementById('nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-view]');
  if (btn) setView(btn.dataset.view);
});

document.getElementById('btnNew').addEventListener('click', () => openSubForm(null));
document.getElementById('btnRates').addEventListener('click', refreshRates);

document.getElementById('btnUsage').addEventListener('click', async (e) => {
  e.target.disabled = true;
  e.target.textContent = 'Taranıyor...';
  const r = await api.scanUsage();
  e.target.disabled = false;
  e.target.textContent = 'Kullanımı tara';
  if (!r.ok) { toast(r.error, 'err'); return; }
  await refresh(r.state);
  toast(`${r.profiles} tarayıcı profili okundu, ${r.matched} abonelikte son kullanım güncellendi.`, 'ok');
});

document.getElementById('modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

refresh();
