'use strict';

const bcrypt = require('bcryptjs');
const { q, qOne, pool } = require('../config/db');
const { toJSON } = require('../lib/helpers');

// ============================================================================
// Idempotent first-boot seed — NASTP Institute of Information Technology (NIIT),
// a constituent college of Air University, Islamabad (https://niit.edu.pk/).
// Users/pages/settings are inserted only when missing (so admin edits survive
// restarts); content tables are seeded only while empty.
// Only publicly known NIIT facts are used. Societies, office team, partners and
// documents are left empty for staff to fill in via the admin area.
// ============================================================================

async function insertIfTableEmpty(table, rows) {
  const row = await qOne(`SELECT COUNT(*) AS c FROM \`${table}\``);
  if (row && Number(row.c) > 0) {
    console.log(`  ${table}: already has ${row.c} rows — skipping.`);
    return;
  }
  for (const item of rows) {
    await q(`INSERT INTO \`${table}\` SET ?`, [item]);
  }
  console.log(`  ${table}: seeded ${rows.length} row(s).`);
}

async function insertIfKeyMissing(table, key, data) {
  const existing = await qOne(`SELECT id FROM \`${table}\` WHERE \`key\` = ?`, [key]);
  if (existing) return;
  await q(`INSERT INTO \`${table}\` SET ?`, data);
}

