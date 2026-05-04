/* app.js — bootstrap, SPA router, auth gate, helpers */
(() => {
  const ROUTES = ['dashboard','upload','nephra','analysis','trends','doctors','history','settings'];
  let currentRoute = 'dashboard';
  let isFreshSignup = false;

  /* ---------------- ROUTING ---------------- */
  function navigate(route){
    if (!ROUTES.includes(route)) route = 'dashboard';
    if (typeof window._raPageCleanup === 'function'){
      try { window._raPageCleanup(); } catch(e){ console.warn('[router] cleanup error', e); }
      window._raPageCleanup = null;
    }
    closeUserMenu();
    currentRoute = route;
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${route}`));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.route === route));
    location.hash = '#' + route;
    // Skeleton first paint — replaced when the page's renderer completes.
    const target = document.getElementById(`page-${route}`);
    if (target) target.innerHTML = skeletonHTML();
    const renderer = window.RAPages?.[route];
    try {
      if (renderer) renderer({ isFreshSignup });
      else if (target) target.innerHTML = `<div class="card"><div class="muted">${RAi18n.t('common.loading')}</div></div>`;
      isFreshSignup = false;
    } catch (err){
      console.error('[router] page render error', err);
      if (target) target.innerHTML = errorBoundaryHTML(err);
    }
  }
  function skeletonHTML(){
    return `
      <div style="margin-bottom:var(--s-7)">
        <div class="skel skel-title" style="width:160px;margin-bottom:var(--s-2)"></div>
        <div class="skel skel-line" style="width:280px"></div>
      </div>
      <div class="grid-4" style="margin-bottom:var(--s-3)">
        ${[1,2,3,4].map(() => `<div class="card-sm"><div class="skel skel-line" style="width:80px;margin-bottom:var(--s-2)"></div><div class="skel skel-num"></div></div>`).join('')}
      </div>
      <div class="grid-2">
        <div class="card"><div class="skel skel-title mb-12"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div>
        <div class="card"><div class="skel skel-title mb-12"></div><div class="skel skel-row"></div><div class="skel skel-row"></div></div>
      </div>`;
  }
  window.RANavigate = navigate;

  /* ---------------- ERROR BOUNDARY ---------------- */
  function errorBoundaryHTML(err){
    const msg = err && err.message ? err.message : 'Unexpected error';
    return `
      <div class="card">
        <div class="empty-state" style="padding:var(--s-7) var(--s-4)">
          <div class="empty-icon">⚠</div>
          <div class="empty-title">${RAi18n.t('common.errorTitle') || 'Something went wrong rendering this page'}</div>
          <div class="empty-body" style="font-family:var(--font-mono);font-size:11px;color:var(--ink-3);max-width:520px">${msg}</div>
          <button class="btn btn-secondary" onclick="location.reload()">${RAi18n.t('common.reload') || 'Reload app'}</button>
        </div>
      </div>`;
  }
  window.addEventListener('error', (e) => {
    console.error('[global] uncaught', e.error);
    if (e.error && document.querySelector('.page.active')){
      document.querySelector('.page.active').innerHTML = errorBoundaryHTML(e.error);
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[global] unhandled rejection', e.reason);
  });

  /* ---------------- TOAST ---------------- */
  function toast(msg, kind='ok', ms=3000){
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }
  window.RAToast = toast;

  /* ---------------- MODAL ---------------- */
  function modal({ title, body, onConfirm, confirmLabel, danger=false }){
    return new Promise(resolve => {
      const root = document.getElementById('modal-root');
      root.innerHTML = `
        <div class="modal-backdrop">
          <div class="modal" role="dialog" aria-modal="true">
            <div class="modal-title">${title}</div>
            <div>${body}</div>
            <div class="modal-actions">
              <button class="btn btn-secondary" data-act="cancel">${RAi18n.t('common.cancel')}</button>
              <button class="btn ${danger?'btn-danger':'btn-primary'}" data-act="ok">${confirmLabel || RAi18n.t('common.confirm')}</button>
            </div>
          </div>
        </div>`;
      root.querySelector('[data-act=cancel]').onclick = () => { root.innerHTML=''; resolve(false); };
      root.querySelector('[data-act=ok]').onclick = async () => {
        if (onConfirm) await onConfirm();
        root.innerHTML=''; resolve(true);
      };
    });
  }
  window.RAModal = modal;

  /* ---------------- TOPBAR ---------------- */
  async function refreshQuota(){
    const u = await RAStorage.currentUser();
    if (!u) return;
    const reports = await RAStorage.listReports({ userId: u.id, limit: 1000 });
    const used = document.getElementById('quota-used');
    const fill = document.getElementById('quota-fill');
    if (used) used.textContent = reports.length;
    if (fill) fill.style.width = Math.min(100, reports.length / 50 * 100) + '%';
  }
  window.RARefreshQuota = refreshQuota;

  async function refreshAvatar(){
    const u = await RAStorage.currentUser();
    if (!u) return;
    const initials = (u.name || u.email || 'U').split(/\s+/).map(p=>p[0]).slice(0,2).join('').toUpperCase();
    const el = document.getElementById('user-avatar');
    if (el) el.textContent = initials;
  }
  window.RARefreshAvatar = refreshAvatar;

  /* ---------------- USER MENU ---------------- */
  let menuOpen = false;
  async function toggleUserMenu(){
    if (menuOpen) { closeUserMenu(); return; }
    const u = await RAStorage.currentUser();
    if (!u) return;
    const avatar = document.getElementById('user-avatar');
    if (!avatar) return;
    const wrap = avatar.closest('.user-menu') || (() => {
      const w = document.createElement('div');
      w.className = 'user-menu';
      avatar.parentNode.insertBefore(w, avatar);
      w.appendChild(avatar);
      return w;
    })();
    let pop = wrap.querySelector('.user-menu-pop');
    if (!pop){
      pop = document.createElement('div');
      pop.className = 'user-menu-pop';
      wrap.appendChild(pop);
    }
    pop.innerHTML = `
      <div class="user-menu-info">
        <div class="user-menu-name">${escapeHtml(u.name || '—')}</div>
        <div class="user-menu-email">${escapeHtml(u.email || '')}</div>
      </div>
      <button class="user-menu-item" data-act="settings">⊙ ${RAi18n.t('nav.settings')}</button>
      <button class="user-menu-item danger" data-act="signout">→ ${RAi18n.t('auth.signOut')}</button>
    `;
    pop.querySelector('[data-act=settings]').onclick = () => { closeUserMenu(); navigate('settings'); };
    pop.querySelector('[data-act=signout]').onclick = async () => {
      closeUserMenu();
      await RAStorage.signOut();
      // Reset transient state then bring up auth screen
      window._raAnalysisId = null;
      window._raPageCleanup = null;
      menuOpen = false;
      RAAuth.show();
    };
    menuOpen = true;
    setTimeout(() => document.addEventListener('click', dismissOnOutsideClick, { once: true }), 0);
  }
  function closeUserMenu(){
    const pop = document.querySelector('.user-menu-pop');
    if (pop) pop.remove();
    menuOpen = false;
  }
  function dismissOnOutsideClick(e){
    if (!e.target.closest('.user-menu')) closeUserMenu();
    else if (menuOpen) setTimeout(() => document.addEventListener('click', dismissOnOutsideClick, { once:true }), 0);
  }
  function escapeHtml(s){
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ---------------- BOOT ---------------- */

  /** Phase 1: load i18n + init storage. Then check session and either
   *  show the auth screen or bootApp(). */
  async function bootInit(){
    try {
      await RAi18n.load();
      await RAStorage.init();
    } catch (e){
      console.error('[boot] init failed', e);
      document.body.innerHTML = `<pre style="padding:24px;color:#e8736f;font-family:DM Mono,monospace">Boot failed: ${e.message}</pre>`;
      return;
    }
    const u = await RAStorage.currentUser();
    if (u) {
      await bootApp();
    } else {
      // Apply user's last language pref or default
      RAAuth.show();
    }
  }

  /** Phase 2: user is authenticated. Render the shell, wire nav, navigate. */
  async function bootApp(opts = {}){
    if (opts.isFreshSignup) isFreshSignup = true;
    RAAuth.hide();

    // Apply user's stored language preference
    const u = await RAStorage.currentUser();
    if (u && u.languagePref && u.languagePref !== RAi18n.currentLang()){
      RAi18n.setLang(u.languagePref);
    } else {
      RAi18n.apply();
    }

    await refreshAvatar();
    await refreshQuota();

    // Wire topbar (idempotent: replace handlers each boot)
    const langToggle = document.getElementById('lang-toggle');
    if (langToggle){
      langToggle.onclick = () => {
        const next = RAi18n.currentLang() === 'en' ? 'ur' : 'en';
        RAi18n.setLang(next);
        navigate(currentRoute);
      };
    }
    const avatar = document.getElementById('user-avatar');
    if (avatar) avatar.onclick = (e) => { e.stopPropagation(); toggleUserMenu(); };

    document.querySelectorAll('.nav-item').forEach(n => {
      n.onclick = () => {
        window._raAnalysisId = null;
        navigate(n.dataset.route);
      };
    });
    window.onhashchange = () => navigate(location.hash.replace('#','') || 'dashboard');

    RAi18n.onChange(() => navigate(currentRoute));

    const initial = (location.hash.replace('#','') || 'dashboard');
    navigate(initial);
  }
  window.RABoot = bootApp;

  document.addEventListener('DOMContentLoaded', bootInit);
})();
