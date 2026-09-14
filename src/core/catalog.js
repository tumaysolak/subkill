'use strict';

// Bilinen servis katalogu: fatura gonderen alan adi -> servis adi, kategori, giris alan adi.
// Kategori cakisma tespitinde kullanilir (ayni kategoride birden fazla abonelik = potansiyel israf).

const CATEGORIES = {
  llm_chat: 'Yapay zeka sohbet aboneligi',
  llm_api: 'Yapay zeka API / token',
  kod: 'Kodlama asistani',
  video: 'Video uretimi',
  ses: 'Ses ve seslendirme',
  gorsel: 'Gorsel ve tasarim',
  otomasyon: 'Otomasyon',
  veri: 'Veri toplama / scraping',
  eposta: 'E-posta altyapisi',
  barindirma: 'Barindirma ve altyapi',
  seo: 'SEO ve arama',
  crm: 'CRM ve satis',
  verimlilik: 'Not ve verimlilik',
  topluluk: 'Topluluk ve egitim',
  reklam: 'Reklam harcamasi',
  alanadi: 'Alan adi ve hosting',
  depolama: 'Depolama ve bulut',
  diger: 'Diger'
};

const CATALOG = [
  // Yapay zeka sohbet
  { match: ['anthropic.com', 'claude.ai'], name: 'Anthropic Claude', category: 'llm_chat', site: 'claude.ai' },
  { match: ['openai.com', 'chatgpt.com'], name: 'OpenAI ChatGPT', category: 'llm_chat', site: 'chatgpt.com' },
  { match: ['perplexity.ai'], name: 'Perplexity', category: 'llm_chat', site: 'perplexity.ai' },
  { match: ['x.ai', 'grok.com'], name: 'xAI Grok', category: 'llm_chat', site: 'grok.com' },
  { match: ['mistral.ai'], name: 'Mistral', category: 'llm_chat', site: 'chat.mistral.ai' },
  { match: ['poe.com'], name: 'Poe', category: 'llm_chat', site: 'poe.com' },

  // Yapay zeka API
  { match: ['openrouter.ai'], name: 'OpenRouter', category: 'llm_api', site: 'openrouter.ai' },
  { match: ['together.ai', 'together.xyz'], name: 'Together AI', category: 'llm_api', site: 'together.ai' },
  { match: ['groq.com'], name: 'Groq', category: 'llm_api', site: 'console.groq.com' },
  { match: ['replicate.com'], name: 'Replicate', category: 'llm_api', site: 'replicate.com' },
  { match: ['fal.ai'], name: 'fal.ai', category: 'llm_api', site: 'fal.ai' },
  { match: ['deepseek.com'], name: 'DeepSeek', category: 'llm_api', site: 'platform.deepseek.com' },

  // Kodlama
  { match: ['cursor.sh', 'cursor.com'], name: 'Cursor', category: 'kod', site: 'cursor.com' },
  { match: ['github.com'], name: 'GitHub', category: 'kod', site: 'github.com' },
  { match: ['replit.com'], name: 'Replit', category: 'kod', site: 'replit.com' },
  { match: ['windsurf.com', 'codeium.com'], name: 'Windsurf', category: 'kod', site: 'windsurf.com' },
  { match: ['cline.bot'], name: 'Cline', category: 'kod', site: 'cline.bot' },
  { match: ['lovable.dev', 'lovable.app'], name: 'Lovable', category: 'kod', site: 'lovable.dev' },
  { match: ['bolt.new', 'stackblitz.com'], name: 'Bolt', category: 'kod', site: 'bolt.new' },
  { match: ['v0.dev'], name: 'v0', category: 'kod', site: 'v0.dev' },

  // Video
  { match: ['heygen.com'], name: 'HeyGen', category: 'video', site: 'app.heygen.com' },
  { match: ['runwayml.com', 'runway.com'], name: 'Runway', category: 'video', site: 'runwayml.com' },
  { match: ['veed.io'], name: 'VEED', category: 'video', site: 'veed.io' },
  { match: ['descript.com'], name: 'Descript', category: 'video', site: 'descript.com' },
  { match: ['synthesia.io'], name: 'Synthesia', category: 'video', site: 'synthesia.io' },
  { match: ['opus.pro'], name: 'OpusClip', category: 'video', site: 'opus.pro' },
  { match: ['kling.ai', 'klingai.com'], name: 'Kling AI', category: 'video', site: 'klingai.com' },
  { match: ['pika.art'], name: 'Pika', category: 'video', site: 'pika.art' },
  { match: ['remotion.dev', 'remotion.pro'], name: 'Remotion', category: 'video', site: 'remotion.dev' },

  // Ses
  { match: ['elevenlabs.io'], name: 'ElevenLabs', category: 'ses', site: 'elevenlabs.io' },
  { match: ['plaud.ai'], name: 'Plaud', category: 'ses', site: 'app.plaud.ai' },
  { match: ['otter.ai'], name: 'Otter', category: 'ses', site: 'otter.ai' },
  { match: ['tldv.io'], name: 'tl;dv', category: 'ses', site: 'tldv.io' },
  { match: ['fireflies.ai'], name: 'Fireflies', category: 'ses', site: 'fireflies.ai' },
  { match: ['suno.ai', 'suno.com'], name: 'Suno', category: 'ses', site: 'suno.com' },

  // Gorsel ve tasarim
  { match: ['canva.com'], name: 'Canva', category: 'gorsel', site: 'canva.com' },
  { match: ['figma.com'], name: 'Figma', category: 'gorsel', site: 'figma.com' },
  { match: ['midjourney.com'], name: 'Midjourney', category: 'gorsel', site: 'midjourney.com' },
  { match: ['adobe.com'], name: 'Adobe', category: 'gorsel', site: 'adobe.com' },
  { match: ['leonardo.ai'], name: 'Leonardo AI', category: 'gorsel', site: 'leonardo.ai' },
  { match: ['ideogram.ai'], name: 'Ideogram', category: 'gorsel', site: 'ideogram.ai' },
  { match: ['recraft.ai'], name: 'Recraft', category: 'gorsel', site: 'recraft.ai' },
  { match: ['gamma.app'], name: 'Gamma', category: 'gorsel', site: 'gamma.app' },

  // Otomasyon
  { match: ['zapier.com'], name: 'Zapier', category: 'otomasyon', site: 'zapier.com' },
  { match: ['make.com', 'integromat.com'], name: 'Make', category: 'otomasyon', site: 'make.com' },
  { match: ['n8n.io'], name: 'n8n', category: 'otomasyon', site: 'n8n.io' },
  { match: ['manychat.com'], name: 'ManyChat', category: 'otomasyon', site: 'manychat.com' },
  { match: ['composio.dev'], name: 'Composio', category: 'otomasyon', site: 'composio.dev' },
  { match: ['relay.app'], name: 'Relay', category: 'otomasyon', site: 'relay.app' },

  // Veri / scraping
  { match: ['brightdata.com', 'luminati.io'], name: 'Bright Data', category: 'veri', site: 'brightdata.com' },
  { match: ['apify.com'], name: 'Apify', category: 'veri', site: 'console.apify.com' },
  { match: ['serper.dev'], name: 'Serper', category: 'veri', site: 'serper.dev' },
  { match: ['serpapi.com'], name: 'SerpApi', category: 'veri', site: 'serpapi.com' },
  { match: ['firecrawl.dev'], name: 'Firecrawl', category: 'veri', site: 'firecrawl.dev' },
  { match: ['phantombuster.com'], name: 'PhantomBuster', category: 'veri', site: 'phantombuster.com' },
  { match: ['artificialsocieties.com', 'artificialsocieties.co'], name: 'Artificial Societies', category: 'veri', site: 'artificialsocieties.co' },

  // E-posta
  { match: ['resend.com'], name: 'Resend', category: 'eposta', site: 'resend.com' },
  { match: ['smartlead.ai'], name: 'Smartlead', category: 'eposta', site: 'app.smartlead.ai' },
  { match: ['instantly.ai'], name: 'Instantly', category: 'eposta', site: 'app.instantly.ai' },
  { match: ['sendgrid.com'], name: 'SendGrid', category: 'eposta', site: 'sendgrid.com' },
  { match: ['mailchimp.com'], name: 'Mailchimp', category: 'eposta', site: 'mailchimp.com' },
  { match: ['zoho.com'], name: 'Zoho', category: 'eposta', site: 'zoho.com' },
  { match: ['beehiiv.com'], name: 'beehiiv', category: 'eposta', site: 'beehiiv.com' },

  // Barindirma / altyapi
  { match: ['railway.app', 'railway.com'], name: 'Railway', category: 'barindirma', site: 'railway.app' },
  { match: ['vercel.com'], name: 'Vercel', category: 'barindirma', site: 'vercel.com' },
  { match: ['netlify.com'], name: 'Netlify', category: 'barindirma', site: 'netlify.com' },
  { match: ['supabase.com', 'supabase.io'], name: 'Supabase', category: 'barindirma', site: 'supabase.com' },
  { match: ['render.com'], name: 'Render', category: 'barindirma', site: 'render.com' },
  { match: ['fly.io'], name: 'Fly.io', category: 'barindirma', site: 'fly.io' },
  { match: ['cloudflare.com'], name: 'Cloudflare', category: 'barindirma', site: 'dash.cloudflare.com' },
  { match: ['digitalocean.com'], name: 'DigitalOcean', category: 'barindirma', site: 'cloud.digitalocean.com' },
  { match: ['expo.dev', 'expo.io'], name: 'Expo', category: 'barindirma', site: 'expo.dev' },
  { match: ['neon.tech'], name: 'Neon', category: 'barindirma', site: 'neon.tech' },
  { match: ['upstash.com'], name: 'Upstash', category: 'barindirma', site: 'upstash.com' },

  // Alan adi / hosting
  { match: ['namecheap.com'], name: 'Namecheap', category: 'alanadi', site: 'namecheap.com' },
  { match: ['name.com'], name: 'Name.com', category: 'alanadi', site: 'name.com' },
  { match: ['godaddy.com'], name: 'GoDaddy', category: 'alanadi', site: 'godaddy.com' },
  { match: ['ixirhost.com'], name: 'ixirhost', category: 'alanadi', site: 'ixirhost.com' },
  { match: ['natro.com'], name: 'Natro', category: 'alanadi', site: 'natro.com' },

  // SEO
  { match: ['semrush.com'], name: 'Semrush', category: 'seo', site: 'semrush.com' },
  { match: ['ahrefs.com'], name: 'Ahrefs', category: 'seo', site: 'ahrefs.com' },
  { match: ['similarweb.com'], name: 'SimilarWeb', category: 'seo', site: 'similarweb.com' },

  // CRM / satis
  { match: ['apollo.io'], name: 'Apollo.io', category: 'crm', site: 'app.apollo.io' },
  { match: ['hubspot.com'], name: 'HubSpot', category: 'crm', site: 'hubspot.com' },
  { match: ['lemlist.com'], name: 'Lemlist', category: 'crm', site: 'lemlist.com' },
  { match: ['hihello.com'], name: 'HiHello', category: 'crm', site: 'hihello.com' },
  { match: ['clay.com', 'clay.run'], name: 'Clay', category: 'crm', site: 'clay.com' },

  // Verimlilik
  { match: ['notion.so', 'notion.com'], name: 'Notion', category: 'verimlilik', site: 'notion.so' },
  { match: ['miro.com'], name: 'Miro', category: 'verimlilik', site: 'miro.com' },
  { match: ['slack.com'], name: 'Slack', category: 'verimlilik', site: 'slack.com' },
  { match: ['linear.app'], name: 'Linear', category: 'verimlilik', site: 'linear.app' },
  { match: ['airtable.com'], name: 'Airtable', category: 'verimlilik', site: 'airtable.com' },
  { match: ['obsidian.md'], name: 'Obsidian', category: 'verimlilik', site: 'obsidian.md' },
  { match: ['raycast.com'], name: 'Raycast', category: 'verimlilik', site: 'raycast.com' },
  { match: ['superhuman.com'], name: 'Superhuman', category: 'verimlilik', site: 'superhuman.com' },
  { match: ['medium.com'], name: 'Medium', category: 'verimlilik', site: 'medium.com' },

  // Topluluk / egitim
  { match: ['skool.com'], name: 'Skool', category: 'topluluk', site: 'skool.com' },
  { match: ['circle.so'], name: 'Circle', category: 'topluluk', site: 'circle.so' },
  { match: ['udemy.com'], name: 'Udemy', category: 'topluluk', site: 'udemy.com' },
  { match: ['coursera.org'], name: 'Coursera', category: 'topluluk', site: 'coursera.org' },
  { match: ['maven.com'], name: 'Maven', category: 'topluluk', site: 'maven.com' },
  { match: ['substack.com'], name: 'Substack', category: 'topluluk', site: 'substack.com' },

  // Reklam
  { match: ['ads.google.com', 'googleadservices.com'], name: 'Google Ads', category: 'reklam', site: 'ads.google.com' },
  { match: ['facebookmail.com', 'business.facebook.com'], name: 'Meta Ads', category: 'reklam', site: 'business.facebook.com' },
  { match: ['linkedin.com'], name: 'LinkedIn', category: 'reklam', site: 'linkedin.com' },

  // Depolama / bulut
  { match: ['payments.google.com', 'google.com'], name: 'Google', category: 'depolama', site: 'myaccount.google.com' },
  { match: ['dropbox.com'], name: 'Dropbox', category: 'depolama', site: 'dropbox.com' },
  { match: ['apple.com'], name: 'Apple', category: 'depolama', site: 'icloud.com' },
  { match: ['microsoft.com'], name: 'Microsoft', category: 'depolama', site: 'microsoft.com' }
];

