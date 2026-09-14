'use strict';

function detectPlatform() {
  const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '';
  const s = String(p).toLowerCase();
  if (s.includes('mac')) return 'mac';
  if (s.includes('win')) return 'win';
  return 'other';
}

function wire(formId, noteId) {
  const form = document.getElementById(formId);
  const note = document.getElementById(noteId);
  if (!form || !note) return;

  const baseClass = note.className;
  const baseHtml = note.innerHTML;
  const button = form.querySelector('button');
  const email = form.querySelector('input[type="email"]');
  let resetTimer;

  const setNote = (text, kind) => {
    clearTimeout(resetTimer);
    note.textContent = text;
    note.className = `${baseClass} ${kind}`.trim();
    if (kind !== 'ok') {
      resetTimer = setTimeout(() => {
        note.innerHTML = baseHtml;
        note.className = baseClass;
      }, 7000);
    }
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = (email.value || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      setNote('Geçerli bir e-posta adresi girin.', 'err');
      email.focus();
      return;
    }

    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Gönderiliyor...';

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
      if (!data.ok) throw new Error(data.error || 'Gönderilemedi.');

      form.reset();
      setNote(
        data.mailed === false
          ? 'Kaydedildi. İndirme bağlantısı kısa süre içinde gelecek.'
          : 'Gönderildi. İndirme bağlantısı e-postanda.',
        'ok'
      );
    } catch (err) {
      setNote(err.message || 'Bir sorun oldu, tekrar deneyin.', 'err');
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  });
}

wire('leadForm', 'formNote');
wire('leadForm2', 'formNote2');


/* ---------- tanitim videosu: sessiz baslar, tiklayinca ses acilir ---------- */

(function () {
  const video = document.getElementById('tanitim');
  const button = document.getElementById('soundToggle');
  if (!video || !button) return;

  const icon = document.getElementById('soundIcon');
  const label = document.getElementById('soundLabel');

  const sync = () => {
    const on = !video.muted;
    button.setAttribute('aria-pressed', String(on));
    icon.textContent = on ? '\u{1F50A}' : '\u{1F507}';
    label.textContent = on ? 'Sesi kapat' : 'Sesi aç';
  };

  button.addEventListener('click', () => {
    video.muted = !video.muted;
    if (!video.muted) {
      video.loop = false;
      video.currentTime = 0;
      video.play().catch(() => {});
    }
    sync();
  });

  // Ses acikken video bitince tekrar sessiz dongune don.
  video.addEventListener('ended', () => {
    video.muted = true;
    video.loop = true;
    video.play().catch(() => {});
    sync();
  });

  sync();
})();
