/* ==========================================================================
   Markdown sanitiser regression test.

   Runs the real public/js/api.js + the real vendored marked, so it covers the
   shipped bundle rather than a reimplementation. Run:  node ops/markdown-sanitizer.test.js

   Two things must hold:
     1. Raw HTML in a Markdown body never survives as markup. marked passes
        source HTML through verbatim, and the result goes into innerHTML, so
        this is the control between staff-entered text and script execution.
     2. Ordinary Markdown keeps rendering. A sanitiser that escapes the whole
        document is not a fix, it is an outage - this catches the "replaced the
        renderer instead of overriding it" failure, which silently renders every
        article as bare source text.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Optional override so the suite can be pointed at a copy of the bundle, which
// is how you confirm it actually fails when the sanitiser is removed.
const apiPath = process.argv[2] || path.join(root, 'public', 'js', 'api.js');
const apiSrc = fs.readFileSync(apiPath, 'utf8');
const marked = require(path.join(root, 'public', 'js', 'vendor', 'marked.min.js'));

console.log('testing: ' + apiPath + '\n');

global.window = { SA_BASE_PATH: '/student-affairs', marked: marked };
const SA = eval(
  '(function(){' +
  apiSrc.replace(/\(function \(\) \{/, '').replace(/\}\)\(\);\s*$/, '') +
  '; return window.SA; })()'
);

let failed = 0;
const check = (name, ok, detail) => {
  if (!ok) failed++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  (' + detail + ')' : ''));
};

/**
 * mdToHtml through a guard. A renderer that was replaced instead of overridden
 * makes marked throw on the first missing method; without this the whole suite
 * dies with a stack trace instead of reporting which checks failed.
 */
function render(md) {
  try {
    return SA.mdToHtml(md);
  } catch (e) {
    return { __error: e.message };
  }
}

// A tag that would become a real element. No separate event-handler assertion:
// once no live tag can be emitted there is no element to hang an onerror on, and
// matching /\son\w+=/ against escaped text flags the payload's own source (the
// "onerror=" inside &lt;img ... onerror=&quot;) as a failure.
const LIVE_TAG = /<\s*(script|style|iframe|meta|form|img|svg|object|embed|a)\b/i;

console.log('--- raw HTML must be escaped, not rendered ---');
const ATTACKS = [
  ['img onerror', 'Hello <img src=x onerror="window.pwned=1"> end'],
  ['inline event handler', '<b onclick=alert(1)>click</b>'],
  ['style block', '<style>body{display:none}</style>'],
  ['meta refresh', '<meta http-equiv=refresh content="0;url=https://evil.example">'],
  ['script tag', '<script>window.pwned=1</script>'],
  ['iframe', '<iframe src="https://evil.example"></iframe>'],
  ['svg onload', '<svg onload=alert(1)>'],
  ['object/embed', '<object data="x"></object><embed src="y">'],
  ['form injection', '<form action="/api/admin/posts" method="post"><input name=x></form>'],
];
for (const [name, md] of ATTACKS) {
  const html = render(md);
  check('escaped: ' + name, !LIVE_TAG.test(html), 'rendered as ' + String(html).slice(0, 60));
}

console.log('\n--- dangerous URL schemes must be dropped ---');
const URL_ATTACKS = [
  ['javascript: link', '[click](javascript:window.pwned=1)'],
  ['obfuscated java\\tscript:', '[click](java\tscript:window.pwned=1)'],
  ['data: uri link', '[x](data:text/html,<script>1</script>)'],
  ['vbscript: link', '[x](vbscript:msgbox(1))'],
  ['javascript: image', '![x](javascript:window.pwned=1)'],
];
for (const [name, md] of URL_ATTACKS) {
  const html = render(md);
  check(
    'dropped: ' + name,
    !/href="javascript:/i.test(html) && !/src="javascript:/i.test(html) &&
      !/href="data:/i.test(html) && !/href="vbscript:/i.test(html),
    'rendered as ' + String(html).slice(0, 60)
  );
}

console.log('\n--- ordinary Markdown must still render ---');
const GOOD = [
  ['heading', '# Title', /<h1[^>]*>Title<\/h1>/i],
  ['h2', '## Sub', /<h2[^>]*>Sub<\/h2>/i],
  ['bold', '**bold**', /<strong>bold<\/strong>/i],
  ['italic', '*em*', /<em>em<\/em>/i],
  ['bullet list', '- one\n- two', /<li>one<\/li>/i],
  ['ordered list', '1. a\n2. b', /<ol>/i],
  ['table', '| a | b |\n|---|---|\n| 1 | 2 |', /<table>/i],
  ['https link', '[ok](https://example.com)', /href="https:\/\/example\.com"/i],
  ['mailto link', '[m](mailto:a@b.c)', /href="mailto:a@b\.c"/i],
  ['relative link', '[n](/news)', /href="\/news"/i],
  ['anchor link', '[x](#sec)', /href="#sec"/i],
  ['blockquote', '> quoted', /<blockquote>/i],
  ['code fence', '```\nx=1\n```', /<pre>/i],
  ['inline code', '`x=1`', /<code>/i],
  ['paragraph', 'plain text', /<p>plain text<\/p>/i],
  ['horizontal rule', '---', /<hr>/i],
  ['library image', '![alt](1791-x.png)', /<img src="\/student-affairs\/uploads\/1791-x\.png"/i],
  ['external image', '![a](https://cdn.example/a.png)', /src="https:\/\/cdn\.example\/a\.png"/i],
  ['link with title', '[ok](https://example.com "T")', /title="T"/i],
];
for (const [name, md, re] of GOOD) {
  const html = render(md);
  check('renders: ' + name, typeof html === 'string' && re.test(html), 'got ' + String(html).slice(0, 60));
}

console.log('');
if (failed === 0) {
  console.log('MARKDOWN SANITISER CHECKS PASSED');
  process.exit(0);
} else {
  console.log(failed + ' CHECK(S) FAILED');
  process.exit(1);
}