// Odeme araciligi yapan servisler: bunlar servis adi degil, tasiyicidir.
const PAYMENT_PROCESSORS = [
  'stripe.com', 'paddle.com', 'paddle.net', 'paypal.com', 'lemonsqueezy.com',
  'fastspring.com', 'chargebee.com', 'recurly.com', 'braintreepayments.com',
  'paynet.com.tr', 'iyzico.com', 'iyzipay.com', 'craftgate.io'
];

function isPaymentProcessor(domain) {
  const d = String(domain || '').toLowerCase();
  return PAYMENT_PROCESSORS.some((p) => d === p || d.endsWith('.' + p) || d.includes(p));
}

/** "manychat.com" -> "manychat" */
function rootOf(domain) {
  const parts = String(domain).split('.');
  return parts.length > 1 ? parts[parts.length - 2] : parts[0];
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Alan adindan veya serbest metinden servis bul; en uzun eslesme kazanir.
 * Tam alan adi eslesmesi (manychat.com) once denenir, bulunamazsa marka adi
 * kelime sinirlariyla aranir ("Your receipt from ManyChat" -> ManyChat).
 */
function lookup(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return null;
  let best = null;

  for (const entry of CATALOG) {
    for (const m of entry.match) {
      if (t.includes(m) && (!best || m.length > best.len)) best = { entry, len: m.length };
    }
  }
  if (best) return best.entry;

  // Marka adi eslesmesi: kisa ve jenerik kokler (make, name, apple) yanlis
  // pozitif uretmesin diye en az 4 karakter ve kelime siniri sarti aranir.
  for (const entry of CATALOG) {
    const candidates = new Set([entry.name.toLowerCase(), ...entry.match.map(rootOf)]);
    for (const c of candidates) {
      if (!c || c.length < 4) continue;
      const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(c)}($|[^a-z0-9])`, 'i');
      if (re.test(t) && (!best || c.length > best.len)) best = { entry, len: c.length };
    }
  }
  return best ? best.entry : null;
}

const KEYWORD_RULES = [
  [/(gpt|llm|claude|yapay zeka)/, 'llm_chat'],
  [/(api|token|credit)/, 'llm_api'],
  [/(video|clip|reel)/, 'video'],
  [/(voice|ses|audio|speech|podcast)/, 'ses'],
  [/(design|tasarim|image|gorsel|photo)/, 'gorsel'],
  [/(mail|email|smtp|posta)/, 'eposta'],
  [/(host|server|cloud|deploy|database)/, 'barindirma'],
  [/(domain|alan adi)/, 'alanadi'],
  [/(seo|rank|serp)/, 'seo'],
  [/(crm|lead|sales|satis|prospect)/, 'crm'],
  [/(scrape|scraping|proxy)/, 'veri'],
  [/(automation|otomasyon|workflow|zap)/, 'otomasyon'],
  [/(community|topluluk|course|kurs|egitim|academy)/, 'topluluk'],
  [/(ads|reklam|advertis)/, 'reklam']
];

function guessCategory(name) {
  const hit = lookup(name);
  if (hit) return hit.category;
  const n = String(name || '').toLowerCase();
  for (const [re, cat] of KEYWORD_RULES) if (re.test(n)) return cat;
  return 'diger';
}

function siteFor(name) {
  const hit = lookup(name);
  return hit ? hit.site : '';
}

module.exports = { CATEGORIES, CATALOG, lookup, guessCategory, siteFor, isPaymentProcessor };
