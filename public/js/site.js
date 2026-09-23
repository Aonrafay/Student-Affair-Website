/* ==========================================================================
   Student Affairs CMS — shared chrome: header, footer, states
   ========================================================================== */
(function () {
  'use strict';

  const SA = window.SA;
  const NAV = [
    ['', 'Home'],
    ['/news', 'News'],
    ['/events', 'Events'],
    ['/notices', 'Notices'],
    ['/societies', 'Societies'],
    ['/office', 'Office'],
    ['/partners', 'Partners'],
    ['/documents', 'Documents'],
    ['/contact', 'Contact']
  ];

  /** Path relative to the base mount, e.g. '/news/hello'. */
  function sitePath() {
    let rest = location.pathname;
    if (SA.BASE && rest.indexOf(SA.BASE) === 0) rest = rest.slice(SA.BASE.length);
    if (rest.length > 1 && rest.charAt(rest.length - 1) === '/') rest = rest.slice(0, -1);
    return rest || '/';
  }

  function renderHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;
    const path = sitePath();

    const navHtml = NAV.map(function (item) {
      const href = SA.BASE + item[0];
      const active = (item[0] === '' && (path === '/' || path === '')) ||
        (item[0] !== '' && path === item[0]) ||
        (item[0] !== '' && path.indexOf(item[0] + '/') === 0);
      return '<a href="' + href + '"' + (active ? ' class="active"' : '') + '>' + SA.esc(item[1]) + '</a>';
    }).join('');

    // The class is what site.css styles — without it the header has no chrome,
    // the nav links lose their contrast and the mobile dropdown anchors to the
    // wrong container (site.css `.site-nav { position: absolute; top: 100% }`).
    header.className = 'site-header';
    header.innerHTML =
      '<a class="skip-link" href="#page-root">Skip to main content</a>' +
      '<div class="top-strip">' +
        '<div class="container">' +
          '<span class="strip-left"><b>NIIT</b> &middot; NASTP Institute of Information Technology &middot; A Constituent College of Air University, Islamabad</span>' +
          '<span class="top-strip-right" id="strip-contact"><span>Loading contact…</span></span>' +
        '</div>' +
      '</div>' +
      '<div class="header-bar">' +
        '<div class="container header-main">' +
          '<a class="brand" href="' + SA.BASE + '/" aria-label="Student Affairs — home">' +
            '<span class="brand-mark">SA</span>' +
            '<span>Student Affairs<small>Office of Student Affairs</small></span>' +
          '</a>' +
          '<nav class="site-nav" id="site-nav" aria-label="Main navigation">' + navHtml + '</nav>' +
          '<button class="nav-toggle" id="nav-toggle" aria-label="Toggle menu" aria-expanded="false">&#9776;</button>' +
        '</div>' +
      '</div>';
  }

  function renderFooter(settings) {
    const footer = document.getElementById('site-footer');
    if (!footer) return;
    const s = settings || {};
    // Same as the header: the class is required for site.css to style (and
    // colour) the footer — without it the links render white on the page bg.
    footer.className = 'site-footer';
    const email = '<a href="mailto:' + SA.esc(s.office_email || '') + '">' + SA.esc(s.office_email || '—') + '</a>';
    const phone = SA.esc(s.office_phone || '—');
    const hours = SA.esc(s.office_hours || '—');
    const locationTxt = SA.esc(s.office_location || '—');
    footer.innerHTML =
      '<div class="container">' +
        '<div class="footer-cols">' +
          '<div>' +
            '<h4>Office of Student Affairs</h4>' +
            '<p>Supporting student life at NASTP Institute of Information Technology (NIIT), a constituent college of Air University, Islamabad.</p>' +
            '<p><a href="' + SA.BASE + '/admin/login" rel="nofollow">Staff sign in</a></p>' +
          '</div>' +
          '<div>' +
            '<h4>Contact</h4>' +
            '<p>' + email + '</p>' +
            '<p>' + phone + '</p>' +
            '<p>' + locationTxt + '</p>' +
          '</div>' +
          '<div>' +
            '<h4>Office hours</h4>' +
            '<p>' + hours + '</p>' +
            '<p><a href="' + SA.BASE + '/contact">Contact &amp; visit us</a></p>' +
          '</div>' +
        '</div>' +
        '<div class="footer-bottom">' +
          '<span>&copy; ' + new Date().getFullYear() + ' NASTP Institute of Information Technology (NIIT) — Office of Student Affairs</span>' +
          '<span>Site managed by Student Affairs staff</span>' +
        '</div>' +
      '</div>';
  }

  // --- Loading / empty / error states ----------------------------------------
  function stateLoad(el, message) {
    el.innerHTML = '<div class="state"><div class="spinner"></div><p>' + SA.esc(message || 'Loading…') + '</p></div>';
  }
  function stateEmpty(el, message) {
    el.innerHTML = '<div class="state empty"><div class="big">&#128194;</div><p>' + SA.esc(message || 'Nothing here yet — check back soon.') + '</p></div>';
  }
  function stateError(el, err) {
    el.innerHTML = '<div class="state error"><h3>Something went wrong</h3><p>' + SA.esc((err && err.message) || 'Please try again.') + '</p></div>';
  }

  function bindNavToggle() {
    const btn = document.getElementById('nav-toggle');
    const nav = document.getElementById('site-nav');
    if (btn && nav) {
      btn.addEventListener('click', function () {
        const open = nav.classList.toggle('open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
  }

  async function boot() {
    renderHeader();
    bindNavToggle();
    try {
      const settings = await SA.api('/settings');
      renderFooter(settings);
      const strip = document.getElementById('strip-contact');
      if (strip) {
        strip.innerHTML = '<span>' + SA.esc(settings.office_phone || '') + '</span>' +
          '<a href="mailto:' + SA.esc(settings.office_email || '') + '">' + SA.esc(settings.office_email || '') + '</a>';
      }
    } catch (e) {
      renderFooter({});
      // Never leave the strip stuck on "Loading contact…".
      const strip = document.getElementById('strip-contact');
      if (strip) strip.innerHTML = '<span>Office of Student Affairs</span>';
    }
  }

  window.SITE = { boot: boot, stateLoad: stateLoad, stateEmpty: stateEmpty, stateError: stateError, sitePath: sitePath };
})();