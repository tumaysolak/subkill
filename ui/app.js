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
  window.__subkillState = state; // testlerin durumu okuyabilmesi icin
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
    tarama: 'Tarama', ayarlar: 'Ayarlar'
  };
  document.getElementById('viewTitle').textContent = titles[view] || view;
  render();
}

function render() {
  const root = document.getElementById('view');
  root.innerHTML = '';
  const fn = {
    panel: viewPanel, abonelikler: viewList, takvim: viewCalendar,
    tarama: viewScan, ayarlar: viewSettings
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
      el('th', { class: 'num', text: 'Tutar' })
    ])));
    const tb = el('tbody');
    for (const u of c.upcoming.slice(0, 12)) {
      tb.appendChild(el('tr', {}, [
        el('td', {}, [el('div', { class: 'row-name', text: u.sub.name })]),
        el('td', { text: `${shortDate(u.sub.nextRenewal)} · ${u.inDays} gün` }),
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
    el('th', { text: 'Yenileme' }),
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

/* ---------------- ilk kurulum rehberi ---------------- */

/**
 * Uygulama ilk acildiginda ne yapilacagi anlasilmiyordu; dort adimlik bir
 * rehber gosteriliyor. Bittiginde ayarlara "onboarded" yaziliyor, bir daha
 * kendiliginden acilmiyor. Ayarlar sekmesinden yeniden acilabiliyor.
 */
const ONBOARD_STEPS = [
  {
    title: 'SubKill ne işe yarar',
    build: () => el('div', { class: 'guide' }, [
      el('p', { class: 'guide-lead', text: 'Abonelikleriniz çoğaldıkça hangisinin ne zaman, ne kadar çektiğini takip etmek zorlaşır. SubKill bunu tek panelde toplar ve üç soruyu cevaplar:' }),
      el('ul', { class: 'bullets' }, [
        el('li', { text: 'Bu ay toplam ne ödeyeceğim?' }),
        el('li', { text: 'Hangi abonelik sessizce bitmiş, hâlâ listede duruyor?' }),
        el('li', { text: 'Hangi aboneliğe aylardır girmedim, yıllık kaç para tutuyor?' }),
        el('li', { text: 'Hangi iki abonelik aynı işi yapıyor?' }),
      ]),
      el('div', { class: 'guide-note ok' }, [
        el('strong', { text: 'Her şey bu bilgisayarda kalır. ' }),
        'Sunucu yok, hesap yok, telemetri yok. Servislerin parolaları hiçbir zaman istenmez.'
      ])
    ])
  },
  {
    title: 'Adım 1 · Gmail makbuzlarını tarayın',
    build: () => el('div', {}, [
      el('p', { class: 'guide-lead', text: 'En hızlı başlangıç bu. SubKill posta kutunuzdaki fatura ve makbuz maillerini okuyup abonelik listesini kendisi çıkarır; servis adı, tutar, para birimi, ödeme periyodu ve yenileme tarihi otomatik gelir. İptal bildirimlerini de tanır ve o abonelikleri iptal olarak işaretler.' }),
      el('div', { class: 'guide-note ok' }, [
        el('strong', { text: 'Birden fazla hesap: ' }),
        'İstediğiniz kadar Gmail hesabı ekleyebilirsiniz. Hepsi birlikte taranır; aynı servis iki hesapta çıkarsa tek kayıtta birleşir.'
      ]),
      gmailGuide(),
      el('div', { class: 'guide-note' }, [
        'Şimdi yapmak istemiyorsanız sorun değil: abonelikleri elle de ekleyebilirsiniz. ',
        'Gmail bağlantısını sonra Tarama sekmesinden kurabilirsiniz.'
      ])
    ])
  },
  {
    title: 'Adım 2 · Kullanımı tarayın',
    build: () => el('div', { class: 'guide' }, [
      el('p', { class: 'guide-lead', text: 'Sağ üstteki "Kullanımı tara" düğmesi, tarayıcı geçmişinizi okuyup her servise en son ne zaman girdiğinizi bulur. Bu tarama tamamen bu bilgisayarda yapılır; sonuç olarak yalnızca "hangi servise en son ne zaman girildi" bilgisi saklanır.' }),
      el('p', { text: 'Bu adımdan sonra Panel sekmesi size şunu söyleyebilir hale gelir: "Şu aboneliğe 4 aydır girmemişsin, yıllık şu kadar tutuyor."' }),
      el('div', { class: 'guide-note ok' }, [
        el('strong', { text: 'Bundan sonrası kendiliğinden: ' }),
        'Otomatik tarama açık. Uygulama günde bir kez bağlı hesaplarınıza bakar, yeni makbuz geldiyse envantere ekler, iptal bildirimi geldiyse işaretler. Aralığı Ayarlar sekmesinden değiştirebilir, rehberi de oradan tekrar açabilirsiniz.'
      ])
    ])
  }
];

function openOnboarding(index = 0) {
  const step = ONBOARD_STEPS[index];
  const last = index === ONBOARD_STEPS.length - 1;

  const dots = el('div', { class: 'wizard-dots' },
    ONBOARD_STEPS.map((_, i) => el('span', { class: i === index ? 'on' : '' })));

  const foot = [
    dots,
    el('div', { class: 'wizard-btns' }, [
      index > 0
        ? el('button', { class: 'ghost', text: 'Geri', onclick: () => openOnboarding(index - 1) })
        : el('button', { class: 'ghost', text: 'Rehberi atla', onclick: finishOnboarding }),
      el('button', {
        class: 'primary',
        text: last ? 'Başla' : 'Devam',
        onclick: () => (last ? finishOnboarding() : openOnboarding(index + 1))
      })
    ])
  ];

  openModal(step.title, step.build(), foot);
}

async function finishOnboarding() {
  closeModal();
  try { await refresh(await api.saveSettings({ onboarded: true })); } catch (_) { /* kayit basarisiz olsa da devam */ }
}

/* ---------------- gmail uygulama sifresi rehberi ---------------- */

/**
 * Uygulama sifresi adimlarini anlatan blok.
 *
 * En sik takilinan yer: 2 Adimli Dogrulama kapaliyken Google uygulama sifresi
 * sayfasini hic acmiyor, kullanici "sayfa bulunamadi" goruyor. Bu yuzden o
 * sart en basta ve kalin yaziliyor.
 */
function gmailGuide() {
  const step = (no, title, children) => el('li', {}, [
    el('div', { class: 'step-no', text: String(no) }),
    el('div', { class: 'step-text' }, [el('strong', { text: title }), ...children])
  ]);

  return el('div', { class: 'guide' }, [
    el('p', { class: 'guide-lead' }, [
      'SubKill, Google hesabınızın kendi parolasını kullanamaz; Google buna izin vermiyor. ',
      'Bunun yerine sadece bu uygulamaya özel, 16 haneli bir ',
      el('strong', { text: 'uygulama şifresi' }),
      ' üretiyorsunuz. İstediğiniz an Google tarafından iptal edilebilir ve hesap parolanız değişmez.'
    ]),
    el('ol', { class: 'steps-list' }, [
      step(1, 'Önce 2 Adımlı Doğrulama açık olmalı.', [
        el('p', { text: 'Kapalıysa Google uygulama şifresi sayfasını hiç göstermez; "sayfa bulunamadı" alırsınız. Link çalışmıyorsa sebebi büyük ihtimalle budur.' }),
        el('button', {
          class: 'ghost small',
          text: '2 Adımlı Doğrulamayı aç',
          onclick: () => api.openExternal('https://myaccount.google.com/signinoptions/twosv')
        })
      ]),
      step(2, 'Uygulama şifresi üretin.', [
        el('p', { text: 'Açılan sayfada uygulamaya bir ad yazın (örnek: SubKill) ve Oluştur deyin.' }),
        el('button', {
          class: 'ghost small',
          text: 'Uygulama şifresi sayfasını aç',
          onclick: () => api.openExternal('https://myaccount.google.com/apppasswords')
        })
      ]),
      step(3, 'Çıkan 16 haneli şifreyi buraya yapıştırın.', [
        el('p', { text: 'Google şifreyi "abcd efgh ijkl mnop" gibi boşluklu gösterir. Boşlukları silmenize gerek yok, SubKill kendisi temizler.' })
      ])
    ]),
    el('div', { class: 'guide-note' }, [
      el('strong', { text: 'Sayfa açılmıyorsa: ' }),
      'Tarayıcınızda birden fazla Google hesabı açıksa sizi yanlış hesaba yönlendirebilir. ',
      'Yalnız bu hesapla açık bir pencere kullanın ya da adresi elle yazın: ',
      el('code', { text: 'myaccount.google.com/apppasswords' }),
      '. İş veya okul hesaplarında yöneticiniz bu özelliği kapatmış olabilir; o durumda kişisel bir Gmail hesabı kullanın.'
    ]),
    el('div', { class: 'guide-note ok' }, [
      el('strong', { text: 'Şifre nerede duruyor: ' }),
      'İşletim sisteminin güvenli kasasında (macOS Anahtar Zinciri, Windows DPAPI). ',
      'Veri dosyasına yazılmaz ve hiçbir sunucuya gönderilmez. Silmek için alanı boşaltıp yeniden kaydedin.'
    ])
  ]);
}

/* ---------------- tarama ---------------- */

function viewScan() {
  const wrap = document.createDocumentFragment();
  const accounts = state.settings.gmailAccounts || [];

  /* ---- bagli hesaplar ---- */

  const accPanel = el('div', { class: 'panel' }, [
    el('h3', {}, ['Bağlı Gmail hesapları', el('small', { text: accounts.length ? `${accounts.length} hesap` : 'henüz yok' })])
  ]);
  const accBody = el('div', { class: 'panel-body' });

  if (!accounts.length) {
    accBody.appendChild(el('div', { class: 'empty', text: 'Henüz hesap eklenmedi. Aşağıdan ilk hesabınızı ekleyin; istediğiniz kadar hesap ekleyebilirsiniz.' }));
  } else {
    const list = el('div');
    for (const a of accounts) {
      list.appendChild(el('div', { class: 'acct-row' }, [
        el('div', { class: 'acct-mail' }, [
          el('div', { class: 'row-name', text: a.user }),
          el('div', { class: 'row-sub', text: a.hasPassword === false ? 'şifre kayıtlı değil, yeniden ekleyin' : 'bağlı' })
        ]),
        el('button', {
          class: 'danger small',
          text: 'Kaldır',
          onclick: async () => {
            const r = await api.gmailRemoveAccount(a.user);
            await refresh(r.state);
            toast(`${a.user} kaldırıldı.`, 'ok');
          }
        })
      ]));
    }
    accBody.appendChild(list);
  }

  const userInput = el('input', { type: 'text', class: 'grow', placeholder: 'ornek@gmail.com' });
  const passInput = el('input', { type: 'password', class: 'grow', placeholder: 'Google uygulama şifresi (16 hane)' });
  // Google sifreyi bosluklu gosteriyor; kullanici oldugu gibi yapistirabilsin.
  passInput.addEventListener('input', () => {
    const cleaned = passInput.value.replace(/\s+/g, '');
    if (cleaned !== passInput.value) passInput.value = cleaned;
  });

  accBody.appendChild(el('div', { class: 'form-grid', style: 'margin-top:14px' }, [
    el('div', { class: 'field' }, [el('label', { text: 'Gmail adresi' }), userInput]),
    el('div', { class: 'field' }, [el('label', { text: 'Uygulama şifresi' }), passInput]),
    el('div', { class: 'field full' }, [gmailGuide()])
  ]));

  accBody.appendChild(el('div', { class: 'filters' }, [
    el('button', {
      class: 'primary',
      text: 'Hesabı ekle ve doğrula',
      onclick: async (e) => {
        const btn = e.target;
        btn.disabled = true;
        btn.textContent = 'Doğrulanıyor...';
        const r = await api.gmailAddAccount({ user: userInput.value.trim(), appPassword: passInput.value.trim() });
        btn.disabled = false;
        btn.textContent = 'Hesabı ekle ve doğrula';
        if (!r.ok) { toast(r.error, 'err'); return; }
        userInput.value = '';
        passInput.value = '';
        await refresh(r.state);
        toast('Hesap eklendi ve bağlantı doğrulandı.', 'ok');
      }
    })
  ]));
  accPanel.appendChild(accBody);
  wrap.appendChild(accPanel);

  /* ---- tarama ---- */

  const scanPanel = el('div', { class: 'panel' }, [
    el('h3', {}, ['Makbuz taraması', el('small', { text: accounts.length > 1 ? 'tüm hesaplar birlikte taranır' : '' })])
  ]);
  const scanBody = el('div', { class: 'panel-body' }, [
    el('div', { class: 'hint', text: 'Tarama, bağlı tüm hesaplardaki fatura ve makbuz maillerini okur; aynı servis birden fazla hesapta çıkarsa tek kayıtta birleştirilir. İptal bildirimleri de yakalanır ve o abonelikler iptal olarak işaretlenir.' }),
    el('div', { class: 'filters', style: 'margin-top:12px' }, [
      el('button', {
        class: 'primary',
        text: 'Makbuzları tara',
        id: 'btnScan',
        disabled: accounts.length ? null : true,
        onclick: startScan
      })
    ]),
    el('div', { class: 'progress', id: 'scanProgress', hidden: true }, [el('div')])
  ]);
  scanPanel.appendChild(scanBody);
  wrap.appendChild(scanPanel);

  async function startScan(e) {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Taranıyor...';
    document.getElementById('scanProgress').hidden = false;

    const stop = api.onProgress((p) => {
      const bar = document.querySelector('#scanProgress > div');
      if (bar && p.total) bar.style.width = `${Math.round((p.done / p.total) * 100)}%`;
    });

    const r = await api.gmailScan({});
    stop();
    btn.disabled = false;
    btn.textContent = 'Makbuzları tara';
    document.getElementById('scanProgress').hidden = true;

    if (!r.ok) { toast(r.error, 'err'); return; }
    scanResults = { records: r.records, cancellations: r.cancellations || [], perAccount: r.perAccount || [] };
    const cancelNote = scanResults.cancellations.length ? `, ${scanResults.cancellations.length} iptal bildirimi` : '';
    toast(`${r.scanned} mail tarandı, ${r.records.length} servis${cancelNote} bulundu.`, 'ok');
    if (r.errors && r.errors.length) toast(r.errors.join(' · '), 'err');
    render();
  }

  if (scanResults && (scanResults.records || []).length) {
    const checks = [];
    const resPanel = el('div', { class: 'panel' }, [
      el('h3', {}, ['Bulunanlar', el('small', { text: `${scanResults.records.length} servis` })])
    ]);
    const resBody = el('div', { class: 'panel-body tight' });

    if (scanResults.perAccount.length > 1) {
      resBody.appendChild(el('div', { class: 'hint', style: 'padding:10px 12px 0' }, [
        scanResults.perAccount.map((a) => `${a.user}: ${a.matched} makbuz`).join(' · ')
      ]));
    }

    for (const rec of scanResults.records) {
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
          el('div', { text: known ? 'mevcut kayıt güncellenir' : 'yeni' })
        ])
      ]));
    }

    if (scanResults.cancellations.length) {
      resBody.appendChild(el('div', { class: 'hint', style: 'padding:12px' }, [
        el('strong', { text: 'İptal bildirimi bulunanlar: ' }),
        scanResults.cancellations.map((c) => c.name).join(', '),
        '. Envantere eklerken bunlar iptal olarak işaretlenir.'
      ]));
    }

    resBody.appendChild(el('div', { class: 'filters', style: 'padding:12px' }, [
      el('button', {
        class: 'primary',
        text: 'Seçilenleri envantere ekle',
        onclick: async () => {
          const picked = checks.filter((c) => c.cb.checked).map((c) => c.rec);
          const r = await api.gmailApply({ records: picked, cancellations: scanResults.cancellations });
          scanResults = null;
          await refresh(r.state);
          const c = (r.cancelled || []).length;
          toast(`${r.result.added} yeni, ${r.result.updated} güncellendi${c ? `, ${c} iptal işaretlendi` : ''}.`, 'ok');
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
      el('button', { class: 'ghost', text: 'TCMB kurunu çek', onclick: refreshRates }),
      el('button', { class: 'ghost', text: 'Kurulum rehberini aç', onclick: () => openOnboarding(0) })
    ])
  ]));
  wrap.appendChild(panel);

  /* ---- otomatik tarama ---- */

  const autoOn = el('input', { type: 'checkbox', checked: s.autoScan !== false });
  const autoHours = el('input', { type: 'number', value: s.autoScanEveryHours || 24, min: '6', step: '1' });
  const autoLookback = el('input', { type: 'number', value: s.autoScanLookbackDays || 14, min: '3', step: '1' });

  const autoPanel = el('div', { class: 'panel' }, [
    el('h3', {}, ['Otomatik tarama', el('small', { text: s.lastAutoScanAt ? `son: ${shortDate(s.lastAutoScanAt)}` : 'henüz çalışmadı' })])
  ]);
  autoPanel.appendChild(el('div', { class: 'panel-body' }, [
    el('div', { class: 'hint', text: 'Açıkken uygulama arka planda belirli aralıklarla bağlı Gmail hesaplarını tarar, yeni makbuzları envantere ekler ve iptal bildirimlerini işaretler. Kısa bir geriye dönüş penceresi kullanılır, o yüzden hızlı biter.' }),
    el('label', { class: 'switch', style: 'margin-top:12px' }, [autoOn, el('span', { text: 'Otomatik taramayı aç' })]),
    el('div', { class: 'form-grid', style: 'margin-top:12px' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Tarama aralığı (saat)' }), autoHours]),
      el('div', { class: 'field' }, [el('label', { text: 'Geriye dönük bakılan gün' }), autoLookback])
    ]),
    el('div', { class: 'filters', style: 'margin-top:12px' }, [
      el('button', {
        class: 'primary',
        text: 'Kaydet',
        onclick: async () => {
          await refresh(await api.saveSettings({
            autoScan: autoOn.checked,
            autoScanEveryHours: Math.max(6, Number(autoHours.value) || 24),
            autoScanLookbackDays: Math.max(3, Number(autoLookback.value) || 14)
          }));
          toast('Otomatik tarama ayarı kaydedildi.', 'ok');
        }
      }),
      el('button', {
        class: 'ghost',
        text: 'Şimdi tara',
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = 'Taranıyor...';
          const r = await api.runAutoScan();
          e.target.disabled = false;
          e.target.textContent = 'Şimdi tara';
          if (r.state) await refresh(r.state);
          if (!r.ok) { toast(r.skipped ? `Tarama yapılmadı: ${r.skipped}` : (r.error || 'Tarama yapılamadı.'), 'err'); return; }
          const c = (r.cancelled || []).length;
          toast(`${r.added} yeni, ${r.updated} güncellendi${c ? `, ${c} iptal işaretlendi` : ''}.`, 'ok');
        }
      })
    ])
  ]));
  wrap.appendChild(autoPanel);

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

api.onAutoScan(async (p) => {
  await refresh();
  const parts = [];
  if (p.added) parts.push(`${p.added} yeni abonelik`);
  if (p.updated) parts.push(`${p.updated} güncelleme`);
  if (p.cancelled) parts.push(`${p.cancelled} iptal`);
  if (parts.length) toast(`Otomatik tarama: ${parts.join(', ')}.`, 'ok');
});

refresh().then(() => {
  // Ilk acilista rehberi goster: hic abonelik yoksa ve daha once tamamlanmadiysa.
  if (state && !state.settings.onboarded && state.subscriptions.length === 0) openOnboarding(0);
});
