/* Student Affairs CMS — admin login */
(function () {
  'use strict';

  var A = window.AdminAuth;

  // Already signed in → straight to the dashboard.
  if (A.token() && A.user()) {
    location.href = A.BASE + '/admin';
    return;
  }

  var form = document.getElementById('login-form');
  var errBox = document.getElementById('login-error');
  var btn = document.getElementById('login-btn');

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errBox.hidden = true;

    var email = document.getElementById('email').value.trim();
    var password = document.getElementById('password').value;

    if (!email || !password) {
      errBox.textContent = 'Enter your email and password.';
      errBox.hidden = false;
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Signing in…';

    A.api('/auth/login', { method: 'POST', body: { email: email, password: password } })
      .then(function (res) {
        A.saveSession(res.token, res.user);
        location.href = A.BASE + '/admin';
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = 'Sign in';
        errBox.textContent = err.message;
        errBox.hidden = false;
      });
  });
})();