async function seed() {
  console.log('Seeding NIIT Student Affairs CMS…');

  // --- Users ----------------------------------------------------------------
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@niit.edu.pk').trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const editorEmail = (process.env.EDITOR_EMAIL || 'editor@niit.edu.pk').trim().toLowerCase();
  const editorPassword = process.env.EDITOR_PASSWORD || 'editor123';

  for (const u of [
    { name: 'Site Administrator', email: adminEmail, password: adminPassword, role: 'admin' },
    { name: 'Content Editor', email: editorEmail, password: editorPassword, role: 'editor' }
  ]) {
    const existing = await qOne('SELECT id FROM users WHERE email = ?', [u.email]);
    if (existing) continue;
    await q('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)', [
      u.name, u.email, await bcrypt.hash(u.password, 10), u.role
    ]);
    console.log(`  users: created ${u.role} ${u.email}`);
  }

  // --- Settings (insert only when missing) -----------------------------------
  // Contact details from https://niit.edu.pk/
  const settings = {
    office_email: 'info@niit.edu.pk',
    office_phone: '+92 42 36666033',
    office_location: 'NASTP Institute of Information Technology, 69 Abid Majeed Road, Lahore Cantt',
    office_hours: 'Mon–Fri: 9:00 AM – 5:00 PM',
    social_facebook: '',
    social_instagram: '',
    social_twitter: '',
    featured_post_ids: '[]',
    featured_event_ids: '[]'
  };
  for (const [key, value] of Object.entries(settings)) {
    await insertIfKeyMissing('settings', key, { key, value });
  }
  console.log(`  settings: ensured ${Object.keys(settings).length} key(s).`);

  // --- Pages (site copy) -----------------------------------------------------
  const pages = [
    {
      key: 'home',
      title: 'Home',
      content: {
        hero: {
          badge: 'NASTP Institute of Information Technology &middot; Office of Student Affairs',
          title: 'Shaping Tomorrow\u2019s Technology Leaders',
          subtitle: 'Empowering students with cutting-edge technology education, a vibrant campus community and innovative research opportunities at NASTP, Lahore Cantt.',
          ctaLabel: 'See upcoming events',
          ctaLink: '/events',
          cta2Label: 'Contact the office',
          cta2Link: '/contact'
        },
        stats: [
          { value: '4', label: 'Technology programs — CS, SE, AI & Cyber Security' },
          { value: 'HEC', label: 'Recognized & accredited institution' },
          { value: '2023', label: 'Empowering the future since' }
        ],
        about: {
          title: 'The Office of Student Affairs',
          text: 'NIIT is a constituent college of Air University, Islamabad, located at the National Aerospace Science and Technology Park (NASTP). The Office of Student Affairs is here for everything beyond the classroom — questions about campus life, events and student support. Our door is open, and someone will always point you in the right direction.'
        }
      }
    },
    {
      key: 'about-head',
      title: 'About the Office',
      content: {
        title: 'Welcome to Student Affairs',
        text: 'The NASTP Institute of Information Technology (NIIT), a constituent college of Air University, offers programs in Computer Science, AI, Software Engineering and Cyber Security at NASTP, Lahore Cantt. The Office of Student Affairs supports every NIIT student through orientation, campus events and day-to-day student support — from your first merit-list moment to your final semester.',
        values: [
          { title: 'Innovation', text: 'Nurturing innovation and practical, hands-on learning across campus life.' },
          { title: 'Critical thinking', text: 'Encouraging students to question, explore and grow beyond the syllabus.' },
          { title: 'Technological proficiency', text: 'Building the skills and mindset needed to thrive in a changing world.' }
        ]
      }
    },
    {
      key: 'contact',
      title: 'Contact',
      content: {
        title: 'Get in touch',
        text: 'Questions about admissions, campus life or student support? Call us, write to us, or visit the campus at NASTP, 69 Abid Majeed Road, Lahore Cantt — we are happy to help.',
        visit: 'Office hours are Monday to Friday, 9:00 AM to 5:00 PM. You can also reach the institute at info@niit.edu.pk or +92 42 36666033.'
      }
    }
  ];
  for (const page of pages) {
    await insertIfKeyMissing('pages', page.key, {
      key: page.key,
      title: page.title,
      content: typeof page.content === 'string' ? page.content : toJSON(page.content)
    });
  }

  // --- Dates -----------------------------------------------------------------
  const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

  // --- Posts -----------------------------------------------------------------
  // Topics are real NIIT items (https://niit.edu.pk/): Fall 2026 admissions,
  // merit list, orientation, classes commencement and campus life events.
  const posts = [
    {
      slug: 'first-merit-list-fall-2026',
      title: '1st merit list announced — Fall 2026 intake',
      category: 'announcement',
      excerpt: 'The first merit list for the Fall 2026 intake was announced on 25 August. Admitted students should prepare for orientation on 17–18 September.',
      body: 'The first merit list for the Fall 2026 intake was announced on 25 August. Congratulations to every student who received an offer — welcome to NIIT.\n\nKey dates for the Fall 2026 intake:\n• 25 August — 1st merit list announcement\n• 17–18 September — Orientation for the Fall 2026 new intake\n• 28 September — Classes commence for all programs\n\nNIIT offers BS and MS programs in Computer Science, Software Engineering, Artificial Intelligence and Cyber Security at the NASTP campus, Lahore Cantt. For any question about your admission, contact the institute at info@niit.edu.pk or +92 42 36666033.',
      cover: null,
      status: 'published',
      published_at: daysAgo(6)
    },
    {
      slug: 'admissions-open-fall-2026',
      title: 'Admissions open for Fall 2026 — BS and MS programs',
      category: 'announcement',
      excerpt: 'Applications are open for BS and MS programs in Computer Science, Software Engineering, Artificial Intelligence and Cyber Security.',
      body: 'Admissions are open for the Fall 2026 intake at the NASTP Institute of Information Technology (NIIT), a constituent college of Air University, Islamabad.\n\nPrograms offered:\n• BS Computer Science\n• BS Software Engineering\n• BS Artificial Intelligence\n• BS Cyber Security\n• MS programs\n\nNIIT is recognized by the Higher Education Commission (HEC) and located inside the National Aerospace Science and Technology Park (NASTP), 69 Abid Majeed Road, Lahore Cantt — combining a cutting-edge curriculum, expert faculty and modern facilities.\n\nApply before the deadline via the admissions office. Questions? Email info@niit.edu.pk or call +92 42 36666033.',
      cover: null,
      status: 'published',
      published_at: daysAgo(10)
    },
    {
      slug: 'orientation-fall-2026-new-intake',
      title: 'Orientation for Fall 2026 new intake — 17–18 September',
      category: 'news',
      excerpt: 'Two days of welcome sessions for the new intake: meet the faculty, tour the NASTP campus and get set for classes starting 28 September.',
      body: 'Orientation for the Fall 2026 new intake runs on 17–18 September. Every newly admitted student is expected to attend — it is the easiest way to meet your program faculty, find your way around the NASTP campus and complete the remaining enrolment steps before classes commence on 28 September.\n\nBring your original documents and your admission letter. If you cannot attend a session, contact the Office of Student Affairs in advance at info@niit.edu.pk.',
      cover: null,
      status: 'published',
      published_at: daysAgo(3)
    },
    {
      slug: 'sports-week-on-campus',
      title: 'Sports Week: athleticism, spirit and university pride',
      category: 'news',
      excerpt: 'Sports Week returned to campus — a vibrant celebration of competition, teamwork and university pride across a variety of games and events.',
      body: 'Sports Week brought the thrill of competition and teamwork to campus — a vibrant celebration of athleticism, spirit and university pride across a variety of games and events.\n\nStudents competed for their programs, supporters filled the grounds, and the week closed with prizes for the winning teams. See the Office of Student Affairs if you want to take part in the next sporting fixture.',
      cover: null,
      status: 'published',
      published_at: daysAgo(45)
    },
    {
      slug: 'womens-day-on-campus',
      title: 'Women\u2019s Day: strength, achievements and voices',
      category: 'news',
      excerpt: 'NIIT marked Women\u2019s Day with inspiring events, discussions and activities promoting equality, empowerment and inclusion on campus.',
      body: 'NIIT celebrated the strength, achievements and voices of women through inspiring events, discussions and activities that promote equality, empowerment and inclusion on campus.\n\nThank you to every student and faculty member who took part. The Office of Student Affairs continues to support an inclusive campus for everyone.',
      cover: null,
      status: 'published',
      published_at: daysAgo(170)
    },
    {
      slug: 'marathon-race-on-campus',
      title: 'Marathon Race: students, faculty and alumni run together',
      category: 'achievement',
      excerpt: 'The annual marathon brought students, faculty and alumni together for fitness, fun and a shared spirit of determination.',
      body: 'The annual Marathon Race challenged participants to celebrate endurance — students, faculty and alumni running together for fitness, fun and a shared spirit of determination.\n\nWell done to every runner who crossed the finish line. See you again next year.',
      cover: null,
      status: 'published',
      published_at: daysAgo(90)
    },
    {
      slug: 'softtech-planning-draft',
      title: 'Softtech — internal planning (draft)',
      category: 'news',
      excerpt: 'Draft planning notes for the next Softtech event. Not yet approved for publishing.',
      body: 'Draft planning notes for the next Softtech event — transforming innovative ideas into practical solutions through collaboration and technology. This post is not yet approved for publishing.',
      cover: null,
      status: 'draft',
      published_at: null
    }
  ];

// --- Notices -----------------------------------------------------------------
  const notices = [
    {
      slug: 'classes-commence-28-september',
      title: 'Classes commence — 28 September, all programs',
      body: 'Classes for all Fall 2026 programs commence on 28 September. Timetables will be shared with your program orientation material.\n\nMake sure your enrolment is complete before the first lecture. For help, contact the institute at info@niit.edu.pk or +92 42 36666033.',
      pdf: null,
      status: 'published',
      published_at: daysAgo(4)
    },
    {
      slug: 'orientation-17-18-september',
      title: 'Fall 2026 orientation — 17–18 September',
      body: 'Orientation for the Fall 2026 new intake takes place on 17–18 September at the NIIT campus, NASTP, Lahore Cantt. All newly admitted students should attend both days.\n\nBring your admission letter and original documents.',
      pdf: null,
      status: 'published',
      published_at: daysAgo(4)
    },
    {
      slug: 'merit-list-25-august',
      title: '1st merit list — Fall 2026 (announced 25 August)',
      body: 'The 1st merit list for the Fall 2026 intake was announced on 25 August. Admitted students should watch for their orientation schedule for 17–18 September.\n\nQueries about the merit list can be directed to info@niit.edu.pk.',
      pdf: null,
      status: 'published',
      published_at: daysAgo(6)
    },
    {
      slug: 'campus-fire-drill-draft',
      title: 'Campus fire drill schedule (draft)',
      body: 'Draft schedule for the next campus fire drill. NIIT runs regular emergency preparedness and evacuation training. This notice is not yet approved for publishing.',
      pdf: null,
      status: 'draft',
      published_at: null
    }
  ];

// --- Events ------------------------------------------------------------------
  const events = [
    {
      slug: 'orientation-fall-2026',
      title: 'Orientation — Fall 2026 New Intake',
      description: 'Orientation for the Fall 2026 new intake, 17–18 September. Meet your program faculty, tour the NASTP campus and complete your enrolment before classes commence on 28 September.',
      start_time: daysFromNow(17),
      end_time: daysFromNow(18),
      location: 'NIIT Campus, NASTP, 69 Abid Majeed Road, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON([
        'Meet the faculty of CS, SE, AI & Cyber Security',
        'Campus tour of the NASTP facilities',
        'Enrolment & document verification'
      ]),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(1)
    },
    {
      slug: 'classes-commence-fall-2026',
      title: 'Classes Commence — Fall 2026, All Programs',
      description: 'Classes for all BS and MS programs commence on 28 September. Check your timetable and make sure your enrolment is complete before the first lecture.',
      start_time: daysFromNow(28),
      end_time: daysFromNow(28),
      location: 'NIIT Campus, NASTP, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON([]),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(2)
    },
    {
      slug: 'sports-week',
      title: 'Sports Week',
      description: 'A vibrant celebration of athleticism, spirit and university pride across a variety of games and events — experience the thrill of competition and teamwork.',
      start_time: daysAgo(40),
      end_time: daysAgo(35),
      location: 'NIIT Campus, NASTP, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON([
        'Games and events across the week',
        'Program teams competing for pride',
        'Prizes for winning teams'
      ]),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(50)
    },
    {
      slug: 'marathon-race',
      title: 'Marathon Race',
      description: 'The annual marathon where students, faculty and alumni run together for fitness, fun and a shared spirit of determination.',
      start_time: daysAgo(90),
      end_time: daysAgo(90),
      location: 'NIIT Campus, NASTP, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON(['Students, faculty and alumni running together']),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(95)
    },
    {
      slug: 'womens-day',
      title: 'Women\u2019s Day',
      description: 'Celebrating the strength, achievements and voices of women through inspiring events, discussions and activities that promote equality, empowerment and inclusion on campus.',
      start_time: daysAgo(170),
      end_time: daysAgo(170),
      location: 'NIIT Campus, NASTP, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON(['Events, discussions and activities on campus']),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(175)
    },
    {
      slug: 'welcome-party',
      title: 'Welcome Party',
      description: 'A formal introduction to campus life and new connections for the new intake.',
      start_time: daysAgo(200),
      end_time: daysAgo(200),
      location: 'NIIT Campus, NASTP, Lahore Cantt',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON([]),
      results: toJSON([]),
      registration_url: '',
      status: 'published',
      published_at: daysAgo(205)
    },
    {
      slug: 'softtech',
      title: 'Softtech (date to be confirmed)',
      description: 'Transform innovative ideas into practical solutions through collaboration and technology. Draft listing — the date and venue are yet to be confirmed.',
      start_time: daysFromNow(60),
      end_time: daysFromNow(60),
      location: 'TBC',
      cover: null,
      gallery: toJSON([]),
      highlights: toJSON([]),
      results: toJSON([]),
      registration_url: '',
      status: 'draft',
      published_at: null
    }
  ];

// --- Societies / team / partners / documents ---------------------------------
// Intentionally left empty: no official NIIT list is published yet. Staff add
// these from the admin area as the information becomes available.
  const societies = [];
  const team = [];
  const partners = [];
  const documents = [];

  // --- Insert everything (only when the table is empty) ----------------------
  await insertIfTableEmpty('posts', posts);
  await insertIfTableEmpty('notices', notices);
  await insertIfTableEmpty('events', events);
  await insertIfTableEmpty('societies', societies);
  await insertIfTableEmpty('team_members', team);
  await insertIfTableEmpty('partners', partners);
  await insertIfTableEmpty('documents', documents);

  console.log('Seed complete — the site is ready to browse.');
}

seed()
  .then(() => pool.end())
  .catch((e) => {
    console.error('Seed failed:', e.message);
    process.exit(1);
  });
