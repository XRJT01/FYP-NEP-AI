/* i18n.js — translation engine
 * Public API on window.RAi18n:
 *   load()                       -> fetches en.json + ur.json
 *   t(key, params?)              -> translation lookup with {placeholder} interpolation
 *   setLang(lang)                -> 'en' | 'ur'  (persists; flips dir + html lang; refreshes [data-i18n] nodes)
 *   currentLang()
 *   onChange(fn)                 -> subscribe; invoked with new lang code
 * --------------------------------------------------------------- */
(() => {
  const STORAGE_KEY = 'renalai.lang';
  const dicts = { en:null, ur:null };
  let lang = localStorage.getItem(STORAGE_KEY) || 'en';
  const subs = [];

  async function load(){
    const [en, ur] = await Promise.all([
      fetch('locales/en.json').then(r => r.json()),
      fetch('locales/ur.json').then(r => r.json()),
    ]);
    dicts.en = en; dicts.ur = ur;
    apply();
  }

  function lookup(key, dict){
    return key.split('.').reduce((o,k) => (o && o[k] !== undefined) ? o[k] : null, dict);
  }

  function t(key, params={}, langOverride){
    const useLang = langOverride && dicts[langOverride] ? langOverride : lang;
    const dict = dicts[useLang] || dicts.en;
    if (!dict) return key;
    const fallback = dicts.en && lookup(key, dicts.en);
    let val = lookup(key, dict);
    if (val == null) val = fallback;
    if (val == null) return key;
    return String(val).replace(/\{(\w+)\}/g, (_, k) => params[k] != null ? params[k] : '');
  }

  function setLang(next){
    if (!['en','ur'].includes(next) || next === lang) return;
    lang = next;
    localStorage.setItem(STORAGE_KEY, lang);
    apply();
    subs.forEach(fn => { try { fn(lang); } catch(e){ console.error(e); } });
  }

  function apply(){
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === 'ur') ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
    });
    const btn = document.getElementById('lang-toggle');
    if (btn) btn.textContent = lang === 'en' ? 'EN | اردو' : 'اردو | EN';
  }

  const currentLang = () => lang;
  const onChange = (fn) => { subs.push(fn); return () => { const i = subs.indexOf(fn); if (i>=0) subs.splice(i,1); }; };

  window.RAi18n = { load, t, setLang, currentLang, onChange, apply };
})();
