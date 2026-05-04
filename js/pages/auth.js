/* auth.js (page) — full-screen auth experience
 * ------------------------------------------------------------------
 * Three tabs: Sign In · Sign Up · Try Demo. Each form validates,
 * shows inline errors, and resolves to a logged-in session that the
 * app shell can render against.
 *
 * Public:
 *   RAAuth.show()          — render auth screen + hide app shell
 *   RAAuth.hide()          — restore app shell
 *   RAAuth.requireLogin()  — bootstrap helper: shows screen if no session
 * ------------------------------------------------------------------ */
(() => {

  let activeTab = 'signin';

  function show(){
    document.querySelector('.app').setAttribute('hidden', '');
    let wrap = document.getElementById('auth-screen');
    if (!wrap){
      wrap = document.createElement('div');
      wrap.id = 'auth-screen';
      document.body.appendChild(wrap);
    }
    render(wrap);
  }

  function hide(){
    document.querySelector('.app').removeAttribute('hidden');
    const w = document.getElementById('auth-screen');
    if (w) w.remove();
  }

  async function requireLogin(){
    const u = await RAStorage.currentUser();
    if (u) { hide(); return u; }
    show();
    return null;
  }

  function render(wrap){
    wrap.innerHTML = `
      <div class="auth-bg"></div>
      <div class="auth-card">
        <header class="auth-brand">
          <div class="logo-icon" style="width:34px;height:34px;font-size:16px">R</div>
          <div>
            <div class="auth-title">RenalAI</div>
            <div class="auth-tagline">${RAi18n.t('auth.tagline')}</div>
          </div>
          <button class="lang-btn" id="auth-lang-toggle" style="margin-inline-start:auto">${RAi18n.currentLang()==='ur'?'EN':'اردو'}</button>
        </header>

        <div class="tab-bar" role="tablist" style="display:flex;width:100%;margin-bottom:var(--s-5)">
          ${['signin','signup','demo'].map(t => `
            <button class="tab ${activeTab===t?'active':''}" data-auth-tab="${t}" role="tab"
                    style="flex:1;padding:var(--s-2) var(--s-3)" aria-selected="${activeTab===t}">
              ${RAi18n.t('auth.tab.'+t)}
            </button>`).join('')}
        </div>

        <div id="auth-form-wrap">${formForTab(activeTab)}</div>

        <footer class="auth-footer">
          <div class="muted" style="font-size:11px;line-height:1.6">${RAi18n.t('auth.privacyNote')}</div>
        </footer>
      </div>
    `;

    wrap.querySelectorAll('[data-auth-tab]').forEach(b => {
      b.onclick = () => { activeTab = b.dataset.authTab; render(wrap); };
    });
    wrap.querySelector('#auth-lang-toggle').onclick = () => {
      RAi18n.setLang(RAi18n.currentLang() === 'en' ? 'ur' : 'en');
      render(wrap);
    };
    bindActiveForm(wrap);
  }

  function formForTab(tab){
    if (tab === 'signin') return signinHTML();
    if (tab === 'signup') return signupHTML();
    return demoHTML();
  }

  function signinHTML(){
    return `
      <form id="signin-form" autocomplete="on">
        <div class="form-group">
          <label class="form-label" for="si-email">${RAi18n.t('auth.email')}</label>
          <input id="si-email" type="email" autocomplete="email" required placeholder="you@example.com">
        </div>
        <div class="form-group">
          <label class="form-label" for="si-password">${RAi18n.t('auth.password')}</label>
          <input id="si-password" type="password" autocomplete="current-password" required>
        </div>
        <button class="btn btn-primary w-full" type="submit">${RAi18n.t('auth.signinSubmit')}</button>
        <div id="signin-error" class="auth-error" hidden></div>
        <div class="muted mt-16" style="font-size:12px;text-align:center">${RAi18n.t('auth.noAccount')} <a href="#" data-jump="signup">${RAi18n.t('auth.tab.signup')}</a></div>
      </form>`;
  }

  function signupHTML(){
    return `
      <form id="signup-form" autocomplete="on">
        <div class="form-group">
          <label class="form-label" for="su-name">${RAi18n.t('auth.fullName')}</label>
          <input id="su-name" required placeholder="Muhammad Ali">
        </div>
        <div class="form-group">
          <label class="form-label" for="su-email">${RAi18n.t('auth.email')}</label>
          <input id="su-email" type="email" autocomplete="email" required placeholder="you@example.com">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="su-age">${RAi18n.t('settings.age')}</label>
            <input id="su-age" type="number" min="18" max="120" placeholder="30">
          </div>
          <div class="form-group">
            <label class="form-label" for="su-gender">${RAi18n.t('settings.sex')}</label>
            <select id="su-gender">
              <option value="M">${RAi18n.t('settings.male')}</option>
              <option value="F">${RAi18n.t('settings.female')}</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="su-password">${RAi18n.t('auth.password')}</label>
          <input id="su-password" type="password" autocomplete="new-password" required minlength="8" placeholder="${RAi18n.t('auth.minChars',{n:8})}">
        </div>
        <button class="btn btn-primary w-full" type="submit">${RAi18n.t('auth.signupSubmit')}</button>
        <div id="signup-error" class="auth-error" hidden></div>
        <div class="muted mt-16" style="font-size:12px;text-align:center">${RAi18n.t('auth.haveAccount')} <a href="#" data-jump="signin">${RAi18n.t('auth.tab.signin')}</a></div>
      </form>`;
  }

  function demoHTML(){
    return `
      <div style="text-align:center;padding:var(--s-3) 0">
        <div style="width:48px;height:48px;border-radius:50%;background:var(--brand);color:var(--brand-fg);
             display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:18px;margin-bottom:var(--s-3)">SA</div>
        <div style="font-size:15px;font-weight:600;color:var(--ink-1)">Muhammad Sami Afzal</div>
        <div class="muted" style="font-size:12px;margin-top:2px">24 y/o · Patient · 7 historical reports</div>
      </div>
      <div class="muted" style="font-size:13px;line-height:1.6;margin-bottom:var(--s-5)">
        ${RAi18n.t('auth.demoExplain')}
      </div>
      <ul class="muted" style="font-size:12px;list-style:none;padding:0;margin:0 0 var(--s-5);line-height:1.8">
        <li>✓ ${RAi18n.t('auth.demoFeat1')}</li>
        <li>✓ ${RAi18n.t('auth.demoFeat2')}</li>
        <li>✓ ${RAi18n.t('auth.demoFeat3')}</li>
        <li>✓ ${RAi18n.t('auth.demoFeat4')}</li>
      </ul>
      <button class="btn btn-primary w-full" id="demo-go">${RAi18n.t('auth.demoGo')}</button>
      <div id="demo-error" class="auth-error" hidden></div>
    `;
  }

  function bindActiveForm(wrap){
    // Cross-tab navigation links
    wrap.querySelectorAll('[data-jump]').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); activeTab = a.dataset.jump; render(wrap); };
    });

    if (activeTab === 'signin'){
      const form = wrap.querySelector('#signin-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = wrap.querySelector('#signin-error'); err.hidden = true;
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          await RAStorage.login({
            email: wrap.querySelector('#si-email').value,
            password: wrap.querySelector('#si-password').value,
          });
          await afterLogin();
        } catch (e2) {
          err.textContent = e2.message || RAi18n.t('auth.errorGeneric');
          err.hidden = false;
        } finally { btn.disabled = false; }
      };
    }

    if (activeTab === 'signup'){
      const form = wrap.querySelector('#signup-form');
      form.onsubmit = async (e) => {
        e.preventDefault();
        const err = wrap.querySelector('#signup-error'); err.hidden = true;
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          const pwd = wrap.querySelector('#su-password').value;
          if (pwd.length < 8) throw new Error(RAi18n.t('auth.minChars',{n:8}));
          await RAStorage.signup({
            email:    wrap.querySelector('#su-email').value,
            password: pwd,
            name:     wrap.querySelector('#su-name').value,
            age:      wrap.querySelector('#su-age').value,
            gender:   wrap.querySelector('#su-gender').value,
          });
          await afterLogin({ isFreshSignup: true });
        } catch (e2) {
          err.textContent = e2.message || RAi18n.t('auth.errorGeneric');
          err.hidden = false;
        } finally { btn.disabled = false; }
      };
    }

    if (activeTab === 'demo'){
      const btn = wrap.querySelector('#demo-go');
      btn.onclick = async () => {
        const err = wrap.querySelector('#demo-error'); err.hidden = true;
        btn.disabled = true;
        try {
          await RAStorage.loginAsDemo();
          await afterLogin();
        } catch (e2) {
          err.textContent = e2.message || RAi18n.t('auth.errorGeneric');
          err.hidden = false;
        } finally { btn.disabled = false; }
      };
    }
  }

  async function afterLogin(opts = {}){
    hide();
    if (typeof window.RABoot === 'function') {
      await window.RABoot({ isFreshSignup: !!opts.isFreshSignup });
    }
  }

  window.RAAuth = { show, hide, requireLogin };
})();
