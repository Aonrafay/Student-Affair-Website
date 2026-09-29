/* ==========================================================================
   Student Affairs CMS — per-page data loaders
   Each HTML page calls one loader: window.P.<name>()
   ========================================================================== */
(function () {
  'use strict';

  const SA = window.SA;
  const SITE = window.SITE;

  // ---------------------------------------------------------------- shared --
  const CATS = { news: ['News', 'blue'], announcement: ['Announcement', 'gold'], achievement: ['Achievement', 'green'] };

  function postCard(p) {
    const cat = CATS[p.category] || [p.category, ''];
    return '<a class="card-link" href="' + SA.BASE + '/news/' + encodeURIComponent(p.slug) + '">' +
      '<article class="card">' +
        SA.thumb(SA.mediaUrl(p.cover), p.title) +
        '<div class="card-body">' +
          '<span class="meta"><span class="badge ' + cat[1] + '">' + SA.esc(cat[0]) + '</span><time>' + SA.fmtDate(p.published_at) + '</time></span>' +
          '<h3>' + SA.esc(p.title) + '</h3>' +
          (p.excerpt ? '<p class="excerpt">' + SA.esc(p.excerpt) + '</p>' : '') +
          '<span class="foot txt-link">Read more &rarr;</span>' +
        '</div>' +
      '</article>' +
    '</a>';
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dateBlock(iso) {
    if (!iso) return '<div class="date-num"><b>TBC</b><span>date</span></div>';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '<div class="date-num"><b>TBC</b><span>date</span></div>';
    return '<div class="date-num"><b>' + d.getDate() + '</b><span>' + MONTHS[d.getMonth()] + '</span></div>';
  }

  function eventCard(e) {
    const when = (e.start_time ? SA.fmtDateTime(e.start_time) : 'Date to be confirmed');
    return '<a class="card-link" href="' + SA.BASE + '/events/' + encodeURIComponent(e.slug) + '">' +
      '<article class="card">' +
        SA.thumb(SA.mediaUrl(e.cover), e.title) +
        '<div class="card-body">' +
          '<span class="meta">&#128197; ' + SA.esc(when) + '</span>' +
          '<h3>' + SA.esc(e.title) + '</h3>' +
          (e.location ? '<span class="meta">&#128205; ' + SA.esc(e.location) + '</span>' : '') +
          '<span class="foot txt-link">Event details &rarr;</span>' +
        '</div>' +
      '</article>' +
    '</a>';
  }

  function societyCard(s) {
    return '<a class="card-link" href="' + SA.BASE + '/societies/' + encodeURIComponent(s.slug) + '">' +
      '<article class="card">' +
        SA.thumb(SA.mediaUrl(s.cover), s.name) +
        '<div class="card-body">' +
          '<h3>' + SA.esc(s.name) + '</h3>' +
          (s.tagline ? '<p class="excerpt">' + SA.esc(s.tagline) + '</p>' : '') +
        '</div>' +
      '</article>' +
    '</a>';
  }

  // ---------------------------------------------------------------- home ----

  function home(root) {
    // `/events/upcoming` (not `/events`) — the default list orders by start_time
    // DESC, which would surface past events under "Upcoming events".
    return Promise.all([
      SA.api('/pages/home').catch(function () { return { content: {} }; }),
      SA.api('/posts?limit=3'),
      SA.api('/events/upcoming?limit=3'),
      SA.api('/societies?limit=6'),
      SA.api('/partners?limit=20')
    ]).then(function (res) {
      const page = res[0];
      const posts = res[1];
      const events = res[2];
      const societies = res[3];
      const partners = res[4];
      const c = page.content || {};
      const hero = c.hero || {};
      const stats = c.stats || [];
      const about = c.about || {};

      const statHtml = stats.length
        ? '<div class="stat-row">' + stats.map(function (s) {
            return '<div class="stat"><b>' + SA.esc(s.value) + '</b><span>' + SA.esc(s.label) + '</span></div>';
          }).join('') + '</div>'
        : '';

      const partnerCards = partners.length ? partners.map(function (p) {
        const inner = '<div class="card partner-tile"><span class="logo">&#129309;</span><b>' + SA.esc(p.name) + '</b>' +
          (p.category ? '<span class="badge">' + SA.esc(p.category) + '</span>' : '') + '</div>';
        return p.website
          ? '<a class="card-link" href="' + SA.esc(p.website) + '" target="_blank" rel="noopener">' + inner + '</a>'
          : inner;
      }).join('') : '';

      root.innerHTML =
        '<div class="home-hero"><div class="container">' +
          (hero.badge ? '<span class="hero-badge">' + SA.esc(hero.badge) + '</span>' : '') +
          '<h1>' + SA.textToHtml(hero.title || '') + '</h1>' +
          (hero.subtitle ? '<p class="sub">' + SA.esc(hero.subtitle) + '</p>' : '') +
          '<div class="btn-row">' +
            (hero.ctaLink ? '<a class="btn" href="' + SA.esc(SA.BASE + (hero.ctaLink || '/events')) + '">' + SA.esc(hero.ctaLabel || 'Find out more') + '</a>' : '') +
            (hero.cta2Link ? '<a class="btn ghost" href="' + SA.esc(SA.BASE + (hero.cta2Link || '/societies')) + '">' + SA.esc(hero.cta2Label || 'Explore') + '</a>' : '') +
          '</div>' +
          statHtml +
        '</div></div>' +

        '<section class="container section">' +
          '<div class="section-head"><h2>Latest news</h2><a class="txt-link" href="' + SA.BASE + '/news">All news &rarr;</a></div>' +
          '<div class="grid-3">' + (posts.length ? posts.map(postCard).join('') : '<div class="state empty">No news published yet.</div>') + '</div>' +
        '</section>' +

        '<section class="section section-tinted"><div class="container">' +
          '<div class="section-head"><h2>Upcoming events</h2><a class="txt-link" href="' + SA.BASE + '/events">All events &rarr;</a></div>' +
          '<div class="grid-3">' + (events.length ? events.map(eventCard).join('') : '<div class="state empty">No upcoming events yet.</div>') + '</div>' +
        '</div></section>' +

        '<section class="container section">' +
          '<div class="section-head"><h2>Meet our societies</h2><a class="txt-link" href="' + SA.BASE + '/societies">All societies &rarr;</a></div>' +
          '<div class="grid-3">' + (societies.length ? societies.map(societyCard).join('') : '<div class="state empty">No societies yet.</div>') + '</div>' +
        '</section>' +

        (about.title ? '<section class="container section about-split">' +
          '<div><h2 class="section-head" style="margin:0 0 8px">' + SA.esc(about.title) + '</h2>' +
          (about.text ? '<p>' + SA.textToHtml(about.text) + '</p>' : '') + '</div>' +
          '<div class="panel"><h2>Who we are</h2><p>Meet the team that keeps student life running.</p><p><a class="btn" href="' + SA.BASE + '/office">Meet the team</a></p></div>' +
        '</section>' : '') +

        '<section class="container section">' +
          '<div class="section-head"><h2>Partners</h2><a class="txt-link" href="' + SA.BASE + '/partners">All partners &rarr;</a></div>' +
          '<div class="grid-4">' + (partnerCards || '<div class="state empty">No partners yet.</div>') + '</div>' +
        '</section>';
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ---------------------------------------------------------------- news ----
  function news(root, category) {
    const active = category || 'all';
    return SA.api('/posts').then(function (posts) {
      if (!posts.length) return SITE.stateEmpty(root, 'No news published yet.');
      const list = active === 'all' ? posts : posts.filter(function (p) { return p.category === active; });
      const toolbar = '<div class="toolbar">' +
        [['all', 'All'], ['news', 'News'], ['announcement', 'Announcements'], ['achievement', 'Achievements']].map(function (c) {
          const count = c[0] === 'all' ? posts.length : posts.filter(function (p) { return p.category === c[0]; }).length;
          return '<button class="pill-btn' + (active === c[0] ? ' active' : '') + '" data-cat="' + c[0] + '">' + c[1] + ' (' + count + ')</button>';
        }).join('') + '</div>';
      const grid = '<div class="grid-3" id="news-grid">' +
        (list.length ? list.map(postCard).join('') : '<div class="state empty">No posts in this category yet.</div>') +
        '</div>';
      root.innerHTML = toolbar + grid;
      root.querySelectorAll('.pill-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { news(root, btn.dataset.cat); });
      });
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ---------------------------------------------------------- news detail --
  function newsDetail(root, slug) {
    SITE.stateLoad(root, 'Loading article…');
    return SA.api('/posts/' + encodeURIComponent(slug)).then(function (p) {
      const cat = CATS[p.category] || [p.category, ''];
      root.innerHTML =
        '<article class="article">' +
          '<span class="badge ' + cat[1] + '">' + SA.esc(cat[0]) + '</span>' +
          '<h1>' + SA.esc(p.title) + '</h1>' +
          '<div class="meta"><time>Published ' + SA.fmtDate(p.published_at) + '</time></div>' +
          (SA.mediaUrl(p.cover) ? '<div class="article-hero-cover"><img src="' + SA.esc(SA.mediaUrl(p.cover)) + '" alt=""></div>' : '') +
          (p.excerpt ? '<p class="lead">' + SA.esc(p.excerpt) + '</p>' : '') +
          '<hr class="divider">' +
          (p.body ? '<div class="md-body">' + SA.mdToHtml(p.body) + '</div>' : '') +
          '<hr class="divider">' +
          '<p><a class="btn ghost" href="' + SA.BASE + '/news" style="color:var(--navy);border-color:var(--navy)">&larr; All news</a></p>' +
        '</article>';
    }).catch(function (err) {
      SITE.stateError(root, err);
    });
  }
// -------------------------------------------------------------- events ----
  function events(root, scope) {
    const active = scope || 'upcoming';
    const endpoints = { upcoming: '/events/upcoming', past: '/events/past', all: '/events' };
    SITE.stateLoad(root, 'Loading events…');
    return SA.api(endpoints[active]).then(function (items) {
      if (!items.length) return SITE.stateEmpty(root, 'No events in this view yet.');
      const toolbar =
        '<div class="toolbar">' +
          '<button class="pill-btn' + (active === 'upcoming' ? ' active' : '') + '" data-scope="upcoming">Upcoming</button>' +
          '<button class="pill-btn' + (active === 'past' ? ' active' : '') + '" data-scope="past">Past events</button>' +
          '<button class="pill-btn' + (active === 'all' ? ' active' : '') + '" data-scope="all">All</button>' +
        '</div>';
      const rows = '<div class="list">' + items.map(function (e) {
        return '<div class="row">' +
          dateBlock(e.start_time) +
          '<div>' +
            '<h3><a href="' + SA.BASE + '/events/' + encodeURIComponent(e.slug) + '">' + SA.esc(e.title) + '</a></h3>' +
            '<p>' + (e.start_time ? SA.fmtDateTime(e.start_time) : 'Date to be confirmed') +
              (e.location ? ' &middot; ' + SA.esc(e.location) : '') +
            '</p>' +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
      root.innerHTML = toolbar + rows;
      root.querySelectorAll('.pill-btn').forEach(function (btn) {
        btn.addEventListener('click', function () { events(root, btn.dataset.scope); });
      });
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // -------------------------------------------------------- event detail ---
  function eventDetail(root, slug) {
    SITE.stateLoad(root, 'Loading event…');
    return SA.api('/events/' + encodeURIComponent(slug)).then(function (e) {
      const listHtml = function (arr) {
        if (!arr || !arr.length) return '';
        return '<ul class="tick-list">' + arr.map(function (x) {
          return '<li>' + SA.textToHtml(x) + '</li>';
        }).join('') + '</ul>';
      };
      const kv = '<div class="keyval">' +
        (e.start_time ? '<div class="kv-row"><span class="k">Starts</span><span class="v">' + SA.fmtDateTime(e.start_time) + '</span></div>' : '') +
        (e.end_time ? '<div class="kv-row"><span class="k">Ends</span><span class="v">' + SA.fmtDateTime(e.end_time) + '</span></div>' : '') +
        (e.location ? '<div class="kv-row"><span class="k">Location</span><span class="v">' + SA.esc(e.location) + '</span></div>' : '') +
        '</div>';
      const galleryHtml = (e.gallery && e.gallery.length) ? '<div class="section"><h2>Gallery</h2><div class="grid-3">' + e.gallery.map(function (g) {
        const url = (g && g.indexOf('/') === 0) ? SA.BASE + g : SA.mediaUrl(g);
        return url ? '<div class="article-hero-cover" style="height:140px;margin:0"><img src="' + SA.esc(url) + '" alt="" loading="lazy"></div>' : '';
      }).join('') + '</div></div>' : '';
      root.innerHTML =
        '<article class="article">' +
          '<h1>' + SA.esc(e.title) + '</h1>' +
          '<div class="meta"><span>' + (e.start_time ? SA.fmtDateTime(e.start_time) : 'TBC') + '</span>' +
            (e.location ? '<span>' + SA.esc(e.location) + '</span>' : '') + '</div>' +
          (SA.mediaUrl(e.cover) ? '<div class="article-hero-cover"><img src="' + SA.esc(SA.mediaUrl(e.cover)) + '" alt=""></div>' : '') +
          (e.description ? '<div class="md-body">' + SA.mdToHtml(e.description) + '</div>' : '') +
          '<hr class="divider">' +
          kv +
          (e.highlights && e.highlights.length ? '<h2>Highlights</h2>' + listHtml(e.highlights) : '') +
          (e.results && e.results.length ? '<h2>Outcomes & results</h2>' + listHtml(e.results) : '') +
          galleryHtml +
          (e.registration_url ? '<p><a class="btn" href="' + SA.esc(e.registration_url) + '" target="_blank" rel="noopener">Register for this event</a></p>' : '') +
          '<p><a class="btn ghost" href="' + SA.BASE + '/events" style="color:var(--navy);border-color:var(--navy)">&larr; All events</a></p>' +
        '</article>';
    }).catch(function (err) { SITE.stateError(root, err); });
  }
// ------------------------------------------------------------- notices -----
  function notices(root) {
    SITE.stateLoad(root, 'Loading notices…');
    return SA.api('/notices').then(function (items) {
      if (!items.length) return SITE.stateEmpty(root, 'No notices at the moment.');
      root.innerHTML = items.map(function (n) {
        return '<article class="notice-item">' +
          '<h3>' + SA.esc(n.title) + '</h3>' +
          '<div class="md-body">' + SA.mdToHtml(n.body) + '</div>' +
          '<div class="meta">' +
            '<span>' + SA.fmtDate(n.published_at) + '</span>' +
            (n.pdf ? ' &middot; <a href="' + SA.esc(SA.mediaUrl(n.pdf)) + '" target="_blank" rel="noopener">Download PDF</a>' : '') +
          '</div>' +
        '</article>';
      }).join('');
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ----------------------------------------------------------- societies ----
  function societies(root) {
    SITE.stateLoad(root, 'Loading societies…');
    return SA.api('/societies').then(function (items) {
      if (!items.length) return SITE.stateEmpty(root, 'No societies are listed yet — the office is still collecting the current list. Check back soon or contact us for details.');
      root.innerHTML = '<div class="grid-3">' + items.map(societyCard).join('') + '</div>';
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ------------------------------------------------------ society detail ----
  // The society keeps its timeless info (motto, purpose, features); each year
  // ("2025-26"…) is a Markdown page with that year's officers + committee.
  function societyDetail(root, slug) {
    SITE.stateLoad(root, 'Loading society…');
    return SA.api('/societies/' + encodeURIComponent(slug)).then(function (s) {
      const years = s.years || [];

      // People of one year page, laid out by designation:
      //   lead officer (first by sort order) → hero card
      //   remaining officers                → medium cards
      //   committee                         → compact rows
      const photoHtml = function (m, cls) {
        return '<span class="person-avatar ' + cls + '">' +
          (SA.mediaUrl(m.photo)
            ? '<img src="' + SA.esc(SA.mediaUrl(m.photo)) + '" alt="' + SA.esc(m.name) + '">'
            : SA.esc(SA.initials(m.name))) +
        '</span>';
      };

      const heroCardHtml = function (m) {
        return '<div class="person-hero">' + photoHtml(m, 'lg') +
          '<div class="person-hero-info">' +
            '<h3>' + SA.esc(m.name || '') + '</h3>' +
            (m.role ? '<span class="person-role-badge">' + SA.esc(m.role) + '</span>' : '') +
            (m.bio ? '<p class="person-bio">' + SA.esc(m.bio) + '</p>' : '') +
            (m.email ? '<a class="person-email" href="mailto:' + SA.esc(m.email) + '">' + SA.esc(m.email) + '</a>' : '') +
          '</div></div>';
      };

      const officerCardHtml = function (m) {
        return '<div class="person-card-sm">' + photoHtml(m, 'md') +
          '<div class="person-info">' +
            '<b>' + SA.esc(m.name || '') + '</b>' +
            (m.role ? '<span class="person-role">' + SA.esc(m.role) + '</span>' : '') +
            (m.bio ? '<p class="person-bio">' + SA.esc(m.bio) + '</p>' : '') +
            (m.email ? '<a href="mailto:' + SA.esc(m.email) + '">' + SA.esc(m.email) + '</a>' : '') +
          '</div></div>';
      };

      const memberRowHtml = function (m) {
        return '<div class="person-row">' + photoHtml(m, 'sm') +
          '<span class="person-info"><b>' + SA.esc(m.name || '') + '</b>' +
            (m.role ? '<span>' + SA.esc(m.role) + '</span>' : '') +
            (m.email ? '<a href="mailto:' + SA.esc(m.email) + '">' + SA.esc(m.email) + '</a>' : '') +
          '</span></div>';
      };

      const peopleHtml = function (y) {
        const officers = (y.members || []).filter(function (m) { return m.category === 'officer'; });
        const committee = (y.members || []).filter(function (m) { return m.category !== 'officer'; });
        if (!officers.length && !committee.length) return '';
        // The first officer in sort order leads the society — give them the hero
        // card so the page reads top-down by designation.
        const lead = officers.length ? officers[0] : null;
        const rest = officers.slice(1);
        return '<div class="panel people-panel">' +
          (lead
            ? '<h2>Office bearers</h2>' + heroCardHtml(lead) +
              (rest.length ? '<div class="people-cards">' + rest.map(officerCardHtml).join('') + '</div>' : '')
            : '') +
          (committee.length
            ? '<h2' + (lead ? ' class="people-sub"' : '') + '>Committee</h2>' +
              '<div class="people-list">' + committee.map(memberRowHtml).join('') + '</div>'
            : '') +
        '</div>';
      };

      const renderYear = function (y) {
        return (y.title ? '<h2 class="year-title">' + SA.esc(y.title) + '</h2>' : '') +
          (SA.mediaUrl(y.cover)
            ? '<div class="article-hero-cover"><img src="' + SA.esc(SA.mediaUrl(y.cover)) + '" alt=""></div>'
            : '') +
          (y.body ? '<div class="md-body">' + SA.mdToHtml(y.body) + '</div>' : '') +
          peopleHtml(y);
      };

      const featuresHtml = (s.features && s.features.length)
        ? '<ul class="tick-list">' + s.features.map(function (f) { return '<li>' + SA.esc(f) + '</li>'; }).join('') + '</ul>'
        : '';

      let html =
        '<article class="article">' +
          '<a class="txt-link" href="' + SA.BASE + '/societies" style="font-size:13px">&larr; All societies</a>' +
          '<h1 style="margin-top:8px">' + SA.esc(s.name) + '</h1>' +
          '<div class="meta">' + (s.tagline ? SA.esc(s.tagline) : '') + '</div>' +
          (SA.mediaUrl(s.cover) ? '<div class="article-hero-cover"><img src="' + SA.esc(SA.mediaUrl(s.cover)) + '" alt=""></div>' : '') +
          (s.motto ? '<blockquote class="panel" style="margin:0 0 16px;font-style:italic;color:var(--navy-soft)">&ldquo;' + SA.esc(s.motto) + '&rdquo;</blockquote>' : '') +
          (s.purpose ? '<p class="lead">' + SA.esc(s.purpose) + '</p>' : '') +
          (featuresHtml ? '<h2>What we do</h2>' + featuresHtml : '') +
        '</article>';

      if (years.length) {
        html += '<div class="year-tabs" role="tablist" aria-label="Society years">' +
          years.map(function (y, i) {
            return '<button type="button" role="tab" class="year-tab' + (i === 0 ? ' active' : '') +
              '" data-idx="' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '">' +
              SA.esc(y.year) + '</button>';
          }).join('') + '</div>' +
          '<div id="year-content" class="article" role="tabpanel"></div>';
      } else {
        html += '<div class="panel" style="margin-top:24px"><p>' +
          'This society has not published a year page yet — check back soon.</p></div>';
      }

      root.innerHTML = html;

      if (years.length) {
        const content = root.querySelector('#year-content');
        const tabs = root.querySelectorAll('.year-tab');
        tabs.forEach(function (tab) {
          tab.addEventListener('click', function () {
            tabs.forEach(function (t) {
              t.classList.toggle('active', t === tab);
              t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
            });
            content.innerHTML = renderYear(years[Number(tab.getAttribute('data-idx'))]);
            window.scrollTo({ top: content.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
          });
        });
        content.innerHTML = renderYear(years[0]);
      }
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ---------------------------------------------------------------- office --
  function office(root) {
    SITE.stateLoad(root, 'Loading the team…');
    return Promise.all([SA.api('/team'), SA.api('/pages/about-head').catch(function () { return { content: {} }; })])
      .then(function (res) {
        const members = res[0];
        const about = (res[1].content) || {};
        let html = '';
        if (about.title) {
          html += '<div class="article" style="margin:0 auto 36px"><h1>' + SA.esc(about.title) + '</h1>' +
            (about.text ? '<p class="lead">' + SA.esc(about.text) + '</p>' : '') + '</div>';
        }
        if (about.values && about.values.length) {
          html += '<div class="grid-3" style="margin-bottom:36px">' + about.values.map(function (v) {
            return '<div class="card"><div class="card-body"><h3>' + SA.esc(v.title) + '</h3><p class="excerpt">' + SA.esc(v.text) + '</p></div></div>';
          }).join('') + '</div>';
        }
        if (!members.length) {
          // Seeded installs have no team yet — keep the "about the office" copy
          // visible and explain the missing list instead of dropping everything.
          html += '<div class="state empty"><div class="big">&#128101;</div>' +
            '<p>The team profiles are not published yet.</p>' +
            '<p>Please contact the office if you need to reach a specific member of staff.</p></div>';
          root.innerHTML = html;
          return;
        }
        // Featured staff (the `featured` checkbox in the admin) are shown first,
        // in a large card with a big photo; the rest keep the standard card.
        const featured = members.filter(function (m) { return m.featured; });
        const others = members.filter(function (m) { return !m.featured; });

        const bigCard = function (m) {
          return '<article class="card person-card person-card-lead">' +
            '<div class="person-lead-photo">' + (SA.mediaUrl(m.photo)
              ? '<img src="' + SA.esc(SA.mediaUrl(m.photo)) + '" alt="' + SA.esc(m.name) + '">'
              : '<span class="ph-text">' + SA.esc(SA.initials(m.name)) + '</span>') + '</div>' +
            '<div class="card-body">' +
              (m.role ? '<span class="person-role-badge">' + SA.esc(m.role) + '</span>' : '') +
              '<h3>' + SA.esc(m.name) + '</h3>' +
              (m.bio ? '<p class="person-bio">' + SA.esc(m.bio) + '</p>' : '') +
              (m.email ? '<a class="person-email" href="mailto:' + SA.esc(m.email) + '">' + SA.esc(m.email) + '</a>' : '') +
            '</div>' +
          '</article>';
        };

        const stdCard = function (m) {
          return '<article class="card person-card">' +
            '<div class="thumb person-card-photo"><span class="ph-text">' + SA.esc(m.role || '') + '</span></div>' +
            '<div class="avatar">' + (SA.mediaUrl(m.photo)
              ? '<img src="' + SA.esc(SA.mediaUrl(m.photo)) + '" alt="' + SA.esc(m.name) + '">'
              : SA.esc(SA.initials(m.name))) + '</div>' +
            '<div class="card-body">' +
              '<h3>' + SA.esc(m.name) + '</h3>' +
              (m.role ? '<span class="role">' + SA.esc(m.role) + '</span>' : '') +
              (m.bio ? '<p class="excerpt">' + SA.esc(m.bio) + '</p>' : '') +
              (m.email ? '<a href="mailto:' + SA.esc(m.email) + '">' + SA.esc(m.email) + '</a>' : '') +
            '</div>' +
          '</article>';
        };

        if (featured.length) {
          html += '<div class="office-featured">' + featured.map(bigCard).join('') + '</div>';
        }
        if (others.length) {
          html += '<div class="grid-3">' + others.map(stdCard).join('') + '</div>';
        }
        root.innerHTML = html;
      }).catch(function (err) { SITE.stateError(root, err); });
  }
  // ------------------------------------------------------------- partners ---
  // Collaboration types, most important first. Mirrors `partnerCategories` in
  // admin/js/modules.js (the admin select uses the same list). Any category that
  // is not in this list (legacy rows) still renders, after the known ones.
  const PARTNER_CATEGORIES = [
    'Strategic Partners',
    'Academic Collaborations',
    'Industry Partners',
    'Community Partners'
  ];

  function partnerLogoHtml(p, maxHeight) {
    return SA.mediaUrl(p.logo)
      ? '<img src="' + SA.esc(SA.mediaUrl(p.logo)) + '" alt="' + SA.esc(p.name) + '" style="max-height:' + maxHeight + 'px;width:auto;margin:0 auto">'
      : '<span aria-hidden="true">&#129309;</span>';
  }

  function partners(root) {
    SITE.stateLoad(root, 'Loading partners…');
    return SA.api('/partners').then(function (items) {
      if (!items.length) return SITE.stateEmpty(root, 'No partners are listed yet. Contact the office if you would like your organisation featured here.');

      // Group by category, keeping the fixed importance order; anything unknown
      // goes last, alphabetically.
      const grouped = {};
      items.forEach(function (p) {
        const cat = p.category || 'Partners';
        (grouped[cat] = grouped[cat] || []).push(p);
      });
      Object.keys(grouped).forEach(function (cat) {
        grouped[cat].sort(function (a, b) {
          const d = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
          return d !== 0 ? d : a.name.localeCompare(b.name);
        });
      });
      const known = PARTNER_CATEGORIES.filter(function (c) { return grouped[c]; });
      const extra = Object.keys(grouped).filter(function (c) { return PARTNER_CATEGORIES.indexOf(c) === -1; }).sort();
      const order = known.concat(extra);

      root.innerHTML = order.map(function (cat) {
        const list = grouped[cat];
        // The most important partner of the category (lowest sort order) gets
        // the spotlight card; the rest are standard tiles.
        const lead = list[0];
        const rest = list.slice(1);
        const tile = function (p) {
          return '<a class="card-link" href="' + SA.BASE + '/partners/' + encodeURIComponent(p.slug) + '">' +
            '<div class="card partner-tile"><span class="logo">' + partnerLogoHtml(p, 44) + '</span>' +
            '<b>' + SA.esc(p.name) + '</b></div></a>';
        };
        const spotlight = '<a class="card-link" href="' + SA.BASE + '/partners/' + encodeURIComponent(lead.slug) + '">' +
          '<div class="card partner-tile partner-spotlight"><span class="logo">' + partnerLogoHtml(lead, 64) + '</span>' +
          '<b>' + SA.esc(lead.name) + '</b>' +
          (lead.website ? '<span class="spotlight-link">View partnership &rarr;</span>' : '') + '</div></a>';

        return '<section class="partner-section">' +
          '<h2>' + SA.esc(cat) + '</h2>' +
          '<div class="grid-4 partner-grid">' + spotlight + rest.map(tile).join('') + '</div>' +
        '</section>';
      }).join('');
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ------------------------------------------------------- partner detail ---
  function partnerDetail(root, slug) {
    SITE.stateLoad(root, 'Loading partner…');
    return SA.api('/partners/' + encodeURIComponent(slug)).then(function (p) {
      root.innerHTML =
        '<article class="article partner-detail">' +
          '<a class="txt-link" href="' + SA.BASE + '/partners" style="font-size:13px">&larr; All partners</a>' +
          '<div class="partner-detail-head">' +
            '<span class="partner-detail-logo">' + partnerLogoHtml(p, 72) + '</span>' +
            '<div>' +
              (p.category ? '<span class="partner-cat-badge">' + SA.esc(p.category) + '</span>' : '') +
              '<h1 style="margin:6px 0 0">' + SA.esc(p.name) + '</h1>' +
            '</div>' +
          '</div>' +
          (SA.mediaUrl(p.cover)
            ? '<div class="article-hero-cover"><img src="' + SA.esc(SA.mediaUrl(p.cover)) + '" alt=""></div>'
            : '') +
          (p.description ? '<div class="md-body">' + SA.mdToHtml(p.description) + '</div>' : '') +
          (p.website
            ? '<p style="margin-top:22px"><a class="btn" href="' + SA.esc(p.website) + '" target="_blank" rel="noopener">Visit website &nearr;</a></p>'
            : '') +
          '<p style="margin-top:26px"><a class="btn ghost" href="' + SA.BASE + '/partners" style="color:var(--navy);border-color:var(--navy)">&larr; All partners</a></p>' +
        '</article>';
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ----------------------------------------------------------- documents ----
  function documents(root) {
    SITE.stateLoad(root, 'Loading documents…');
    return SA.api('/documents').then(function (items) {
      if (!items.length) return SITE.stateEmpty(root, 'No documents are published yet. Forms and policies are also available from the front desk at the Student Life Centre.');
      const grouped = {};
      items.forEach(function (d) {
        const cat = d.category || 'Documents';
        (grouped[cat] = grouped[cat] || []).push(d);
      });
      root.innerHTML = Object.keys(grouped).map(function (cat) {
        return '<section style="margin-bottom:28px"><h2 style="color:var(--navy)">' + SA.esc(cat) + '</h2><div class="panel">' +
          grouped[cat].map(function (d) {
            const fileUrl = SA.mediaUrl(d.file);
            return '<div class="doc-row">' +
              '<span class="icon">' + (fileUrl ? '&#128196;' : '&#128203;') + '</span>' +
              '<div>' +
                '<h3>' + (fileUrl
                  ? '<a href="' + SA.esc(fileUrl) + '" target="_blank" rel="noopener">' + SA.esc(d.title) + '</a>'
                  : SA.esc(d.title)) + '</h3>' +
                (d.description ? '<p>' + SA.esc(d.description) + '</p>' : '') +
                (!fileUrl ? '<p style="font-style:italic">Available at the Student Life Centre front desk.</p>' : '') +
              '</div>' +
            '</div>';
          }).join('') + '</div></section>';
      }).join('');
    }).catch(function (err) { SITE.stateError(root, err); });
  }
// -------------------------------------------------------------- contact ----
  function contact(root) {
    return Promise.all([
      SA.api('/pages/contact').catch(function () { return { content: {} }; }),
      SA.api('/settings')
    ]).then(function (res) {
      const c = (res[0].content) || {};
      const s = res[1] || {};
      root.innerHTML =
        '<div class="grid-2">' +
          '<div class="panel">' +
            '<h2>' + SA.esc(c.title || 'Get in touch') + '</h2>' +
            (c.text ? '<p>' + SA.esc(c.text) + '</p>' : '') +
            (c.visit ? '<p style="font-style:italic">' + SA.esc(c.visit) + '</p>' : '') +
            '<hr class="divider">' +
            '<div class="keyval">' +
              (s.office_email ? '<div class="kv-row"><span class="k">Email</span><span class="v"><a href="mailto:' + SA.esc(s.office_email) + '">' + SA.esc(s.office_email) + '</a></span></div>' : '') +
              (s.office_phone ? '<div class="kv-row"><span class="k">Phone</span><span class="v">' + SA.esc(s.office_phone) + '</span></div>' : '') +
              (s.office_location ? '<div class="kv-row"><span class="k">Address</span><span class="v">' + SA.esc(s.office_location) + '</span></div>' : '') +
              (s.office_hours ? '<div class="kv-row"><span class="k">Office hours</span><span class="v">' + SA.esc(s.office_hours) + '</span></div>' : '') +
            '</div>' +
          '</div>' +
          '<div class="panel">' +
            '<h2>Planning to visit?</h2>' +
            '<p>The Student Life Centre is in the building opposite the main lecture theatre. The front desk is your first stop for room bookings, society queries and ID cards.</p>' +
            '<p><strong>Access:</strong> entrance is step-free and a quiet waiting area is available on request.</p>' +
            '<h2>Follow us</h2>' +
            '<p>' +
              (s.social_facebook ? '<a href="' + SA.esc(s.social_facebook) + '" target="_blank" rel="noopener">Facebook</a> ' : '') +
              (s.social_instagram ? '<a href="' + SA.esc(s.social_instagram) + '" target="_blank" rel="noopener">Instagram</a> ' : '') +
              (s.social_twitter ? '<a href="' + SA.esc(s.social_twitter) + '" target="_blank" rel="noopener">X</a>' : '') +
            '</p>' +
          '</div>' +
        '</div>';
    }).catch(function (err) { SITE.stateError(root, err); });
  }

  // ------------------------------------------------------------------ init --
  window.P = {
    home: home,
    news: news,
    newsDetail: newsDetail,
    events: events,
    eventDetail: eventDetail,
    notices: notices,
    societies: societies,
    societyDetail: societyDetail,
    office: office,
    partners: partners,
    partnerDetail: partnerDetail,
    documents: documents,
    contact: contact
  };

  document.addEventListener('DOMContentLoaded', function () {
    SITE.boot();
  });
})();