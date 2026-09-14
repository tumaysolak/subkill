'use strict';

function detectPlatform() {
  const p = (navigator.platform || navigator.userAgent || '').toLowerCase();
  if (p.includes('mac')) return 'mac';
  if (p.includes('win')) return 'win';
  return 'other';
}

function wire(formId, noteId, defaultNote) {
  const form = document.getElementById(formId);
  if (!form) return;
  const note = document.getElementById(noteId);
  const button = form.querySelector('button');
  const email = form.querySelector('input[type="email"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = (email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      note.textContent = 'Gecerli bir e-posta adresi girin.';
      note.className = 'form-note err' + (formId.endsWith('2') ? ' center' : '');
      email.focus();
      return;
    }

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Gonderiliyor...';

    try {
      const res = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: value,
          platform: detectPlatform(),
          website: form.querySelector('input[name="website"]').value,
          ref: document.referrer || ''
        })
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Gonderilemedi.');

      form.reset();
      note.textContent = data.mailed === false
        ? 'Kaydedildi. Indirme baglantisi kisa sure icinde gelecek.'
        : 'Gonderildi. Indirme baglantisi e-postanda.';
      note.className = 'form-note ok' + (formId.endsWith('2') ? ' center' : '');
    } catch (err) {
      note.textContent = err.message || 'Bir sorun oldu, tekrar deneyin.';
      note.className = 'form-note err' + (formId.endsWith('2') ? ' center' : '');
    } finally {
      button.disabled = false;
      button.textContent = original;
      setTimeout(() => {
        if (note.classList.contains('ok')) return;
        note.textContent = defaultNote;
        note.className = 'form-note' + (formId.endsWith('2') ? ' center' : '');
      }, 6000);
    }
  });
}

wire('leadForm', 'formNote', 'Kredi karti yok, hesap acmak yok. Indirme baglantisi e-postana gelir.');
wire('leadForm2', 'formNote2', 'macOS 12+ ve Windows 10+ · yaklasik 95 MB');
