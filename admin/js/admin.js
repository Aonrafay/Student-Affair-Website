/* ==========================================================================
   Student Affairs CMS — admin SPA
   Hash-routed: #/dashboard  #/m/<module>[/{new|id}]  #/media  #/pages
                #/pages/<key>  #/settings  #/users
   Depends on: auth.js (window.AdminAuth), modules.js (window.ADMIN_MODULES)
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
      if (parts[2] && Number(parts[2])) return pageForm(mod, Number(parts[2]));
      return pageList(mod);
    }
    if (head === 'media') return canAccess({ roles: ['admin', 'editor'] }) ? pageMedia() : noAccess();
    if (head === 'pages' && parts[1]) return user.role === 'admin' ? pagePageEditor(parts[1]) : noAccess();
    if (head === 'pages') return user.role === 'admin' ? pagePages() : noAccess();
    if (head === 'settings') return user.role === 'admin' ? pageSettings() : noAccess();
    if (head === 'users') return user.role === 'admin' ? pageUsers() : noAccess();
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
    if (f.type === 'json') {
      return '<textarea ' + name + ' rows="' + (f.jsonMode === 'object' ? 6 : 4) + '" data-json="' + esc(f.jsonMode || 'object') + '"' + req + '>' + esc(v) + '</textarea>';
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

      bindMediaFields(mod);
      bindForm(mod, id);
    }).catch(function (err) { stateError(el, err); });
  }

  /** Wire the "Choose from media" pickers inside a form. */
  function bindMediaFields(mod) {
    view().querySelectorAll('.media-field').forEach(function (wrap) {
      var input = wrap.querySelector('input[type="text"]');
      var preview = wrap.querySelector('.media-preview');
      var fieldName = wrap.getAttribute('data-field');
      var accept = '';
      for (var i = 0; i < mod.fields.length; i++) {
        if (mod.fields[i].name === fieldName && mod.fields[i].type === 'media') {
          accept = mod.fields[i].accept || '';
          break;
        }
      }

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
    });
  }

  /** Media picker modal → resolves with the chosen filename via onPick. */
  function openMediaPicker(accept, onPick) {
    var root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-overlay"><div class="modal wide" role="dialog" aria-modal="true" aria-label="Choose media">' +
        '<div class="modal-head"><h3>Choose from media</h3>' +
          '<button class="btn tiny ghost" id="picker-close">&times; Close</button></div>' +
        '<div id="picker-body"><div class="state"><div class="spinner"></div><p>Loading…</p></div></div>' +
      '</div></div>';

    document.getElementById('picker-close').addEventListener('click', function () { root.innerHTML = ''; });

    A.api('/admin/media').then(function (items) {
      var body = document.getElementById('picker-body');
      var filtered = (accept === 'image')
        ? items.filter(function (m) { return String(m.mime || '').indexOf('image/') === 0; })
        : (accept === 'pdf' ? items.filter(function (m) { return m.mime === 'application/pdf'; }) : items);

      if (!filtered.length) {
        body.innerHTML = '<div class="state empty"><p>No matching media yet — upload one below.</p></div>' + uploadFormHtml(true);
      } else {
        body.innerHTML = '<div class="media-grid">' + filtered.map(function (m) {
          return '<button type="button" class="media-item" data-name="' + esc(m.filename) + '">' +
            '<span class="media-thumb">' +
              (String(m.mime || '').indexOf('image/') === 0
                ? '<img src="' + esc(A.mediaUrl(m.filename)) + '" alt="">'
                : '<span class="ph-text">PDF</span>') +
            '</span>' +
            '<span class="media-name">' + esc(m.original_name || m.filename) + '</span>' +
          '</button>';
        }).join('') + '</div>' + uploadFormHtml(true);
      }

      body.querySelectorAll('.media-item').forEach(function (btn) {
        btn.addEventListener('click', function () {
          root.innerHTML = '';
          onPick(btn.getAttribute('data-name'));
        });
      });
      bindUploadForm(body, function () {
        root.innerHTML = '';
      }, function (filename) {
        root.innerHTML = '';
        onPick(filename);
      });
    }).catch(function (err) {
      document.getElementById('picker-body').innerHTML = '<div class="state error"><p>' + esc(err.message) + '</p></div>';
    });
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
      } else if (f.type === 'json') {
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

      req.then(function () {
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
      '<input type="file" id="upload-input">' +
      '<button type="button" class="btn" id="upload-btn">Upload file</button>' +
      '<span class="upload-hint">Images (jpg, png, webp, gif) or PDF, up to 10&nbsp;MB.</span>' +
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
          var c = r.content || {};
          return '<tr><td><code>' + esc(r.key) + '</code></td>' +
            '<td>' + esc(c.title || c.hero_title || '—') + '</td>' +
            '<td class="col-actions"><a class="btn tiny" href="#/pages/' + encodeURIComponent(r.key) + '">Edit</a></td></tr>';
        }).join('') + '</tbody></table></div>';
    }).catch(function (err) { stateError(document.getElementById('pages-body'), err); });
  }

  function pagePageEditor(key) {
    var el = view();
    stateLoad(el, 'Loading page…');

    A.api('/admin/pages/' + encodeURIComponent(key)).then(function (row) {
      var content = row.content || {};
      // Known page shapes get friendly fields; anything else falls back to JSON.
      var known = {
        'home': [
          { name: 'hero_title', label: 'Hero title', type: 'text' },
          { name: 'hero_text', label: 'Hero text', type: 'textarea', rows: 3 },
          { name: 'about_title', label: 'About block title', type: 'text' },
          { name: 'about_text', label: 'About block text', type: 'textarea', rows: 4 }
        ],
        'about-head': [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Intro text', type: 'textarea', rows: 4 },
          { name: 'values', label: 'Values — JSON array, e.g. [{"title":"…","text":"…"}]', type: 'json', jsonMode: 'object' }
        ],
        'contact': [
          { name: 'title', label: 'Title', type: 'text' },
          { name: 'text', label: 'Intro text', type: 'textarea', rows: 4 },
          { name: 'map_embed', label: 'Map embed URL (optional)', type: 'url' }
        ]
      };
      var fields = known[key] || [{ name: '__json', label: 'Page content (JSON)', type: 'json' }];

      var fieldsHtml = fields.map(function (f) {
        var v;
        if (f.name === '__json') {
          v = content;
        } else if (f.type === 'json') {
          v = content[f.name] != null ? content[f.name] : [];
        } else {
          v = content[f.name];
        }
        var inner;
        if (f.type === 'json') {
          inner = '<textarea name="f-' + f.name + '" rows="10">' + esc(JSON.stringify(v == null ? {} : v, null, 2)) + '</textarea>';
        } else if (f.type === 'textarea') {
          inner = '<textarea name="f-' + f.name + '" rows="' + (f.rows || 4) + '">' + esc(v == null ? '' : v) + '</textarea>';
        } else {
          inner = '<input type="' + f.type + '" name="f-' + f.name + '" value="' + esc(v == null ? '' : v) + '">';
        }
        return '<div class="form-field"><label for="f-' + f.name + '">' + esc(f.label) + '</label>' + inner +
          '<div class="field-error" data-error="' + f.name + '"></div></div>';
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

      bindPageForm(key, fields, el);
    }).catch(function (err) { stateError(el, err); });
  }

  function bindPageForm(key, fields, el) {
    document.getElementById('page-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var newContent = {};
      var invalid = null;

      el.querySelectorAll('.field-error').forEach(function (n) { n.textContent = ''; });
      var errBox = document.getElementById('form-error');
      errBox.hidden = true;

      fields.forEach(function (f) {
        if (invalid) return;
        var node = el.querySelector('[name="f-' + f.name + '"]');
        if (f.type === 'json') {
          try {
            var parsed = JSON.parse(node.value);
            newContent[f.name] = parsed;
          } catch (err) {
            invalid = f;
            var je = el.querySelector('[data-error="' + f.name + '"]');
            if (je) je.textContent = 'Invalid JSON: ' + err.message;
          }
        } else {
          newContent[f.name] = node.value.trim() || null;
        }
      });
      if (fields.length === 1 && fields[0].name === '__json') {
        newContent = newContent.__json || {};
      }

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
  var SETTINGS_FIELDS = [
    { name: 'office_hours', label: 'Office hours', type: 'text' },
    { name: 'email', label: 'Contact email', type: 'email' },
    { name: 'phone', label: 'Contact phone', type: 'text' },
    { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
    { name: 'featured_event_id', label: 'Featured event ID (blank = auto)', type: 'number' },
    { name: 'featured_post_id', label: 'Featured post ID (blank = auto)', type: 'number' }
  ];

  function pageSettings() {
    var el = view();
    stateLoad(el, 'Loading settings…');

    A.api('/admin/settings').then(function (row) {
      var values = (row && row.values) || row || {};
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
        A.api('/admin/settings', { method: 'PUT', body: { values: body } })
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

  renderShell();
  window.addEventListener('hashchange', route);
  route();
})();
