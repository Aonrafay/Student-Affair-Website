/* ==========================================================================
   Student Affairs CMS — admin SPA
   Hash-routed: #/dashboard  #/m/<module>[/{new|id}]  #/media  #/pages
                 #/pages/<key>  #/settings  #/users
                 #/m/societies/<sid>/years[/{new|<yid>}]   (year pages +
                 their people — Markdown story per society per year)
   Depends on: auth.js (window.AdminAuth), modules.js (window.ADMIN_MODULES),
               admin/js/vendor/marked.min.js (window.marked — optional)
   ========================================================================== */
(function () {
  'use strict';

  var A = window.AdminAuth;
  var MODULES = window.ADMIN_MODULES || [];
  var EXTRAS = window.ADMIN_EXTRAS || [];

  var user = A.user();
  if (!A.token() || !user) {
    location.href = A.loginUrl();
    return;
  }

  // ---------------------------------------------------------------- helpers --
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
  }

  /** ISO string → value for <input type="datetime-local"> (local time). */
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function canAccess(item) {
    var roles = item.roles || ['admin'];
    return roles.indexOf(user.role) !== -1;
  }

  /** First letter uppercase (toasts read better: "Society saved"). */
  function upperFirst(text) {
    var s = String(text || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function moduleById(id) {
    for (var i = 0; i < MODULES.length; i++) {
      if (MODULES[i].id === id) return MODULES[i];
    }
    return null;
  }

  function statusBadge(status) {
    return '<span class="badge ' + (status === 'published' ? 'ok' : 'warn') + '">' +
      esc(status === 'published' ? 'Published' : 'Draft') + '</span>';
  }

  var toastTimer = null;
  function toast(message, kind) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast show' + (kind === 'error' ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3200);
  }

  function view() {
    return document.getElementById('view');
  }

  function stateLoad(el, message) {
    el.innerHTML = '<div class="state"><div class="spinner"></div><p>' + esc(message || 'Loading…') + '</p></div>';
  }

  function stateError(el, err) {
    el.innerHTML = '<div class="state error"><h3>Something went wrong</h3><p>' +
      esc((err && err.message) || 'Please try again.') + '</p></div>';
  }

  function stateEmpty(el, message, actionHtml) {
    el.innerHTML = '<div class="state empty"><p>' + esc(message) + '</p>' + (actionHtml || '') + '</div>';
  }

  /** Promise<boolean> confirm dialog (no alert()/confirm() anywhere). */
  function confirmDialog(title, message, confirmLabel) {
    return new Promise(function (resolve) {
      var root = document.getElementById('modal-root');
      root.innerHTML =
        '<div class="modal-overlay"><div class="modal" role="dialog" aria-modal="true">' +
          '<h3>' + esc(title) + '</h3><p>' + esc(message) + '</p>' +
          '<div class="modal-actions">' +
            '<button class="btn" id="modal-cancel">Cancel</button>' +
            '<button class="btn danger" id="modal-ok">' + esc(confirmLabel || 'Delete') + '</button>' +
          '</div></div></div>';
      function close(result) { root.innerHTML = ''; resolve(result); }
      document.getElementById('modal-cancel').addEventListener('click', function () { close(false); });
      document.getElementById('modal-ok').addEventListener('click', function () { close(true); });
      root.querySelector('.modal-overlay').addEventListener('click', function (e) {
        if (e.target === this) close(false);
      });
    });
  }

  // ----------------------------------------------------------------- shell --
  function renderShell() {
    var modLinks = MODULES.filter(canAccess).map(function (m) {
      return '<a href="#/m/' + m.id + '" data-route="m/' + m.id + '"><span class="ico">' + m.icon + '</span>' + esc(m.label) + '</a>';
    }).join('');
    var extraLinks = EXTRAS.filter(canAccess).map(function (x) {
      return '<a href="#/' + x.route + '" data-route="' + x.route + '"><span class="ico">' + x.icon + '</span>' + esc(x.label) + '</a>';
    }).join('');

    document.getElementById('sidebar-nav').innerHTML =
      '<div class="nav-group"><div class="nav-label">Content</div>' + modLinks + '</div>' +
      '<div class="nav-group"><div class="nav-label">Office</div>' + extraLinks + '</div>';

    document.getElementById('who').innerHTML =
      '<b>' + esc(user.name) + '</b><span class="role-pill ' + esc(user.role) + '">' + esc(user.role) + '</span>';
  }

  function setActiveNav(routePath) {
    document.querySelectorAll('#sidebar-nav a').forEach(function (a) {
      var target = a.getAttribute('data-route');
      var active = routePath === target || routePath.indexOf(target + '/') === 0;
      a.classList.toggle('active', !!active);
    });
  }

  function noAccess() {
    view().innerHTML = '<div class="panel"><h2>No access</h2>' +
      '<p>Your role (<b>' + esc(user.role) + '</b>) cannot open this section.</p>' +
      '<p><a class="btn" href="#/dashboard">Back to dashboard</a></p></div>';
  }

  // ----------------------------------------------------------------- router --
  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('/').filter(Boolean);
    var head = parts[0] || 'dashboard';
    setActiveNav(parts.join('/') || 'dashboard');

    if (head === 'dashboard' || hash === '') return pageDashboard();
    if (head === 'm' && parts[1]) {
      var mod = moduleById(parts[1]);
      if (!mod || !canAccess(mod)) return noAccess();
      if (parts[2] === 'new') return pageForm(mod, null);
      if (parts[2] && Number(parts[2])) {
        if (mod.child && parts[3] === mod.child.route) {
          // Society drill-down: #/m/societies/<sid>/years[/{new|<yid>}]
          if (parts[4] === 'new') return pageYearEditor(mod, Number(parts[2]), null);
          if (parts[4] && Number(parts[4])) return pageYearEditor(mod, Number(parts[2]), Number(parts[4]));
          return pageSocietyYears(mod, Number(parts[2]));
        }
        return pageForm(mod, Number(parts[2]));
      }
      return pageList(mod);
    }
    if (head === 'media') return canAccess({ roles: ['admin', 'editor'] }) ? pageMedia() : noAccess();
    if (head === 'pages' && parts[1]) return user.role === 'admin' ? pagePageEditor(parts[1]) : noAccess();
    if (head === 'pages') return user.role === 'admin' ? pagePages() : noAccess();
    if (head === 'settings') return user.role === 'admin' ? pageSettings() : noAccess();
    if (head === 'users') return user.role === 'admin' ? pageUsers() : noAccess();
    if (head === 'activity') return user.role === 'admin' ? pageActivity() : noAccess();
    if (head === 'backup') return user.role === 'admin' ? pageBackup() : noAccess();
    return pageDashboard();
  }

  // -------------------------------------------------------------- dashboard --
  function pageDashboard() {
    var el = view();
    stateLoad(el, 'Loading dashboard…');
    A.api('/admin/stats').then(function (stats) {
      var cards = MODULES.map(function (m) {
        return '<a class="stat-card" href="#/m/' + m.id + '">' +
          '<span class="ico">' + m.icon + '</span><b>' + Number(stats.counts[m.id] || 0) + '</b>' +
          '<span>' + esc(m.label) + '</span></a>';
      }).join('');

      var next = stats.nextEvent
        ? '<p><b>' + esc(stats.nextEvent.title) + '</b></p><p>' + fmtDate(stats.nextEvent.start_time) +
          (stats.nextEvent.location ? ' &middot; ' + esc(stats.nextEvent.location) : '') + '</p>' +
          '<p><a class="txt-link" href="' + A.BASE + '/events/' + encodeURIComponent(stats.nextEvent.slug) + '" target="_blank" rel="noopener">View on site &rarr;</a></p>'
        : '<p>No upcoming published event.</p>';

      var recent = (stats.recentPosts || []).map(function (p) {
        return '<div class="kv-row"><span>' + esc(p.title) + '</span>' + statusBadge(p.status) + '</div>';
      }).join('') || '<p>No posts yet.</p>';

      el.innerHTML =
        '<div class="page-head"><h1>Dashboard</h1>' +
          '<a class="btn ghost" href="' + A.BASE + '/" target="_blank" rel="noopener">View site &nearr;</a></div>' +
        '<div class="stat-grid">' + cards + '</div>' +
        '<div class="grid-2" style="margin-top:24px">' +
          '<div class="panel"><h2>Next upcoming event</h2>' + next + '</div>' +
          '<div class="panel"><h2>Recent posts</h2>' + recent +
            '<p style="margin-top:12px"><a class="txt-link" href="#/m/posts">Manage posts &rarr;</a></p></div>' +
        '</div>';
    }).catch(function (err) { stateError(el, err); });
  }

  // ------------------------------------------------------------ module list --
  function pageList(mod) {
    var el = view();
    el.innerHTML =
      '<div class="page-head"><h1>' + mod.icon + ' ' + esc(mod.label) + '</h1>' +
        '<div class="head-actions">' +
          '<input type="search" id="list-search" placeholder="Search…" aria-label="Search ' + esc(mod.label) + '">' +
          '<a class="btn" href="#/m/' + mod.id + '/new">+ New ' + esc(mod.singular) + '</a>' +
        '</div></div>' +
      '<div id="list-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

    var body = document.getElementById('list-body');
    var search = document.getElementById('list-search');
    var searchTimer = null;

    function load(q) {
      body.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading…</p></div>';
      A.api('/admin/' + mod.id + (q ? '?q=' + encodeURIComponent(q) : '')).then(function (rows) {
        if (!rows.length) {
          return stateEmpty(body, 'No ' + mod.label.toLowerCase() + ' yet.',
            '<p><a class="btn" href="#/m/' + mod.id + '/new">Create the first ' + esc(mod.singular) + '</a></p>');
        }
        var headCells = mod.columns.map(function (c) {
          return '<th>' + esc(c.label) + '</th>';
        }).join('') + '<th class="col-actions">Actions</th>';

        var rowsHtml = rows.map(function (row) {
          var cells = mod.columns.map(function (c) {
            var v = row[c.key];
            if (c.status) return '<td>' + statusBadge(v) + '</td>';
            if (c.bool) return '<td>' + (v ? '&#10003;' : '—') + '</td>';
            if (c.date) return '<td>' + fmtDate(v) + '</td>';
            if (c.badge) return '<td>' + (v ? '<span class="badge">' + esc(v) + '</span>' : '—') + '</td>';
            return '<td>' + esc(v == null || v === '' ? '—' : String(v).slice(0, 80)) + '</td>';
          }).join('');
          var isPublished = row.status === 'published';
          return '<tr data-id="' + row.id + '" data-title="' + esc(rowTitle(mod, row)) + '">' + cells +
            '<td class="col-actions">' +
              (mod.child
                ? '<a class="btn tiny" href="#/m/' + mod.id + '/' + row.id + '/' + mod.child.route + '">' + esc(mod.child.label) + '</a>'
                : '') +
              '<a class="btn tiny" href="#/m/' + mod.id + '/' + row.id + '">Edit</a>' +
              '<button class="btn tiny ghost" data-act="toggle" data-status="' + (isPublished ? 'draft' : 'published') + '">' +
                (isPublished ? 'Unpublish' : 'Publish') + '</button>' +
              '<button class="btn tiny danger" data-act="delete">Delete</button>' +
            '</td></tr>';
        }).join('');

        body.innerHTML = '<div class="table-wrap"><table class="list-table"><thead><tr>' + headCells + '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

        body.querySelectorAll('button[data-act]').forEach(function (btn) {
          var tr = btn.closest('tr');
          var id = Number(tr.getAttribute('data-id'));
          var label = tr.getAttribute('data-title');
          btn.addEventListener('click', function () {
            if (btn.getAttribute('data-act') === 'toggle') {
              toggleStatus(mod, id, btn.getAttribute('data-status'), label, function () { load(search.value.trim()); });
            } else {
              deleteRow(mod, id, label, function () { load(search.value.trim()); });
            }
          });
        });
      }).catch(function (err) { stateError(body, err); });
    }

    search.addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { load(search.value.trim()); }, 250);
    });

    load('');
  }

  function rowTitle(mod, row) {
    return row ? String(row[mod.titleField] || ('#' + row.id)) : 'this item';
  }

  function toggleStatus(mod, id, status, label, done) {
    A.api('/admin/' + mod.id + '/' + id + '/publish', { method: 'POST', body: { status: status } })
      .then(function () {
        toast(label + ' → ' + (status === 'published' ? 'published' : 'draft'));
        done();
      })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function deleteRow(mod, id, label, done) {
    confirmDialog('Delete ' + mod.singular + '?', 'This permanently removes "' + label + '".', 'Delete').then(function (ok) {
      if (!ok) return;
      A.api('/admin/' + mod.id + '/' + id, { method: 'DELETE' })
        .then(function () { toast(label + ' deleted.'); done(); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
  }

  // ----------------------------------------------------------- generic form --
  function fieldValue(f, v) {
    if (v == null) v = '';
    if (f.type === 'datetime-local') return v ? toLocalInput(v) : '';
    if (f.type === 'date') return v ? String(v).slice(0, 10) : '';
    if (f.type === 'checkbox') return !!v;
    if (f.type === 'json') {
      if (v === '') return '';
      if (f.jsonMode === 'lines') return Array.isArray(v) ? v.join('\n') : String(v);
      return JSON.stringify(v, null, 2);
    }
    return v;
  }

  function mediaPreviewHtml(name, accept) {
    var url = A.mediaUrl(name);
    if (!url) return '';
    if (accept === 'pdf' || /\.pdf$/i.test(name)) {
      return '<a href="' + esc(url) + '" target="_blank" rel="noopener" class="badge">' + esc(name) + ' (PDF) &nearr;</a>';
    }
    return '<img src="' + esc(url) + '" alt="' + esc(name) + '">';
  }

  function fieldInputHtml(f, value) {
    var v = fieldValue(f, value);
    var name = 'name="f-' + f.name + '"';
    var req = f.required ? ' required' : '';
    if (f.type === 'textarea') {
      return '<textarea ' + name + ' rows="' + (f.rows || 4) + '"' + req + '>' + esc(v) + '</textarea>';
    }
    if (f.type === 'select') {
      var opts = f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('');
      return '<select ' + name + req + '>' + opts + '</select>';
    }
    if (f.type === 'checkbox') {
      return '<label class="check-row"><input type="checkbox" ' + name + (v ? ' checked' : '') + '> ' + esc(f.label) + '</label>';
    }
    if (f.type === 'media') {
      return '<div class="media-field" data-field="' + f.name + '">' +
        '<div class="media-field-row">' +
          '<input type="text" ' + name + ' value="' + esc(v) + '" placeholder="no file chosen" readonly>' +
          '<button type="button" class="btn tiny" data-choose>Choose from media</button>' +
          '<button type="button" class="btn tiny ghost" data-clear>Clear</button>' +
        '</div>' +
        '<div class="media-preview">' + mediaPreviewHtml(v, f.accept) + '</div>' +
      '</div>';
    }
    if (f.type === 'media-multi') {
      // Same wire format as a json/lines field - filenames one per line - so
      // collectForm()'s existing 'lines' branch parses this with no change.
      // Replaces a hand-typed textarea: typing filenames by hand is how you get
      // a gallery of broken images.
      var items = (Array.isArray(v) ? v : String(v || '').split('\n'))
        .map(function (s) { return String(s).trim(); })
        .filter(Boolean);
      return '<div class="media-field media-multi" data-field="' + f.name + '" data-accept="' + esc(f.accept || 'image') + '">' +
        '<input type="hidden" ' + name + ' value="' + esc(items.join('\n')) + '">' +
        '<div class="media-field-row">' +
          '<button type="button" class="btn tiny" data-choose>Choose images</button>' +
          '<button type="button" class="btn tiny" data-clear>Clear all</button>' +
          '<span class="muted-note" data-count></span>' +
        '</div>' +
        '<div class="media-preview" data-list></div>' +
      '</div>';
    }
    if (f.type === 'json') {
      return '<textarea ' + name + ' rows="' + (f.jsonMode === 'object' ? 6 : 4) + '" data-json="' + esc(f.jsonMode || 'object') + '"' + req + '>' + esc(v) + '</textarea>';
    }
    if (f.type === 'markdown') {
      // Same widget the society year pages use: toolbar, live preview and an
      // image button that inserts a media-library file at the cursor. The
      // textarea keeps the standard f-<name> so collectForm() just works.
      return mdEditorHtml(name, v, f.rows || 14);
    }
    return '<input type="' + f.type + '" ' + name + ' value="' + esc(v) + '"' + req +
      (f.type === 'slug' ? ' placeholder="auto-generated"' : '') + '>';
  }

  function pageForm(mod, id) {
    var el = view();
    stateLoad(el, 'Loading form…');

    var load = id ? A.api('/admin/' + mod.id + '/' + id) : Promise.resolve({});

    load.then(function (row) {
      var fieldsHtml = mod.fields.map(function (f) {
        if (f.type === 'checkbox') {
          return '<div class="form-field">' + fieldInputHtml(f, row[f.name]) + '</div>';
        }
        return '<div class="form-field">' +
          '<label for="f-' + f.name + '">' + esc(f.label) + (f.required ? ' <span class="req">*</span>' : '') + '</label>' +
          fieldInputHtml(f, row[f.name]) +
          '<div class="field-error" data-error="' + f.name + '"></div>' +
        '</div>';
      }).join('');

      el.innerHTML =
        '<div class="page-head"><h1>' + (id ? 'Edit ' : 'New ') + esc(mod.singular) + '</h1>' +
          '<div class="head-actions">' +
            (row.status ? statusBadge(row.status) : '') +
            (id && mod.child
              ? '<a class="btn" href="#/m/' + mod.id + '/' + id + '/' + mod.child.route + '">' + esc(mod.child.label) + ' &rarr;</a>'
              : '') +
            '<a class="btn ghost" href="#/m/' + mod.id + '">&larr; Back to list</a>' +
          '</div></div>' +
        '<div class="panel">' +
          '<div class="form-error" id="form-error" hidden></div>' +
          '<form id="item-form" novalidate>' + fieldsHtml +
            '<div class="form-actions">' +
              '<button type="submit" class="btn" id="save-btn">' + (id ? 'Save changes' : 'Save (draft)') + '</button>' +
              '<a class="btn ghost" href="#/m/' + mod.id + '">Cancel</a>' +
            '</div>' +
          '</form>' +
        '</div>';

      bindMediaFields(mod.fields);
      // Wire any Markdown editors in this form (posts body, event description,
      // notice body, …) — toolbar, live preview and media-picker image insert.
      el.querySelectorAll('.md-editor').forEach(bindMdEditor);
      bindForm(mod, id);
    }).catch(function (err) { stateError(el, err); });
  }

  /** Wire ONE "Choose from media" picker wrapper (see mediaFieldHtml). */
  function bindOneMediaField(wrap, accept) {
    if (!wrap) return;
    var input = wrap.querySelector('input[type="text"]');
    var preview = wrap.querySelector('.media-preview');

    function refresh() {
      preview.innerHTML = mediaPreviewHtml(input.value, accept);
    }

    wrap.querySelector('[data-choose]').addEventListener('click', function () {
      openMediaPicker(accept, function (filename) {
        input.value = filename;
        refresh();
      });
    });
    wrap.querySelector('[data-clear]').addEventListener('click', function () {
      input.value = '';
      refresh();
    });
    refresh();
  }

  /** Wire a multi-image field: thumbnails, add-more, remove-one, reorder. */
  function bindMultiMediaField(wrap) {
    if (!wrap) return;
    var input = wrap.querySelector('input[type="hidden"]');
    var list = wrap.querySelector('[data-list]');
    var count = wrap.querySelector('[data-count]');
    var accept = wrap.getAttribute('data-accept') || 'image';

    function items() {
      return String(input.value || '').split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    function setItems(list_) { input.value = list_.join('\n'); paint(); }

    function paint() {
      var cur = items();
      count.textContent = cur.length
        ? cur.length + ' image' + (cur.length > 1 ? 's' : '') + ' selected'
        : '';
      if (!cur.length) {
        list.innerHTML = '<span class="muted-note">No images chosen yet.</span>';
        return;
      }
      list.innerHTML = '<div class="media-grid">' + cur.map(function (fn, i) {
        var url = A.mediaUrl(fn);
        return '<div class="media-item static" data-fn="' + esc(fn) + '">' +
          '<span class="media-thumb">' +
            (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="ph-text">?</span>') +
          '</span>' +
          '<span class="media-name" title="' + esc(fn) + '">' + esc(fn) + '</span>' +
          '<span class="media-actions">' +
            '<button type="button" class="btn tiny ghost" data-move="-1"' + (i === 0 ? ' disabled' : '') + ' title="Move earlier">&larr;</button>' +
            '<button type="button" class="btn tiny ghost" data-move="1"' + (i === cur.length - 1 ? ' disabled' : '') + ' title="Move later">&rarr;</button>' +
            '<button type="button" class="btn tiny danger" data-remove>Remove</button>' +
          '</span>' +
        '</div>';
      }).join('') + '</div>';

      list.querySelectorAll('[data-remove]').forEach(function (b) {
        b.addEventListener('click', function () {
          setItems(items().filter(function (fn) { return fn !== b.closest('.media-item').getAttribute('data-fn'); }));
        });
      });
      list.querySelectorAll('[data-move]').forEach(function (b) {
        b.addEventListener('click', function () {
          var dir = Number(b.getAttribute('data-move'));
          var cur2 = items();
          var i = cur2.indexOf(b.closest('.media-item').getAttribute('data-fn'));
          var j = i + dir;
          if (i === -1 || j < 0 || j >= cur2.length) return;
          var t = cur2[i]; cur2[i] = cur2[j]; cur2[j] = t;
          setItems(cur2);
        });
      });
    }

    wrap.querySelector('[data-choose]').addEventListener('click', function () {
      openMediaPicker(accept, function (picked) {
        // Add to what is already there; never replace, and never duplicate.
        var cur = items();
        picked.forEach(function (p) { if (cur.indexOf(p.filename) === -1) cur.push(p.filename); });
        setItems(cur);
      }, { multiple: true });
    });
    wrap.querySelector('[data-clear]').addEventListener('click', function () { setItems([]); });
    paint();
  }

  /** Wire the "Choose from media" pickers inside a form. */
  function bindMediaFields(fields) {
    view().querySelectorAll('.media-field').forEach(function (wrap) {
      var fieldName = wrap.getAttribute('data-field');
      if (wrap.classList.contains('media-multi')) {
        bindMultiMediaField(wrap);
        return;
      }
      var accept = '';
      for (var i = 0; i < fields.length; i++) {
        if (fields[i].name === fieldName && fields[i].type === 'media') {
          accept = fields[i].accept || '';
          break;
        }
      }
      bindOneMediaField(wrap, accept);
    });
  }

  /** Human label for a picked file: original name without its extension. */
  function mediaAlt(name) {
    return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
  }

  function fmtBytes(n) {
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var v = Number(n) || 0, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
  }

  function isImageMime(mime) { return String(mime || '').indexOf('image/') === 0; }

  /**
   * Media picker modal.
   *
   *   openMediaPicker(accept, onPick)                      -> single file
   *   openMediaPicker(accept, onPicks, { multiple: true }) -> many files
   *
   * Clicking a thumbnail NO LONGER inserts straight away - it shows a large
   * preview with the name, size and dimensions so you can check you picked the
   * right photograph before committing. That used to be the one real weakness:
   * you could only judge a 60px thumbnail and had no second chance.
   *
   * In multiple mode, clicks toggle a selection and "Add selected (n)"
   * commits the whole set at once.
   *
   * onPick  receives (filename, alt) in single mode.
   * onPicks receives (array of {filename, alt}) in multiple mode.
   */
  function openMediaPicker(accept, onPick, options) {
    options = options || {};
    var multiple = !!options.multiple;
    var root = document.getElementById('modal-root');
    var items = [];
    var chosen = [];      // indices into items, multiple mode only
    var cursor = 0;       // index shown in the preview pane

    root.innerHTML =
      '<div class="modal-overlay"><div class="modal wide" role="dialog" aria-modal="true" aria-label="Choose media">' +
        '<div class="modal-head"><h3>Choose from media</h3>' +
          '<button class="btn tiny ghost" id="picker-close">&times; Close</button></div>' +
        '<div id="picker-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>' +
        '<div class="modal-actions">' +
          (multiple
            ? '<button class="btn ghost" id="picker-cancel">Cancel</button>' +
              '<button class="btn" id="picker-commit" disabled>Add selected (0)</button>'
            : '<button class="btn ghost" id="picker-cancel">Cancel</button>' +
              '<button class="btn" id="picker-commit" disabled>Insert</button>') +
        '</div>' +
      '</div></div>';

    var commitBtn = document.getElementById('picker-commit');
    var cancelBtn = document.getElementById('picker-cancel');

    function close() { root.innerHTML = ''; }
    document.getElementById('picker-close').addEventListener('click', close);
    if (cancelBtn) cancelBtn.addEventListener('click', close);

    /** Paint the large preview for items[cursor]. */
    function paintPreview() {
      var pane = document.getElementById('picker-preview');
      var m = items[cursor];
      if (!pane || !m) return;
      var url = A.mediaUrl(m.filename);
      pane.innerHTML =
        '<div class="picker-preview-img">' +
          (isImageMime(m.mime)
            ? '<img src="' + esc(url) + '" alt="">'
            : '<span class="ph-text">' + esc(m.mime === 'application/pdf' ? 'PDF' : 'FILE') + '</span>') +
        '</div>' +
        '<div class="picker-preview-meta">' +
          '<div class="picker-preview-name">' + esc(m.original_name || m.filename) + '</div>' +
          '<div class="muted-note">' + fmtBytes(m.size) +
            (m.mime ? ' &middot; ' + esc(m.mime) : '') + '</div>' +
          (m.caption ? '<div class="muted-note">' + esc(m.caption) + '</div>' : '') +
        '</div>';
    }

    function refreshSelection() {
      if (!multiple) {
        commitBtn.disabled = items.length === 0;
        return;
      }
      commitBtn.disabled = chosen.length === 0;
      commitBtn.textContent = 'Add selected (' + chosen.length + ')';
      body.querySelectorAll('.media-item').forEach(function (btn) {
        btn.classList.toggle('selected', chosen.indexOf(Number(btn.getAttribute('data-idx'))) !== -1);
      });
    }

    var body;

    /** (Re)draw the grid + upload box from `items`. */
    function renderList() {
      var filtered = (accept === 'image')
        ? items.filter(function (m) { return isImageMime(m.mime); })
        : (accept === 'pdf' ? items.filter(function (m) { return m.mime === 'application/pdf'; })
                            : items.slice());

      if (!filtered.length) {
        body.innerHTML =
          '<div class="state empty"><p>No matching media yet — upload one below.</p></div>' +
          uploadFormHtml(true);
        paintPreview();
        refreshSelection();
        bindUpload();
        return;
      }

      body.innerHTML =
        '<div id="picker-preview" class="picker-preview"></div>' +
        (multiple ? '<p class="muted-note">Click images to select them, then add them together.</p>' : '') +
        '<div class="media-grid">' + filtered.map(function (m) {
          var idx = items.indexOf(m);
          return '<button type="button" class="media-item" data-idx="' + idx + '" data-name="' +
            esc(m.filename) + '" data-alt="' + esc(mediaAlt(m.original_name || m.filename)) + '">' +
            '<span class="media-thumb">' +
              (isImageMime(m.mime)
                ? '<img src="' + esc(A.mediaUrl(m.filename)) + '" alt="" loading="lazy">'
                : '<span class="ph-text">' + (m.mime === 'application/pdf' ? 'PDF' : 'FILE') + '</span>') +
            '</span>' +
            '<span class="media-name">' + esc(m.original_name || m.filename) + '</span>' +
          '</button>';
        }).join('') + '</div>' + uploadFormHtml(true);

      paintPreview();

      body.querySelectorAll('.media-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          cursor = Number(btn.getAttribute('data-idx'));
          paintPreview();
          if (multiple) {
            var at = chosen.indexOf(cursor);
            if (at === -1) chosen.push(cursor); else chosen.splice(at, 1);
            refreshSelection();
          } else {
            refreshSelection();
            commitBtn.disabled = false;
          }
        });
      });

      refreshSelection();
      bindUpload();
    }

    /**
     * Uploading from inside the picker is the main way images get in, so it
     * stays here. Single mode: the new file is previewed and left ready to
     * Insert (not committed blindly). Multiple mode: it is added to the current
     * selection so several can be uploaded and added in one go.
     */
    function bindUpload() {
      bindUploadForm(body, function (filename, row) {
        A.api('/admin/media').then(function (list) {
          items = list;
          var fresh = items.filter(function (m) { return m.filename === filename; })[0];
          if (fresh) {
            cursor = items.indexOf(fresh);
            if (multiple && chosen.indexOf(cursor) === -1) chosen.push(cursor);
          }
          renderList();
          toast('Uploaded ' + ((row && row.original_name) || filename) + ' — add it when you are ready.');
        });
      });
    }

    A.api('/admin/media').then(function (list) {
      items = list;
      body = document.getElementById('picker-body');
      renderList();
    }).catch(function (err) {
      document.getElementById('picker-body').innerHTML =
        '<div class="state error"><p>' + esc(err.message) + '</p></div>';
    });

    if (commitBtn) {
      commitBtn.addEventListener('click', function () {
        if (multiple) {
          var out = chosen.map(function (i) {
            var m = items[i];
            return { filename: m.filename, alt: mediaAlt(m.original_name || m.filename) };
          });
          if (!out.length) return;
          close();
          onPick(out, out.length);
        } else {
          var m = items[cursor];
          if (!m) return;
          close();
          onPick(m.filename, mediaAlt(m.original_name || m.filename));
        }
      });
    }
  }

  // --------------------------------------------- societies: year pages ----
  // #/m/societies/<sid>/years[/{new|<yid>}] — one Markdown page per society
  // per year, each carrying that year's officers + committee members.

  /** First letters of up to two words (avatar placeholder). */
  function initialsOf(text) {
    return String(text || '?').trim().split(/\s+/).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join('') || '?';
  }

  /** A "Choose from media" field (same markup the generic form renders). */
  function mediaFieldHtml(fieldName, value, accept) {
    return '<div class="media-field" data-field="' + fieldName + '">' +
      '<div class="media-field-row">' +
        '<input type="text" name="f-' + fieldName + '" value="' + esc(value || '') + '" placeholder="no file chosen" readonly>' +
        '<button type="button" class="btn tiny" data-choose>Choose from media</button>' +
        '<button type="button" class="btn tiny ghost" data-clear>Clear</button>' +
      '</div>' +
      '<div class="media-preview">' + mediaPreviewHtml(value || '', accept) + '</div>' +
    '</div>';
  }

  /** Markdown → HTML (vendored marked) with media-library filenames → URLs. */
  function mdRender(text) {
    var src = String(text == null ? '' : text);
    if (!src.trim()) return '';
    if (!window.marked) {
      // Library missing — degrade to escaped text (never fails the page).
      return '<p>' + esc(src).replace(/\n/g, '<br>') + '</p>';
    }
    // ![alt](filename) resolves to the uploads URL at render time, so stored
    // Markdown keeps referencing the bare media-library filename. Absolute
    // and external URLs pass through untouched.
    src = src.replace(/(!\[[^\]]*\]\()([^)\s]+)([^)]*\))/g, function (m, pre, imgSrc, post) {
      if (/^(https?:|\/|data:)/i.test(imgSrc)) return m;
      return pre + (A.mediaUrl(imgSrc) || imgSrc) + post;
    });
    return window.marked.parse(src, { breaks: true, gfm: true });
  }

  /** The Markdown editor widget: toolbar + textarea + collapsible preview.
   *  `nameAttr` is a full attribute string, e.g. 'name="f-body"'. */
function mdEditorHtml(nameAttr, value, rows, placeholder) {
    return '<div class="md-editor">' +
    '<div class="md-toolbar">' +
      '<button type="button" class="btn tiny" data-md-cmd="bold" title="Bold"><b>B</b></button>' +
      '<button type="button" class="btn tiny" data-md-cmd="italic" title="Italic"><i>I</i></button>' +
      '<button type="button" class="btn tiny" data-md-cmd="h2" title="Heading (##)">Heading</button>' +
      '<button type="button" class="btn tiny" data-md-cmd="list" title="Bullet list">&bull; List</button>' +
      '<button type="button" class="btn tiny" data-md-cmd="link" title="Link">Link</button>' +
      '<button type="button" class="btn tiny" data-md-cmd="image" title="Insert image at the cursor position, from the media library or a new upload">&#128247; Image</button>' +
      '<button type="button" class="btn tiny ghost md-toggle" title="Live preview">Preview</button>' +
    '</div>' +
    '<div class="md-panes">' +
      '<textarea class="md-input" ' + nameAttr + ' rows="' + (rows || 14) + '" placeholder="' +
      esc(placeholder || 'Write in Markdown.') + '">' + esc(value == null ? '' : value) + '</textarea>' +
      '<div class="md-preview" hidden></div>' +
    '</div>' +
    '<div class="md-imagestrip"></div>' +
    '</div>';
  }

  /** Insert text at the textarea cursor (replacing any selection). */
  function insertAtCursor(ta, text) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start + text.length, start + text.length);
  }

  /** Apply a toolbar command to the textarea, selection-aware. */
  function applyMdCmd(ta, cmd) {
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    var sel = value.slice(start, end);
    var before = value.slice(0, start);
    var after = value.slice(end);
    var out = null;
    var selStart = start;
    var selEnd = start;

    if (cmd === 'bold' || cmd === 'italic') {
      var wrap = cmd === 'bold' ? '**' : '*';
      out = before + wrap + (sel || 'text') + wrap + after;
      selStart = start + wrap.length;
      selEnd = selStart + (sel || 'text').length;
    } else if (cmd === 'h2') {
      // Toggle a "## " prefix on the line the caret is on.
      var lineStart = before.lastIndexOf('\n') + 1;
      if (value.slice(lineStart, lineStart + 3) === '## ') {
        out = value.slice(0, lineStart) + value.slice(lineStart + 3);
        selStart = selEnd = Math.max(lineStart, start - 3);
      } else {
        out = value.slice(0, lineStart) + '## ' + value.slice(lineStart);
        selStart = selEnd = start + 3;
      }
    } else if (cmd === 'list') {
      // Prefix every non-empty line in the touched block with "- ".
      var blockStart = before.lastIndexOf('\n') + 1;
      var nl = value.indexOf('\n', end);
      var blockEnd = nl === -1 ? value.length : nl;
      var newBlock = value.slice(blockStart, blockEnd).split('\n').map(function (line) {
        if (!line.trim() || /^- /.test(line)) return line;
        return '- ' + line;
      }).join('\n');
      out = value.slice(0, blockStart) + newBlock + value.slice(blockEnd);
      selStart = blockStart;
      selEnd = blockStart + newBlock.length;
    } else if (cmd === 'link') {
      var text = sel || 'link text';
      out = before + '[' + text + '](https://)' + after;
      selStart = start + text.length + 3; // start of the URL
      selEnd = selStart + 8;
    }

    if (out === null) return;
    ta.value = out;
    ta.focus();
    ta.setSelectionRange(selStart, selEnd);
  }

  /** Wire the editor widget: toolbar commands, image insert, live preview. */
  function bindMdEditor(editor) {
    var ta = editor.querySelector('.md-input');
    var preview = editor.querySelector('.md-preview');
    var toggleBtn = editor.querySelector('.md-toggle');
    var previewTimer = null;
    var strip = editor.querySelector('.md-imagestrip');

    /**
     * Every ![...](filename) image referenced in the body, in document order.
     * Same shape the public renderer matches, so this and the live site always
     * agree on what counts as an image reference.
     */
    function imagesInBody() {
      var out = [];
      var re = /!\[[^\]]*\]\(([^)\s]+)\)/g;
      var m;
      while ((m = re.exec(ta.value)) !== null) {
        var src = m[1];
        if (/^(https?:|\/|data:)/i.test(src)) continue;
        out.push({ src: src, index: m.index, full: m[0] });
      }
      return out;
    }

    /** Reject that filename wherever it appears in the body. */
    function removeImageReference(filename) {
      var lines = ta.value.split('\n');
      var kept = lines.filter(function (line) {
        return line.indexOf('](' + filename + ')') === -1;
      });
      var removed = lines.length - kept.length;
      ta.value = kept.join('\n');
      refresh();
      paintStrip();
      toast(removed
        ? 'Removed ' + removed + ' reference' + (removed > 1 ? 's' : '') + ' to ' + filename + '.'
        : 'No reference to ' + filename + ' was in the text (the file is still in the media library).');
    }

    /** Put the caret on the line holding this image, so it is easy to edit around it. */
    function selectImageInEditor(src) {
      var at = ta.value.indexOf(src);
      if (at === -1) return;
      var lineStart = ta.value.lastIndexOf('\n', at) + 1;
      ta.focus();
      ta.setSelectionRange(lineStart, at + src.length);
      ta.scrollTop = Math.max(0, ta.scrollTop - 40);
    }

    /**
     * The visual list of images this post uses.
     *
     * Without it the only record of what is in a post is the Markdown source:
     * adding one means clicking through the toolbar and inserting at a guessed
     * cursor position, and removing one means hand-editing text. This shows them
     * as thumbnails and does both.
     */
    function paintStrip() {
      if (!strip) return;
      var refs = imagesInBody();
      if (!refs.length) {
        strip.innerHTML = '<p class="muted-note">No images yet — put your cursor where you want one, then use 🖼 Image.</p>';
        return;
      }
      strip.innerHTML =
        '<div class="md-imagestrip-head"><b>' + refs.length +
        ' image' + (refs.length > 1 ? 's' : '') + ' in this text</b>' +
        '<button type="button" class="btn tiny" id="imgstrip-add">+ Add image</button></div>' +
        '<div class="media-grid">' + refs.map(function (r) {
          var url = A.mediaUrl(r.src);
          return '<div class="media-item static" data-src="' + esc(r.src) + '" title="' + esc(r.src) + '">' +
            '<span class="media-thumb">' +
              (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="ph-text">?</span>') +
            '</span>' +
            '<span class="media-name">' + esc(r.src) + '</span>' +
            '<span class="media-actions">' +
              '<button type="button" class="btn tiny ghost" data-find>Find</button>' +
              '<button type="button" class="btn tiny danger" data-del>Remove</button>' +
            '</span>' +
          '</div>';
        }).join('') + '</div>';

      strip.querySelector('#imgstrip-add').addEventListener('click', function () {
        openMediaPicker('image', function (filename, alt) {
          insertAtCursor(ta, '\n\n![' + (alt || mediaAlt(filename)) + '](' + filename + ')\n\n');
          refresh();
          paintStrip();
        });
      });
      strip.querySelectorAll('[data-find]').forEach(function (b) {
        b.addEventListener('click', function () {
          selectImageInEditor(b.closest('.media-item').getAttribute('data-src'));
        });
      });
      strip.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () {
          removeImageReference(b.closest('.media-item').getAttribute('data-src'));
        });
      });
    }

    function renderPreview() {
      preview.innerHTML = mdRender(ta.value);
    }

    function refresh() {
      if (preview.hidden) return;
      clearTimeout(previewTimer);
      previewTimer = setTimeout(renderPreview, 150);
    }

    toggleBtn.addEventListener('click', function () {
      preview.hidden = !preview.hidden;
      if (!preview.hidden) renderPreview();
    });

    ta.addEventListener('input', function () { refresh(); paintStrip(); });

    editor.querySelectorAll('[data-md-cmd]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-md-cmd') === 'image') {
          openMediaPicker('image', function (filename, alt) {
            insertAtCursor(ta, '\n\n![' + (alt || mediaAlt(filename)) + '](' + filename + ')\n\n');
            refresh();
            paintStrip();
          });
          return;
        }
        applyMdCmd(ta, btn.getAttribute('data-md-cmd'));
        refresh();
        paintStrip();
      });
    });

    paintStrip();
  }

  /** #/m/societies/<sid>/years — one society's year pages. */
  function pageSocietyYears(mod, societyId) {
    var el = view();
    stateLoad(el, 'Loading year pages…');

    A.api('/admin/societies/' + societyId).then(function (society) {
      var base = '#/m/societies/' + societyId + '/years';
      var apiBase = '/admin/societies/' + societyId + '/years';

      el.innerHTML =
        '<div class="page-head"><h1>' + mod.icon + ' ' + esc(society.name) + ' — year pages</h1>' +
          '<div class="head-actions">' +
            '<a class="btn ghost" href="#/m/societies">&larr; All societies</a>' +
            '<a class="btn ghost" href="#/m/societies/' + societyId + '">Edit society</a>' +
            '<a class="btn" href="' + base + '/new">+ Add year page</a>' +
          '</div></div>' +
        '<p class="muted-note">Each year (e.g. 2025-26) gets its own page: a Markdown story plus that year&#39;s officers and committee.</p>' +
        '<div id="years-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

      var body = document.getElementById('years-body');

      function load() {
        body.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading…</p></div>';
        A.api(apiBase).then(function (rows) {
          if (!rows.length) {
            return stateEmpty(body, 'No year pages yet for this society.',
              '<p><a class="btn" href="' + base + '/new">Create the first year page</a></p>');
          }
          body.innerHTML = '<div class="table-wrap"><table class="list-table"><thead><tr>' +
            '<th>Year</th><th>Title</th><th>Status</th><th class="col-actions">Actions</th></tr></thead><tbody>' +
            rows.map(function (y) {
              var isPublished = y.status === 'published';
              return '<tr data-id="' + y.id + '" data-year="' + esc(y.year) + '">' +
                '<td><b>' + esc(y.year) + '</b></td>' +
                '<td>' + esc(y.title || '—') + '</td>' +
                '<td>' + statusBadge(y.status) + '</td>' +
                '<td class="col-actions">' +
                  '<a class="btn tiny" href="' + base + '/' + y.id + '">Open</a>' +
                  '<button class="btn tiny ghost" data-act="toggle" data-status="' + (isPublished ? 'draft' : 'published') + '">' +
                    (isPublished ? 'Unpublish' : 'Publish') + '</button>' +
                  '<button class="btn tiny danger" data-act="delete">Delete</button>' +
                '</td></tr>';
            }).join('') + '</tbody></table></div>';

          body.querySelectorAll('button[data-act]').forEach(function (btn) {
            var tr = btn.closest('tr');
            var id = Number(tr.getAttribute('data-id'));
            var label = tr.getAttribute('data-year');
            btn.addEventListener('click', function () {
              var action = btn.getAttribute('data-act');
              if (action === 'toggle') {
                var status = btn.getAttribute('data-status');
                A.api(apiBase + '/' + id + '/publish', { method: 'POST', body: { status: status } })
                  .then(function () {
                    toast('Year page ' + label + ' → ' + (status === 'published' ? 'published' : 'draft'));
                    load();
                  })
                  .catch(function (err) { toast(err.message, 'error'); });
              } else {
                confirmDialog('Delete year page?',
                  'This permanently removes the ' + label + ' page and everyone listed on it for that year.', 'Delete')
                  .then(function (ok) {
                    if (!ok) return;
                    A.api(apiBase + '/' + id, { method: 'DELETE' })
                      .then(function () { toast('Year page ' + label + ' deleted.'); load(); })
                      .catch(function (err) { toast(err.message, 'error'); });
                  });
              }
            });
          });
        }).catch(function (err) { stateError(body, err); });
      }

      load();
    }).catch(function (err) { stateError(el, err); });
  }

  /** #/m/societies/<sid>/years/{new|<yid>} — year page editor (MD + people). */
  function pageYearEditor(mod, societyId, yearId) {
    var el = view();
    stateLoad(el, 'Loading year page…');

    var socReq = A.api('/admin/societies/' + societyId);
    var yearReq = yearId
      ? A.api('/admin/societies/' + societyId + '/years/' + yearId)
      : Promise.resolve(null);

    Promise.all([socReq, yearReq]).then(function (res) {
      var society = res[0];
      var year = res[1];
      var base = '#/m/societies/' + societyId + '/years';
      var apiBase = '/admin/societies/' + societyId + '/years';

      el.innerHTML =
        '<div class="page-head"><h1>' + (yearId ? 'Edit' : 'New') + ' year page — ' + esc(society.name) + '</h1>' +
          '<div class="head-actions">' +
            (year ? statusBadge(year.status) : '') +
            '<a class="btn ghost" href="' + base + '">&larr; Year pages</a>' +
          '</div></div>' +
        '<div class="panel">' +
          '<div class="form-error" id="year-error" hidden></div>' +
          '<form id="year-form" novalidate>' +
            '<div class="form-field"><label for="y-year">Year <span class="req">*</span></label>' +
              '<input type="text" id="y-year" name="y-year" value="' + esc(year ? year.year : '') + '" placeholder="e.g. 2025-26" required>' +
              '<div class="field-error" data-error="y-year"></div></div>' +
            '<div class="form-field"><label for="y-title">Page title (optional)</label>' +
              '<input type="text" id="y-title" name="y-title" value="' + esc(year ? year.title || '' : '') + '" placeholder="e.g. A year of debates and workshops"></div>' +
            '<div class="form-field"><label>Page content (Markdown)</label>' +
              mdEditorHtml('name="y-body"', year ? year.body : '', 14, 'Write this year&#39;s page in Markdown…') + '</div>' +
            '<div class="form-field"><label>Cover image (optional)</label>' +
              mediaFieldHtml('cover', year ? year.cover || '' : '', 'image') + '</div>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn" id="year-save">' + (yearId ? 'Save year page' : 'Create year page') + '</button>' +
              '<a class="btn ghost" href="' + base + '">Cancel</a>' +
            '</div>' +
          '</form>' +
        '</div>' +
        (year
          ? '<div class="panel" style="margin-top:24px">' +
              '<h2>People of ' + esc(year.year) + '</h2>' +
              '<div id="members-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>' +
              '<div id="member-form-root"></div>' +
            '</div>'
          : '<div class="panel" style="margin-top:24px"><h2>People of this year</h2>' +
              '<p class="muted-note">Create the year page first — then add its officers and committee members here.</p></div>');

      bindMdEditor(el.querySelector('.md-editor'));
      bindOneMediaField(el.querySelector('.media-field[data-field="cover"]'), 'image');
      bindYearForm(el, apiBase, base, yearId);
      if (year) bindMembersSection(el, apiBase, yearId, year.year);
    }).catch(function (err) { stateError(el, err); });
  }

  /** Save handler for the year page form (create + edit). */
  function bindYearForm(el, apiBase, base, yearId) {
    document.getElementById('year-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var errBox = document.getElementById('year-error');
      errBox.hidden = true;
      el.querySelectorAll('.field-error').forEach(function (n) { n.textContent = ''; });

      var body = {
        year: document.getElementById('y-year').value.trim(),
        title: document.getElementById('y-title').value.trim() || null,
        body: el.querySelector('.md-input').value || null,
        cover: el.querySelector('[name="f-cover"]').value.trim() || null
      };

      if (!body.year) {
        var fe = el.querySelector('[data-error="y-year"]');
        if (fe) fe.textContent = 'This field is required.';
        errBox.textContent = 'Please add a year label (e.g. 2025-26).';
        errBox.hidden = false;
        window.scrollTo(0, 0);
        return;
      }

      var btn = document.getElementById('year-save');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      var req = yearId
        ? A.api(apiBase + '/' + yearId, { method: 'PUT', body: body })
        : A.api(apiBase, { method: 'POST', body: body });

      req.then(function (saved) {
        if (!yearId && saved && saved.id) {
          // Land in the full editor so this year's people can be added.
          toast('Year page created — now add its people.');
          location.hash = base + '/' + saved.id;
          return;
        }
        toast('Year page saved.');
        btn.disabled = false;
        btn.textContent = 'Save year page';
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = yearId ? 'Save year page' : 'Create year page';
        errBox.textContent = err.message;
        errBox.hidden = false;
        window.scrollTo(0, 0);
      });
    });
  }

  /** Members table + inline add/edit form for one year page. */
  function bindMembersSection(el, apiBase, yearId, yearLabel) {
    var body = el.querySelector('#members-body');
    var formRoot = el.querySelector('#member-form-root');
    var memberApi = apiBase + '/' + yearId + '/members';

    function memberThumbHtml(m) {
      var url = A.mediaUrl(m.photo);
      if (url) return '<span class="member-avatar"><img src="' + esc(url) + '" alt="' + esc(m.name) + '"></span>';
      return '<span class="member-avatar ph">' + esc(initialsOf(m.name)) + '</span>';
    }

    function load() {
      body.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading…</p></div>';
      A.api(apiBase + '/' + yearId).then(function (year) {
        var members = (year && year.members) || [];
        if (!members.length) {
          stateEmpty(body, 'No people added for ' + yearLabel + ' yet.',
            '<p><button type="button" class="btn" id="member-add-empty">+ Add the first person</button></p>');
          document.getElementById('member-add-empty').addEventListener('click', function () { openMemberForm(null); });
          return;
        }
        body.innerHTML = '<div class="table-wrap"><table class="list-table"><thead><tr>' +
          '<th>Photo</th><th>Name</th><th>Role</th><th>Category</th><th>Email</th><th>Sort</th><th class="col-actions">Actions</th>' +
          '</tr></thead><tbody>' +
          members.map(function (m) {
            return '<tr data-id="' + m.id + '">' +
              '<td>' + memberThumbHtml(m) + '</td>' +
              '<td><b>' + esc(m.name) + '</b></td>' +
              '<td>' + esc(m.role || '—') + '</td>' +
              '<td><span class="badge ' + (m.category === 'officer' ? 'officer' : 'committee') + '">' + esc(m.category) + '</span></td>' +
              '<td>' + esc(m.email || '—') + '</td>' +
              '<td>' + esc(m.sort_order) + '</td>' +
              '<td class="col-actions">' +
                '<button class="btn tiny" data-edit>Edit</button>' +
                '<button class="btn tiny danger" data-del>Delete</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table></div>' +
          '<div class="form-actions" style="margin-top:14px">' +
            '<button type="button" class="btn" id="member-add">+ Add person</button>' +
          '</div>';

        body.querySelectorAll('tr[data-id]').forEach(function (tr) {
          var id = Number(tr.getAttribute('data-id'));
          var row = members.filter(function (m) { return m.id === id; })[0];
          tr.querySelector('[data-edit]').addEventListener('click', function () { openMemberForm(row); });
          tr.querySelector('[data-del]').addEventListener('click', function () {
            confirmDialog('Delete person?', 'This removes "' + row.name + '" from the ' + yearLabel + ' page.', 'Delete')
              .then(function (ok) {
                if (!ok) return;
                A.api(memberApi + '/' + id, { method: 'DELETE' })
                  .then(function () { toast('Person removed.'); load(); })
                  .catch(function (err) { toast(err.message, 'error'); });
              });
          });
        });
        document.getElementById('member-add').addEventListener('click', function () { openMemberForm(null); });
      }).catch(function (err) { stateError(body, err); });
    }

    // The year id is the last numeric segment of the editor's hash route.
    function openMemberForm(member) {
      var isEdit = !!member;
      formRoot.innerHTML =
        '<div class="member-form" style="margin-top:16px;border-top:1px solid var(--line);padding-top:16px">' +
          '<h3>' + (isEdit ? 'Edit person' : 'Add a person') + '</h3>' +
          '<div class="form-error" id="member-error" hidden></div>' +
          '<form id="member-form" novalidate>' +
            '<div class="grid-2">' +
              '<div class="form-field"><label for="m-name">Name <span class="req">*</span></label>' +
                '<input type="text" id="m-name" value="' + esc(member ? member.name : '') + '" placeholder="e.g. Ayesha Khan" required></div>' +
              '<div class="form-field"><label for="m-role">Role / position</label>' +
                '<input type="text" id="m-role" value="' + esc(member ? member.role || '' : '') + '" placeholder="e.g. President"></div>' +
              '<div class="form-field"><label for="m-email">Email</label>' +
                '<input type="email" id="m-email" value="' + esc(member ? member.email || '' : '') + '"></div>' +
              '<div class="form-field"><label for="m-category">Category</label>' +
                '<select id="m-category">' +
                  '<option value="officer"' + (member && member.category === 'officer' ? ' selected' : '') + '>Officer</option>' +
                  '<option value="committee"' + (member && member.category === 'committee' ? ' selected' : '') + '>Committee member</option>' +
                '</select></div>' +
              '<div class="form-field"><label for="m-sort">Sort order (lower shows first)</label>' +
                '<input type="number" id="m-sort" value="' + esc(member ? member.sort_order : 0) + '"></div>' +
            '</div>' +
            '<div class="form-field"><label for="m-bio">Intro (shown under the role on the society page)</label>' +
              '<textarea id="m-bio" rows="3" placeholder="e.g. Final year BS Computer Science — led the society to the national debate semifinals.">' +
                esc(member ? member.bio || '' : '') + '</textarea></div>' +
            '<div class="form-field"><label>Photo (optional)</label>' +
              mediaFieldHtml('member-photo', member ? member.photo || '' : '', 'image') + '</div>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn">' + (isEdit ? 'Save person' : 'Add person') + '</button>' +
              '<button type="button" class="btn ghost" id="member-cancel">Cancel</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      bindOneMediaField(formRoot.querySelector('.media-field[data-field="member-photo"]'), 'image');

      document.getElementById('member-cancel').addEventListener('click', function () { formRoot.innerHTML = ''; });
      document.getElementById('member-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var errBox = document.getElementById('member-error');
        errBox.hidden = true;

        var payload = {
          name: document.getElementById('m-name').value.trim(),
          role: document.getElementById('m-role').value.trim() || null,
          email: document.getElementById('m-email').value.trim() || null,
          bio: document.getElementById('m-bio').value.trim() || null,
          category: document.getElementById('m-category').value,
          sort_order: Number(document.getElementById('m-sort').value) || 0,
          photo: formRoot.querySelector('[name="f-member-photo"]').value.trim() || null
        };
        if (!payload.name) {
          errBox.textContent = 'A name is required.';
          errBox.hidden = false;
          return;
        }

        var req = isEdit
          ? A.api(memberApi + '/' + member.id, { method: 'PUT', body: payload })
          : A.api(memberApi, { method: 'POST', body: payload });

        req.then(function () {
          toast('Person saved.');
          formRoot.innerHTML = '';
          load();
        }).catch(function (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        });
      });
    }

    load();
  }

  /** Collect the form into a plain body object with inline validation. */
  function collectForm(mod) {
    var el = view();
    var body = {};
    var firstError = null;

    el.querySelectorAll('.field-error').forEach(function (n) { n.textContent = ''; });
    var errBox = document.getElementById('form-error');
    errBox.hidden = true;

    for (var i = 0; i < mod.fields.length; i++) {
      var f = mod.fields[i];
      var node = el.querySelector('[name="f-' + f.name + '"]');
      if (!node) continue;
      var raw = node.value;

if (f.required && node.type !== 'checkbox' && !String(raw).trim()) {
      var fe = el.querySelector('[data-error="' + f.name + '"]');
      if (fe) fe.textContent = 'This field is required.';
      firstError = firstError || f;
      continue;
    }

    if (f.type === 'checkbox') {
      body[f.name] = node.checked ? 1 : 0;
    } else if (f.type === 'json' || f.type === 'media-multi') {
      // media-multi shares the 'lines' wire format (a hidden input holding
      // filenames, one per line). Without including its type here it would fall
      // through to the generic branch below and be stored as a newline string
      // instead of an array - and the public gallery, which calls .map() on it,
      // would break.
      var text = String(raw).trim();
      if (!text) { body[f.name] = f.jsonMode === 'lines' ? [] : null; continue; }
        if (f.jsonMode === 'lines') {
          body[f.name] = text.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
        } else {
          try {
            body[f.name] = JSON.parse(text);
          } catch (e) {
            var je = el.querySelector('[data-error="' + f.name + '"]');
            if (je) je.textContent = 'Invalid JSON: ' + e.message;
            firstError = firstError || f;
          }
        }
      } else if (f.type === 'number') {
        body[f.name] = raw === '' ? null : Number(raw);
      } else if (f.type === 'datetime-local' || f.type === 'date') {
        body[f.name] = raw ? new Date(raw).toISOString() : null;
      } else {
        body[f.name] = String(raw).trim() || null;
      }
    }

    if (firstError) {
      errBox.textContent = 'Please fix the highlighted field: ' + firstError.label;
      errBox.hidden = false;
      window.scrollTo(0, 0);
      return null;
    }
    return body;
  }

  function bindForm(mod, id) {
    document.getElementById('item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var body = collectForm(mod);
      if (!body) return;

      var btn = document.getElementById('save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';

      var req = id
        ? A.api('/admin/' + mod.id + '/' + id, { method: 'PUT', body: body })
        : A.api('/admin/' + mod.id, { method: 'POST', body: body });

      req.then(function (saved) {
        if (!id && mod.child && saved && saved.id) {
          // New parent item (e.g. a society) → land on its child manager
          // (year pages) so staff can continue filling in the drill-down.
          toast(upperFirst(mod.singular) + ' saved — now add its ' + mod.child.label.toLowerCase() + '.');
          location.hash = '#/m/' + mod.id + '/' + saved.id + '/' + mod.child.route;
          return;
        }
        toast(mod.singular + ' saved.');
        location.hash = '#/m/' + mod.id;
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = id ? 'Save changes' : 'Save (draft)';
        var errBox = document.getElementById('form-error');
        errBox.textContent = err.message;
        errBox.hidden = false;
        window.scrollTo(0, 0);
      });
    });
  }

  // ------------------------------------------------------------------ media --
  function uploadFormHtml(compact) {
    return '<div class="upload-box' + (compact ? ' compact' : '') + '">' +
      '<input type="file" id="upload-input" accept="image/jpeg,image/png,image/gif,image/webp,application/pdf">' +
      '<button type="button" class="btn" id="upload-btn">Upload file</button>' +
      '<span class="upload-hint">Images (jpg, png, gif, webp) or PDF. SVG is not accepted &mdash; use PNG or WebP.</span>' +
      '<div class="field-error" id="upload-error"></div>' +
    '</div>';
  }

  /** Shared uploader — afterUpload(filename, row) fires on success. */
  function bindUploadForm(scope, afterUpload) {
    var input = scope.querySelector('#upload-input');
    var btn = scope.querySelector('#upload-btn');
    if (!input || !btn) return;
    btn.addEventListener('click', function () {
      var errEl = scope.querySelector('#upload-error');
      errEl.textContent = '';
      if (!input.files || !input.files[0]) {
        errEl.textContent = 'Choose a file first.';
        return;
      }
      var fd = new FormData();
      fd.append('file', input.files[0]);
      btn.disabled = true;
      btn.textContent = 'Uploading…';
      A.upload('/admin/media', fd).then(function (row) {
        toast('Uploaded ' + (row.original_name || row.filename) + '.');
        if (afterUpload) afterUpload(row.filename, row);
      }).catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Upload file';
        errEl.textContent = err.message;
      });
    });
  }

  function pageMedia() {
    var el = view();
    el.innerHTML =
      '<div class="page-head"><h1>&#128444; Media library</h1></div>' +
      uploadFormHtml(false) +
      '<div id="media-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

    function load() {
      var body = document.getElementById('media-body');
      body.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading…</p></div>';
      A.api('/admin/media').then(function (items) {
        if (!items.length) {
          return stateEmpty(body, 'No media uploaded yet — add your first file above.');
        }
        body.innerHTML = '<div class="media-grid">' + items.map(function (m) {
          var isImg = String(m.mime || '').indexOf('image/') === 0;
          return '<div class="media-item static" data-id="' + m.id + '" data-name="' + esc(m.filename) + '">' +
            '<span class="media-thumb">' +
              (isImg ? '<img src="' + esc(A.mediaUrl(m.filename)) + '" alt="">' : '<span class="ph-text">PDF</span>') +
            '</span>' +
            '<span class="media-name">' + esc(m.original_name || m.filename) + '</span>' +
            '<span class="media-actions">' +
              '<a class="btn tiny ghost" href="' + esc(A.mediaUrl(m.filename)) + '" target="_blank" rel="noopener">Open</a>' +
              '<button type="button" class="btn tiny danger" data-del>Delete</button>' +
            '</span>' +
          '</div>';
        }).join('') + '</div>';

        body.querySelectorAll('[data-del]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var item = btn.closest('.media-item');
            var id = Number(item.getAttribute('data-id'));
            var name = item.getAttribute('data-name');
            confirmDialog('Delete media?', '"' + name + '" is removed from the library. Items using it will lose the file.', 'Delete').then(function (ok) {
              if (!ok) return;
              A.api('/admin/media/' + id, { method: 'DELETE' })
                .then(function () { toast('Media deleted.'); load(); })
                .catch(function (err) { toast(err.message, 'error'); });
            });
          });
        });
      }).catch(function (err) { stateError(body, err); });
    }

    bindUploadForm(el, function () { load(); });
    load();
  }

  // ------------------------------------------------------------- site copy --
  function pagePages() {
    var el = view();
    el.innerHTML = '<div class="page-head"><h1>&#128221; Site copy</h1></div>' +
      '<div id="pages-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

    A.api('/admin/pages').then(function (rows) {
      var body = document.getElementById('pages-body');
      if (!rows.length) {
        return stateEmpty(body, 'No editable pages defined.');
      }
      body.innerHTML = '<div class="table-wrap"><table class="list-table"><thead><tr>' +
        '<th>Page key</th><th>Title</th><th class="col-actions">Actions</th></tr></thead><tbody>' +
        rows.map(function (r) {
          // GET /api/admin/pages returns { key, title, updated_at } — there is no
          // `content` in this payload, so read `title` directly.
          return '<tr><td><code>' + esc(r.key) + '</code></td>' +
            '<td>' + esc(r.title || '—') + '</td>' +
            '<td class="col-actions"><a class="btn tiny" href="#/pages/' + encodeURIComponent(r.key) + '">Edit</a></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (err) { stateError(document.getElementById('pages-body'), err); });
  }

  // Friendly field sets for the page shapes the public site actually renders
  // (see server/scripts/seed.js + public/js/pages.js). `path` is dotted, so
  // "hero.title" edits content.hero.title and unknown keys are preserved.
  var PAGE_FIELDS = {
    'home': [
      { path: 'hero.badge', label: 'Hero badge', type: 'text' },
      { path: 'hero.title', label: 'Hero title', type: 'text' },
      { path: 'hero.subtitle', label: 'Hero subtitle', type: 'textarea', rows: 3 },
      { path: 'hero.ctaLabel', label: 'Primary button label', type: 'text' },
      { path: 'hero.ctaLink', label: 'Primary button link (e.g. /events)', type: 'text' },
      { path: 'hero.cta2Label', label: 'Secondary button label', type: 'text' },
      { path: 'hero.cta2Link', label: 'Secondary button link (e.g. /contact)', type: 'text' },
      { path: 'stats', label: 'Statistics — JSON array, e.g. [{"value":"4","label":"Programs"}]', type: 'json' },
      { path: 'about.title', label: 'About block title', type: 'text' },
      { path: 'about.text', label: 'About block text', type: 'textarea', rows: 5 }
    ],
    'about-head': [
      { path: 'title', label: 'Title', type: 'text' },
      { path: 'text', label: 'Intro text', type: 'textarea', rows: 4 },
      { path: 'values', label: 'Values — JSON array, e.g. [{"title":"…","text":"…"}]', type: 'json' }
    ],
    'contact': [
      { path: 'title', label: 'Title', type: 'text' },
      { path: 'text', label: 'Intro text', type: 'textarea', rows: 4 },
      { path: 'visit', label: 'Visit / office hours note', type: 'textarea', rows: 3 }
    ]
  };

  /** Read a dotted path out of an object (returns undefined when absent). */
  function getPath(obj, path) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  /** Write a dotted path into an object, creating parents as needed. */
  function setPath(obj, path, value) {
    var parts = String(path).split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {};
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function pagePageEditor(key) {
    var el = view();
    stateLoad(el, 'Loading page…');

    A.api('/admin/pages/' + encodeURIComponent(key)).then(function (row) {
      var content = row.content || {};
      // Known page shapes get friendly fields; anything else falls back to JSON.
      var fields = PAGE_FIELDS[key] || [{ path: '__root', label: 'Page content (JSON)', type: 'json' }];

      var fieldsHtml = fields.map(function (f) {
        var v = f.path === '__root' ? content : getPath(content, f.path);
        var inner;
        if (f.type === 'json') {
          inner = '<textarea name="f-' + f.path + '" rows="10">' +
            esc(JSON.stringify(v == null ? (f.path === '__root' ? {} : []) : v, null, 2)) + '</textarea>';
        } else if (f.type === 'textarea') {
          inner = '<textarea name="f-' + f.path + '" rows="' + (f.rows || 4) + '">' + esc(v == null ? '' : v) + '</textarea>';
        } else {
          inner = '<input type="' + f.type + '" name="f-' + f.path + '" value="' + esc(v == null ? '' : v) + '">';
        }
        return '<div class="form-field"><label for="f-' + f.path + '">' + esc(f.label) + '</label>' + inner +
          '<div class="field-error" data-error="' + f.path + '"></div></div>';
      }).join('');

      el.innerHTML =
        '<div class="page-head"><h1>Edit copy: ' + esc(key) + '</h1>' +
          '<div class="head-actions"><a class="btn ghost" href="#/pages">&larr; All pages</a></div></div>' +
        '<div class="panel">' +
          '<div class="form-error" id="form-error" hidden></div>' +
          '<form id="page-form" novalidate>' + fieldsHtml +
            '<div class="form-actions">' +
              '<button type="submit" class="btn" id="save-btn">Save copy</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      bindPageForm(key, fields, el, content);
    }).catch(function (err) { stateError(el, err); });
  }

  function bindPageForm(key, fields, el, original) {
    document.getElementById('page-form').addEventListener('submit', function (e) {
      e.preventDefault();
      // Start from a deep copy of what is stored so keys this form does not show
      // (or that other modules read) survive the save.
      var newContent = JSON.parse(JSON.stringify(original || {}));
      var invalid = null;

      el.querySelectorAll('.field-error').forEach(function (n) { n.textContent = ''; });
      var errBox = document.getElementById('form-error');
      errBox.hidden = true;

      fields.forEach(function (f) {
        if (invalid) return;
        var node = el.querySelector('[name="f-' + f.path + '"]');
        if (!node) return;
        if (f.type === 'json') {
          var text = node.value.trim();
          var parsed = f.path === '__root' ? {} : [];
          if (text) {
            try {
              parsed = JSON.parse(text);
            } catch (err) {
              invalid = f;
              var je = el.querySelector('[data-error="' + f.path + '"]');
              if (je) je.textContent = 'Invalid JSON: ' + err.message;
              return;
            }
          }
          if (f.path === '__root') {
            newContent = parsed && typeof parsed === 'object' ? parsed : {};
          } else {
            setPath(newContent, f.path, parsed);
          }
        } else {
          setPath(newContent, f.path, node.value.trim() || null);
        }
      });

      if (invalid) {
        errBox.textContent = 'Please fix the highlighted field.';
        errBox.hidden = false;
        return;
      }

      var btn = document.getElementById('save-btn');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      A.api('/admin/pages/' + encodeURIComponent(key), { method: 'PUT', body: { content: newContent } })
        .then(function () {
          toast('Copy saved.');
          btn.disabled = false;
          btn.textContent = 'Save copy';
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Save copy';
          errBox.textContent = err.message;
          errBox.hidden = false;
        });
    });
  }

  // --------------------------------------------------------------- settings --
  // Keys must match what the public site reads: `public/js/site.js` (footer +
  // contact strip) and `public/js/pages.js` (contact page). See the seed in
  // server/scripts/seed.js.
  var SETTINGS_FIELDS = [
    { name: 'office_email', label: 'Contact email', type: 'email' },
    { name: 'office_phone', label: 'Contact phone', type: 'text' },
    { name: 'office_location', label: 'Address', type: 'textarea', rows: 2 },
    { name: 'office_hours', label: 'Office hours', type: 'text' },
    { name: 'social_facebook', label: 'Facebook URL', type: 'url' },
    { name: 'social_instagram', label: 'Instagram URL', type: 'url' },
    { name: 'social_twitter', label: 'X (Twitter) URL', type: 'url' }
  ];

  function pageSettings() {
    var el = view();
    stateLoad(el, 'Loading settings…');

    A.api('/admin/settings').then(function (row) {
      var values = row || {};
      var fieldsHtml = SETTINGS_FIELDS.map(function (f) {
        var v = values[f.name];
        var inner;
        if (f.type === 'textarea') {
          inner = '<textarea name="f-' + f.name + '" rows="' + (f.rows || 2) + '">' + esc(v == null ? '' : v) + '</textarea>';
        } else {
          inner = '<input type="' + f.type + '" name="f-' + f.name + '" value="' + esc(v == null ? '' : v) + '">';
        }
        return '<div class="form-field"><label for="f-' + f.name + '">' + esc(f.label) + '</label>' + inner + '</div>';
      }).join('');

      el.innerHTML =
        '<div class="page-head"><h1>&#9881; Settings</h1></div>' +
        '<div class="panel">' +
          '<div class="form-error" id="form-error" hidden></div>' +
          '<form id="settings-form" novalidate>' + fieldsHtml +
            '<div class="form-actions"><button type="submit" class="btn" id="save-btn">Save settings</button></div>' +
          '</form>' +
        '</div>';

      document.getElementById('settings-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var body = {};
        SETTINGS_FIELDS.forEach(function (f) {
          var node = el.querySelector('[name="f-' + f.name + '"]');
          body[f.name] = f.type === 'number'
            ? (node.value === '' ? null : Number(node.value))
            : (node.value.trim() || null);
        });
        var btn = document.getElementById('save-btn');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        // Flat `{ key: value }` — that is what PUT /api/admin/settings expects.
        A.api('/admin/settings', { method: 'PUT', body: body })
          .then(function () {
            toast('Settings saved.');
            btn.disabled = false;
            btn.textContent = 'Save settings';
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Save settings';
            var errBox = document.getElementById('form-error');
            errBox.textContent = err.message;
            errBox.hidden = false;
          });
      });
    }).catch(function (err) { stateError(el, err); });
  }

  // ------------------------------------------------------------------ users --
  function pageUsers() {
    var el = view();
    el.innerHTML =
      '<div class="page-head"><h1>&#128101; Users</h1>' +
        '<div class="head-actions"><button class="btn" id="new-user-btn">+ New user</button></div></div>' +
      '<div id="users-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>' +
      '<div id="user-form-root"></div>';

    function load() {
      var body = document.getElementById('users-body');
      body.innerHTML = '<div class="state"><div class="spinner"></div><p>Loading…</p></div>';
      A.api('/admin/users').then(function (rows) {
        if (!rows.length) return stateEmpty(body, 'No users found.');
        body.innerHTML = '<div class="table-wrap"><table class="list-table"><thead><tr>' +
          '<th>Name</th><th>Email</th><th>Role</th><th>Created</th><th class="col-actions">Actions</th></tr></thead><tbody>' +
          rows.map(function (u) {
            return '<tr data-id="' + u.id + '">' +
              '<td>' + esc(u.name) + '</td><td>' + esc(u.email) + '</td>' +
              '<td><span class="role-pill ' + esc(u.role) + '">' + esc(u.role) + '</span></td>' +
              '<td>' + fmtDate(u.created_at) + '</td>' +
              '<td class="col-actions">' +
                '<button class="btn tiny" data-edit>Edit</button>' +
                '<button class="btn tiny danger" data-del' + (u.id === user.id ? ' disabled title="You cannot delete your own account"' : '') + '>Delete</button>' +
              '</td></tr>';
          }).join('') + '</tbody></table></div>';

        body.querySelectorAll('tr[data-id]').forEach(function (tr) {
          var id = Number(tr.getAttribute('data-id'));
          var row = rows.filter(function (r) { return r.id === id; })[0];
          tr.querySelector('[data-edit]').addEventListener('click', function () { openUserForm(row); });
          tr.querySelector('[data-del]').addEventListener('click', function () {
            confirmDialog('Delete user?', 'Removes "' + row.name + '" (' + row.email + ').', 'Delete').then(function (ok) {
              if (!ok) return;
              A.api('/admin/users/' + id, { method: 'DELETE' })
                .then(function () { toast('User deleted.'); load(); })
                .catch(function (err) { toast(err.message, 'error'); });
            });
          });
        });
      }).catch(function (err) { stateError(document.getElementById('users-body'), err); });
    }

    function openUserForm(row) {
      var root = document.getElementById('user-form-root');
      var isEdit = !!row;
      root.innerHTML =
        '<div class="panel" style="margin-top:24px">' +
          '<h2>' + (isEdit ? 'Edit user' : 'New user') + '</h2>' +
          '<div class="form-error" id="user-error" hidden></div>' +
          '<form id="user-form" novalidate>' +
            '<div class="form-field"><label for="u-name">Name</label>' +
              '<input type="text" id="u-name" value="' + esc(row ? row.name : '') + '"></div>' +
            '<div class="form-field"><label for="u-email">Email</label>' +
              '<input type="email" id="u-email" value="' + esc(row ? row.email : '') + '"></div>' +
            '<div class="form-field"><label for="u-role">Role</label>' +
              '<select id="u-role">' +
                '<option value="editor"' + (row && row.role === 'editor' ? ' selected' : '') + '>Editor — posts, events, notices, media</option>' +
                '<option value="admin"' + (row && row.role === 'admin' ? ' selected' : '') + '>Admin — everything</option>' +
              '</select></div>' +
            '<div class="form-field"><label for="u-password">' + (isEdit ? 'New password (leave blank to keep current)' : 'Password') + '</label>' +
              '<input type="password" id="u-password" autocomplete="new-password"></div>' +
            '<div class="form-actions">' +
              '<button type="submit" class="btn">' + (isEdit ? 'Save user' : 'Create user') + '</button>' +
              '<button type="button" class="btn ghost" id="u-cancel">Cancel</button>' +
            '</div>' +
          '</form>' +
        '</div>';

      document.getElementById('u-cancel').addEventListener('click', function () { root.innerHTML = ''; });
      document.getElementById('user-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var errBox = document.getElementById('user-error');
        errBox.hidden = true;

        var body = {
          name: document.getElementById('u-name').value.trim(),
          email: document.getElementById('u-email').value.trim(),
          role: document.getElementById('u-role').value
        };
        var pw = document.getElementById('u-password').value;
        if (pw) body.password = pw;

        if (!body.name || !body.email || (!isEdit && !pw)) {
          errBox.textContent = 'Name, email and a password are required.';
          errBox.hidden = false;
          return;
        }

        var req = isEdit
          ? A.api('/admin/users/' + row.id, { method: 'PUT', body: body })
          : A.api('/admin/users', { method: 'POST', body: body });

        req.then(function () {
          toast('User saved.');
          root.innerHTML = '';
          load();
        }).catch(function (err) {
          errBox.textContent = err.message;
          errBox.hidden = false;
        });
      });
    }

    document.getElementById('new-user-btn').addEventListener('click', function () { openUserForm(null); });
    load();
  }

  // ------------------------------------------------------------------- boot --
  document.getElementById('signout').addEventListener('click', function () {
    A.clearSession();
    location.href = A.loginUrl();
  });

  // "Sign out everywhere": the plain Sign out button only clears this browser's
  // localStorage, so a token copied out of it keeps working until it expires.
  // This bumps the account's token_version on the server, which retires every
  // token issued so far - including this one, hence the redirect afterwards.
  document.getElementById('signout-all').addEventListener('click', function () {
    confirmDialog(
      'Sign out everywhere?',
      'Every browser currently signed in as this account will be signed out, including this one. Use this if you think someone else has your session.',
      'Sign out everywhere'
    ).then(function (ok) {
      if (!ok) return;
      A.api('/auth/logout-all', { method: 'POST' }).then(function () {
        A.clearSession();
        location.href = A.loginUrl();
      }).catch(function (err) {
        toast(err.message, 'error');
      });
    });
  });

  // ---------------------------------------------------------------- activity --
  // Who changed what. Every admin mutation writes a row (server/lib/audit.js),
  // which is the only way to answer "who unpublished that?" when the whole
  // office shares one admin login.
  var ACTION_LABEL = {
    create: 'Created', update: 'Edited', delete: 'Deleted',
    publish: 'Published', unpublish: 'Unpublished',
    'media.upload': 'Uploaded media', 'media.delete': 'Deleted media',
    'user.create': 'Created user', 'user.update': 'Edited user', 'user.delete': 'Deleted user',
    'page.update': 'Edited site copy', 'settings.update': 'Changed settings'
  };

  function pageActivity() {
    var el = view();
    el.innerHTML =
      '<div class="page-head"><h1>&#128203; Activity</h1>' +
        '<div class="head-actions"><button class="btn ghost tiny" id="activity-refresh">Refresh</button></div></div>' +
      '<p class="muted-note">Every create, edit, publish, delete, upload and user change, ' +
      'recorded with who did it. Retained for 180 days.</p>' +
      '<div id="activity-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

    function load() {
      var body = document.getElementById('activity-body');
      stateLoad(body, 'Loading activity…');
      A.api('/admin/activity?limit=200').then(function (rows) {
        if (!rows.length) {
          return stateEmpty(body, 'Nothing recorded yet. Actions appear here as staff make changes.');
        }
        var html = '<div class="table-wrap"><table class="list-table"><thead><tr>' +
          '<th>When</th><th>Who</th><th>Action</th><th>Item</th><th>Details</th>' +
          '</tr></thead><tbody>';
        rows.forEach(function (r) {
          var label = ACTION_LABEL[r.action] || r.action;
          var detail = '';
          if (r.meta) {
            var bits = [];
            if (r.meta.fields) bits.push('fields: ' + r.meta.fields.join(', '));
            if (r.meta.changed) bits.push('changed: ' + r.meta.changed.join(', '));
            if (r.meta.bytes !== undefined) bits.push(Math.round(r.meta.bytes / 1024) + ' KB');
            if (r.meta.role) bits.push('role: ' + r.meta.role);
            if (r.meta.sessions_revoked) bits.push('sessions revoked');
            if (r.meta.keys) bits.push(r.meta.keys.join(', '));
            detail = bits.join(' · ');
          }
          var cls = r.action === 'delete' || r.action === 'user.delete' ? 'badge warn'
                  : (r.action === 'publish' ? 'badge ok' : 'badge');
          html += '<tr>' +
            '<td>' + esc(fmtWhen(r.created_at)) + '</td>' +
            '<td>' + esc(r.user_email || 'system') + '</td>' +
            '<td><span class="' + cls + '">' + esc(label) + '</span></td>' +
            '<td>' + esc(r.target || '') + (r.module ? ' <span class="muted-note">(' + esc(r.module) + ')</span>' : '') + '</td>' +
            '<td class="muted-note">' + esc(detail) + '</td>' +
            '</tr>';
        });
        body.innerHTML = html + '</tbody></table></div>';
      }).catch(function (err) { stateError(body, err); });
    }

    document.getElementById('activity-refresh').addEventListener('click', load);
    load();
  }

  /** UTC timestamps come back as "YYYY-MM-DD HH:MM:SS". */
  function fmtWhen(value) {
    if (!value) return '';
    var s = String(value).replace('T', ' ').replace('Z', '');
    return s.slice(0, 16);
  }

  // ----------------------------------------------------------------- backups --
  // Lists the backups ops/backup.sh has already written and downloads them.
  // Nothing is created here: the app container has no mysqldump, and the
  // backups directory is mounted read-only, so this page can only ever take a
  // copy. The nightly 02:15 job is the source of truth.
  function pageBackup() {
    var el = view();
    el.innerHTML =
      '<div class="page-head"><h1>&#128190; Backup &amp; download</h1>' +
        '<div class="head-actions"><button class="btn ghost tiny" id="backup-refresh">Refresh</button></div></div>' +
      '<p class="muted-note">Backups are created automatically by the server every night at 02:15 ' +
      '(plus a full media archive on Sundays). Download a copy whenever you want one &mdash; ' +
      'the database dump, the uploaded media, or the binary logs that allow restoring to a ' +
      'specific moment in the last two weeks.</p>' +
      '<div id="backup-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>';

    function load() {
      var body = document.getElementById('backup-body');
      stateLoad(body, 'Loading backups…');
      A.api('/admin/backups').then(function (data) {
        if (!data.mounted) {
          return stateEmpty(body, esc(data.message || 'No backups directory is mounted.'));
        }
        if (!data.groups || !data.groups.length || !data.newest) {
          return stateEmpty(body, 'No backups yet. The nightly job has not run, or this install is new.');
        }

        var html = '';
        data.groups.forEach(function (g) {
          if (g.secrets) {
            html += '<div class="panel"><h2>Secrets</h2>' +
              '<p class="muted-note">' + esc(g.note) + '</p></div>';
            return;
          }
          if (!g.items.length) return;
          html += '<div class="panel"><h2>' + esc(g.label) +
            ' <span class="badge">' + g.items.length + '</span></h2>' +
            '<div class="table-wrap"><table class="list-table"><thead><tr>' +
            '<th>File</th><th class="col-date">Created</th><th class="col-size">Size</th>' +
            '<th class="col-actions">Actions</th></tr></thead><tbody>';
          g.items.slice(0, 12).forEach(function (it) {
            html += '<tr>' +
              '<td>' + esc(it.name) + '</td>' +
              '<td>' + esc(it.mtime ? fmtWhen(it.mtime) : '—') + '</td>' +
              '<td>' + fmtBytes(it.bytes) + '</td>' +
              '<td class="col-actions">' +
              '<button class="btn tiny" data-kind="' + esc(g.kind) + '" data-stamp="' +
              esc(it.download || it.name) + '" data-name="' + esc(it.name) + '">Download</button>' +
              '</td></tr>';
          });
          html += '</tbody></table></div></div>';
        });

        if (data.newest) {
          html = '<div class="upload-box">' +
            '<div><b>Latest backup:</b> ' + esc(data.newest.name) + ' &middot; ' +
            fmtBytes(data.newest.bytes) + ' &middot; taken ' +
            esc(data.newest.mtime ? fmtWhen(data.newest.mtime) : 'unknown') + ' UTC</div>' +
            '<button class="btn" data-kind="db" data-stamp="' + esc(data.newest.download || data.newest.name) +
            '" data-name="' + esc(data.newest.name) + '">Download the database dump</button>' +
            '</div>' + html;
        }

        body.innerHTML = html;

        body.querySelectorAll('button[data-kind]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var kind = btn.getAttribute('data-kind');
            var stamp = btn.getAttribute('data-stamp');
            var label = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Preparing…';
            A.download('/admin/backups/' + kind + '/' + encodeURIComponent(stamp))
              .then(function (r) {
                toast('Downloaded ' + r.name + ' (' + fmtBytes(r.bytes) + ').');
              })
              .catch(function (err) {
                toast(err.message, 'error');
              })
              .then(function () {
                btn.disabled = false;
                btn.textContent = label;
              });
          });
        });
      }).catch(function (err) { stateError(body, err); });
    }

    function fmtBytes(n) {
      var units = ['B', 'KB', 'MB', 'GB', 'TB'];
      var v = Number(n) || 0, i = 0;
      while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
      return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
    }

    document.getElementById('backup-refresh').addEventListener('click', load);
    load();
  }

  renderShell();
  window.addEventListener('hashchange', route);
  route();
})();
