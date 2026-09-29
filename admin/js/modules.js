/* ==========================================================================
   Student Affairs CMS — admin module registry (mirrors server/modules.js)
   Each entry drives the sidebar, list table and generated form.
   Field types: text | textarea | select | json | media | checkbox |
                 date | datetime-local | slug | number | email | password | url |
                 markdown (Markdown editor: toolbar + live preview + image insert)
   Adding a module? Add it on the server (server/modules.js) and mirror the
   field config here. See README → "Adding a future module".
   ========================================================================== */
(function () {
  'use strict';

  var MODULES = [
    {
      id: 'posts',
      label: 'Posts',
      singular: 'post',
      icon: '&#128240;',
      roles: ['admin', 'editor'],
      titleField: 'title',
      columns: [
        { key: 'title', label: 'Title', primary: true },
        { key: 'category', label: 'Category', badge: true },
        { key: 'status', label: 'Status', status: true },
        { key: 'published_at', label: 'Publish date', date: true }
      ],
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'category', label: 'Category', type: 'select', required: true, options: [
          ['news', 'News'], ['announcement', 'Announcement'], ['achievement', 'Achievement']
        ] },
        { name: 'excerpt', label: 'Excerpt (short summary shown in lists)', type: 'textarea', rows: 2 },
        { name: 'body', label: 'Article (Markdown)', type: 'markdown', required: true, rows: 18 },
        { name: 'cover', label: 'Cover image', type: 'media', accept: 'image' },
        { name: 'published_at', label: 'Publish date (optional)', type: 'datetime-local' },
        { name: 'slug', label: 'Slug (left empty → generated from title)', type: 'slug' }
      ]
    },

    {
      id: 'events',
      label: 'Events',
      singular: 'event',
      icon: '&#128197;',
      roles: ['admin', 'editor'],
      titleField: 'title',
      columns: [
        { key: 'title', label: 'Title', primary: true },
        { key: 'start_time', label: 'Starts', date: true },
        { key: 'location', label: 'Location' },
        { key: 'status', label: 'Status', status: true }
      ],
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'description', label: 'Description (Markdown)', type: 'markdown', rows: 10 },
        { name: 'start_time', label: 'Starts', type: 'datetime-local' },
        { name: 'end_time', label: 'Ends', type: 'datetime-local' },
        { name: 'location', label: 'Location', type: 'text' },
        { name: 'cover', label: 'Cover image', type: 'media', accept: 'image' },
        { name: 'highlights', label: 'Highlights (one per line)', type: 'json', jsonMode: 'lines' },
        { name: 'results', label: 'Outcomes / results (one per line)', type: 'json', jsonMode: 'lines' },
        { name: 'gallery', label: 'Gallery (media filenames, one per line)', type: 'json', jsonMode: 'lines' },
        { name: 'registration_url', label: 'Registration URL', type: 'url' },
        { name: 'slug', label: 'Slug (left empty → generated from title)', type: 'slug' }
      ]
    },

    {
      id: 'notices',
      label: 'Notices',
      singular: 'notice',
      icon: '&#128203;',
      roles: ['admin', 'editor'],
      titleField: 'title',
      columns: [
        { key: 'title', label: 'Title', primary: true },
        { key: 'status', label: 'Status', status: true },
        { key: 'published_at', label: 'Publish date', date: true }
      ],
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'body', label: 'Notice text (Markdown)', type: 'markdown', required: true, rows: 10 },
        { name: 'pdf', label: 'Attached PDF (optional)', type: 'media', accept: 'pdf' },
        { name: 'published_at', label: 'Publish date (optional)', type: 'datetime-local' },
        { name: 'slug', label: 'Slug (left empty → generated from title)', type: 'slug' }
      ]
    },

    {
      id: 'societies',
      label: 'Societies',
      singular: 'society',
      icon: '&#127917;',
      roles: ['admin', 'editor'],
      titleField: 'name',
      // Drill-down: societies contain per-year Markdown pages, and each year
      // page carries its own officers/committee (people) — handled by custom
      // routes in admin.js (#/m/societies/<id>/years[/new|/<yid>]).
      child: { route: 'years', label: 'Years', singular: 'year page' },
      columns: [
        { key: 'name', label: 'Name', primary: true },
        { key: 'tagline', label: 'Tagline' },
        { key: 'status', label: 'Status', status: true }
      ],
      fields: [
        { name: 'name', label: 'Society name', type: 'text', required: true },
        { name: 'tagline', label: 'Tagline (one line)', type: 'text' },
        { name: 'motto', label: 'Motto', type: 'text' },
        { name: 'purpose', label: 'Purpose / description', type: 'textarea', rows: 6 },
        { name: 'cover', label: 'Cover image', type: 'media', accept: 'image' },
        { name: 'features', label: 'What we do (one per line)', type: 'json', jsonMode: 'lines' },
        { name: 'slug', label: 'Slug (left empty → generated from name)', type: 'slug' }
      ]
    },

    {
      id: 'team',
      label: 'Office team',
      singular: 'team member',
      icon: '&#128100;',
      roles: ['admin', 'editor'],
      titleField: 'name',
      columns: [
        { key: 'name', label: 'Name', primary: true },
        { key: 'role', label: 'Role' },
        { key: 'featured', label: 'Featured', bool: true },
        { key: 'status', label: 'Status', status: true }
      ],
      fields: [
        { name: 'name', label: 'Full name', type: 'text', required: true },
        { name: 'role', label: 'Role / title', type: 'text', required: true },
        { name: 'bio', label: 'Short bio', type: 'textarea', rows: 4 },
        { name: 'photo', label: 'Photo', type: 'media', accept: 'image' },
        { name: 'email', label: 'Email', type: 'email' },
        { name: 'sort_order', label: 'Sort order (lower shows first)', type: 'number' },
        { name: 'featured', label: 'Featured on the office page', type: 'checkbox' },
        { name: 'slug', label: 'Slug (left empty → generated from name)', type: 'slug' }
      ]
    },

    {
      id: 'partners',
      label: 'Partners',
      singular: 'partner',
      icon: '&#129309;',
      roles: ['admin', 'editor'],
      titleField: 'name',
      // Collaboration types, most important first — the public partners page
      // renders the groups in exactly this order. Keep in sync with
      // PARTNER_CATEGORIES in public/js/pages.js.
      partnerCategories: [
        'Strategic Partners',
        'Academic Collaborations',
        'Industry Partners',
        'Community Partners'
      ],
      columns: [
        { key: 'name', label: 'Name', primary: true },
        { key: 'category', label: 'Category', badge: true },
        { key: 'sort_order', label: 'Sort' },
        { key: 'status', label: 'Status', status: true }
      ],
      fields: [
        { name: 'name', label: 'Partner name', type: 'text', required: true },
        { name: 'category', label: 'Collaboration type', type: 'select', required: true, options: [
          ['Strategic Partners', 'Strategic Partners'],
          ['Academic Collaborations', 'Academic Collaborations'],
          ['Industry Partners', 'Industry Partners'],
          ['Community Partners', 'Community Partners']
        ] },
        { name: 'description', label: 'About this partnership (Markdown)', type: 'markdown', rows: 12 },
        { name: 'cover', label: 'Cover image (partner page)', type: 'media', accept: 'image' },
        { name: 'logo', label: 'Logo (shown on the partners grid)', type: 'media', accept: 'image' },
        { name: 'website', label: 'Website (https://…)', type: 'url' },
        { name: 'sort_order', label: 'Importance — lower shows first (its top partner gets the big card)', type: 'number' },
        { name: 'slug', label: 'Slug (left empty → generated from name)', type: 'slug' }
      ]
    },

    {
      id: 'documents',
      label: 'Documents',
      singular: 'document',
      icon: '&#128196;',
      roles: ['admin', 'editor'],
      titleField: 'title',
      columns: [
        { key: 'title', label: 'Title', primary: true },
        { key: 'category', label: 'Category', badge: true },
        { key: 'status', label: 'Status', status: true }
      ],
      fields: [
        { name: 'title', label: 'Title', type: 'text', required: true },
        { name: 'category', label: 'Category (groups the list)', type: 'text' },
        { name: 'description', label: 'Description', type: 'textarea', rows: 3 },
        { name: 'file', label: 'File (PDF or image)', type: 'media' },
        { name: 'slug', label: 'Slug (left empty → generated from title)', type: 'slug' }
      ]
    }
  ];

  // Fixed sections shown in the sidebar below the content modules.
  var EXTRAS = [
    { id: 'media', label: 'Media library', icon: '&#128444;', roles: ['admin', 'editor'], route: 'media' },
    { id: 'pages', label: 'Site copy', icon: '&#128221;', roles: ['admin'], route: 'pages' },
    { id: 'settings', label: 'Settings', icon: '&#9881;', roles: ['admin'], route: 'settings' },
    { id: 'users', label: 'Users', icon: '&#128101;', roles: ['admin'], route: 'users' }
  ];

  window.ADMIN_MODULES = MODULES;
  window.ADMIN_EXTRAS = EXTRAS;
})();
