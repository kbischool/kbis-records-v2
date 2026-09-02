/* =========================================================================
   KBIS Schools — Student Records app
   Vanilla-JS single-page app. Hash-routed. Offline-first via service worker
   + localStorage cache of the JSON data, background-synced when online.
   ========================================================================= */

/* ---------------------------- small utilities --------------------------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function naira(n) {
  n = Number(n) || 0;
  return '₦' + n.toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

function initials(first, last) {
  const a = (first || '').trim()[0] || '';
  const b = (last || '').trim()[0] || '';
  return (b + a).toUpperCase() || '??';
}

const AVATAR_GRADIENTS = [
  ['#FF4FA0', '#FF8AC0'], ['#29ABE2', '#157AB8'], ['#FFC93C', '#FF9F3C'],
  ['#1FCBBD', '#0FA79C'], ['#8B6BFF', '#5C3FE0'], ['#FF6B4A', '#E8433A'],
];
function avatarGradient(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const [c1, c2] = AVATAR_GRADIENTS[h % AVATAR_GRADIENTS.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

function shortSession(s) { return s ? s.replace('20', "'") : s; } // "2024-2025" -> "'24-2025"

const LABELS = {
  'AD_FORM': 'Admission Form', 'AD-FORM': 'Admission Form', 'ADMISSION FORM': 'Admission Form',
  'TUITION': 'Tuition', 'FULL TUITION': 'Full Tuition (list price)', 'ACTUAL TUITION': 'Full Tuition (list price)',
  'PTA&EXAM': 'PTA & Exam', 'PTA/EXAM': 'PTA & Exam', 'PTA': 'PTA', 'EXAM': 'Exam',
  'REPORT_CARD': 'Report Card', 'REPORT CARD': 'Report Card',
  'PRACTICAL': 'Practicals', 'PRACTICALS': 'Practicals',
  'TEXTBOOKS': 'Textbooks', 'BOOKS': 'Books',
  'NB & STAT': 'Notebooks & Stationery', 'MAINTENANCE': 'Maintenance',
  'UNIFORM': 'Uniform', 'HAT': 'Hat', 'HOODY': 'Hoody', 'SPORTSWEAR': 'Sportswear',
  'COMPUTER PRACTICAL': 'Computer Practical', 'YEAR BOOK': 'Year Book',
  'AFTERSCHOOL': 'After-School Club', 'AFTER SCHOOL CLUB': 'After-School Club',
  'INTER-HOUSE SPORT': 'Inter-House Sport', 'PREVOCATIONAL PRACTICAL': 'Prevocational Practical',
  'PHONICS': 'Phonics', 'EARLY MORNING REVISION CLASSES': 'Early Morning Revision',
  'EXCURSION': 'Excursion', 'EXTERNAL EXAMINATION': 'External Examination', 'EXTERNAL EXAM': 'External Examination',
  'GRADUATION/ SPORTS/PARTY': 'Graduation / Sports / Party', 'GRADUATION': 'Graduation',
  'HOLIDAY LESSON': 'Holiday Lesson', 'OUTSTANDING': 'Balance Brought Forward',
  'FIRST DEPOSIT': '1st Deposit', 'SECOND DEPOSIT': '2nd Deposit', 'THIRD DEPOSIT': '3rd Deposit', 'FOURTH DEPOSIT': '4th Deposit',
  'LESSON FEE PRY': 'Lesson Fee (Primary)', 'LESSON FEE SEC': 'Lesson Fee (Secondary)', 'PARTY FEE REMIT': 'Party Fee',
};
function prettyLabel(k) {
  if (LABELS[k]) return LABELS[k];
  return k.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function classShort(c) {
  if (!c) return '—';
  const map = {
    'CRECHE': 'Creche', 'PLAYGROUP 1': 'Playgroup 1', 'PLAYGROUP 2': 'Playgroup 2',
    'NURSERY 1': 'Nursery 1', 'NURSERY 2': 'Nursery 2',
    'PRIMARY 1': 'Primary 1', 'PRIMARY 2': 'Primary 2', 'PRIMARY 3': 'Primary 3', 'PRIMARY 4': 'Primary 4', 'PRIMARY 5': 'Primary 5',
    'JUNIOR SECONDARY SCHOOL 1': 'JSS 1', 'JUNIOR SECONDARY SCHOOL 2': 'JSS 2', 'JUNIOR SECONDARY SCHOOL 3': 'JSS 3',
    'SENIOR SECONDARY SCHOOL 1': 'SSS 1', 'SENIOR SECONDARY SCHOOL 2': 'SSS 2', 'SENIOR SECONDARY SCHOOL 3': 'SSS 3',
  };
  return map[c] || c;
}

// Class order + display labels for the Notebooks & Stationery tab, whose
// source sheet uses short class codes (PG1, NUR1, PRY3, …) rather than the
// full names used on the Textbooks sheet.
const STOCK_CLASS_ORDER = [
  'CRECHE', 'PG1', 'PG2', 'NUR1', 'NUR2',
  'PRY1', 'PRY2', 'PRY3', 'PRY4', 'PRY5',
  'JSS1', 'JSS2', 'JSS3', 'SSS1', 'SSS2', 'SSS3',
];
const STOCK_CLASS_LABELS = {
  CRECHE: 'Creche', PG1: 'Playgroup 1', PG2: 'Playgroup 2', NUR1: 'Nursery 1', NUR2: 'Nursery 2',
  PRY1: 'Primary 1', PRY2: 'Primary 2', PRY3: 'Primary 3', PRY4: 'Primary 4', PRY5: 'Primary 5',
  JSS1: 'JSS 1', JSS2: 'JSS 2', JSS3: 'JSS 3', SSS1: 'SSS 1', SSS2: 'SSS 2', SSS3: 'SSS 3',
};

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------- app state ------------------------------- */
const STORE = {
  students: [], invoice: { classes: [] }, meta: {},
  stock: { uniforms: [], textbooks: [], notebooksAndStationery: [], stock: [] },
  salary: {},
  filters: { q: '', session: 'all', klass: 'all', status: 'all' },
};
let stockTab = 'uniforms'; // 'uniforms' | 'textbooks' | 'stationery' | 'orders' — active sub-tab on the Stock page
let stockQuery = ''; // textbook search text on the Stock page
let salaryQuery = ''; // staff-name search text on the Salary page

/* -------------------------------- auth gate ------------------------------ */
const Auth = {
  isUnlocked() { return sessionStorage.getItem(KBIS_CONFIG.SESSION_KEY) === '1' || localStorage.getItem(KBIS_CONFIG.SESSION_KEY) === '1'; },
  async tryUnlock(pass, remember) {
    const hash = await sha256Hex(pass.trim());
    if (hash === KBIS_CONFIG.ACCESS_HASH) {
      sessionStorage.setItem(KBIS_CONFIG.SESSION_KEY, '1');
      if (remember) localStorage.setItem(KBIS_CONFIG.SESSION_KEY, '1');
      return true;
    }
    return false;
  },
  lock() {
    sessionStorage.removeItem(KBIS_CONFIG.SESSION_KEY);
    localStorage.removeItem(KBIS_CONFIG.SESSION_KEY);
    location.hash = '#/';
    renderGate();
  },
};

function renderGate() {
  const root = $('#app-root');
  root.innerHTML = '';
  const gate = el(`
    <div class="gate">
      <form class="gate-card fade-in" id="gate-form" autocomplete="off">
        <img src="img/logo.png" alt="KBIS Schools crest">
        <h1>${KBIS_CONFIG.SCHOOL_NAME}</h1>
        <div class="sub">Student Records &middot; Staff Access</div>
        <div class="field" style="text-align:left">
          <label for="gate-pass">Passphrase</label>
          <input class="input" id="gate-pass" type="password" placeholder="Enter staff passphrase" autofocus>
        </div>
        <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft);font-weight:600;margin-top:12px;text-align:left">
          <input type="checkbox" id="gate-remember" checked style="width:16px;height:16px;">
          Keep me signed in on this device
        </label>
        <div class="gate-err" id="gate-err"></div>
        <button class="btn btn-primary btn-block" style="margin-top:10px" type="submit">Unlock</button>
      </form>
    </div>
  `);
  root.appendChild(gate);
  $('#gate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#gate-pass').value;
    const remember = $('#gate-remember').checked;
    const ok = await Auth.tryUnlock(pass, remember);
    if (ok) { boot(); } else {
      $('#gate-err').textContent = 'Incorrect passphrase — please try again.';
      $('#gate-pass').value = '';
      $('#gate-pass').focus();
    }
  });
}

/* -------------------------------- data layer ------------------------------ */
const Data = {
  async loadCachedFirst() {
    const cached = localStorage.getItem('kbis_data_v1');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        STORE.students = parsed.students; STORE.invoice = parsed.invoice; STORE.meta = parsed.meta;
        STORE.stock = parsed.stock || STORE.stock;
        STORE.salary = parsed.salary || STORE.salary;
      } catch (e) { /* ignore corrupt cache */ }
    }
    this.refreshInBackground(!!cached);
    return !!cached;
  },
  async fetchAll() {
    const base = KBIS_CONFIG.DATA_BASE;
    const emptyStock = { uniforms: [], textbooks: [], notebooksAndStationery: [], stock: [] };
    const [students, invoice, meta, stock, salary] = await Promise.all([
      fetch(base + 'students.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch(base + 'invoice.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch(base + 'meta.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch(base + 'stock.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : emptyStock)).catch(() => emptyStock),
      fetch(base + 'salary.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]);
    return { students, invoice, meta, stock, salary };
  },
  async refreshInBackground(hadCache) {
    try {
      const fresh = await this.fetchAll();
      const prevStamp = STORE.meta && STORE.meta.generatedAt;
      const changed = !prevStamp || prevStamp !== fresh.meta.generatedAt;
      STORE.students = fresh.students; STORE.invoice = fresh.invoice; STORE.meta = fresh.meta; STORE.stock = fresh.stock; STORE.salary = fresh.salary;
      localStorage.setItem('kbis_data_v1', JSON.stringify(fresh));
      localStorage.setItem('kbis_last_sync', new Date().toISOString());
      setOnlineStatus(true);
      if (hadCache && changed) {
        showToast('Records updated with the latest data.', { action: 'Refresh view', onAction: () => render() });
      } else {
        render();
      }
    } catch (e) {
      setOnlineStatus(false);
      if (!STORE.students.length) render(); // still render empty state gracefully
    }
  },
};

/* -------------------------------- online/offline -------------------------- */
function setOnlineStatus(isOnline) {
  const dot = $('#status-dot'); const label = $('#status-label');
  if (!dot) return;
  dot.classList.toggle('offline', !isOnline);
  label.textContent = isOnline ? 'Synced' : 'Offline';
}
window.addEventListener('online', () => { setOnlineStatus(true); Data.refreshInBackground(true); });
window.addEventListener('offline', () => setOnlineStatus(false));

/* -------------------------------- toast ------------------------------ */
let toastTimer = null;
function showToast(msg, opts = {}) {
  let t = $('#toast');
  if (!t) { t = el(`<div class="toast" id="toast"></div>`); document.body.appendChild(t); }
  t.innerHTML = `<span>${escapeHtml(msg)}</span>`;
  if (opts.action) {
    const btn = el(`<button>${escapeHtml(opts.action)}</button>`);
    btn.addEventListener('click', () => { opts.onAction && opts.onAction(); t.classList.remove('show'); });
    t.appendChild(btn);
  }
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 5000);
}

/* -------------------------------- sharing ------------------------------ */
async function shareText(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // user cancelled — do nothing
      // otherwise fall through to the clipboard fallback below
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied to clipboard — paste it into WhatsApp, SMS, or email.');
  } catch (e) {
    showToast('Could not share automatically — please copy the details manually.');
  }
}

function classShareText(c) {
  const items = Object.entries(c.items || {});
  const lines = [
    KBIS_CONFIG.SCHOOL_NAME,
    `Fee Structure — ${classShort(c.class)}`,
    `${STORE.meta.currentSession || ''} session`.trim(),
    '',
    ...items.map(([k, v]) => `${prettyLabel(k)}: ${naira(v)}`),
    '',
    `Grand Total: ${naira(c.grandTotal)}`,
  ];
  return lines.join('\n');
}

function termShareText(s, se, t) {
  const itemEntries = Object.entries(t.items || {});
  const extraEntries = Object.entries(t.extra || {});
  const depositEntries = Object.entries(t.deposits || {});
  const lines = [
    KBIS_CONFIG.SCHOOL_NAME,
    `${s.lastName} ${s.firstName} — ${t.term}, ${se.session}`,
    `Class: ${classShort(t.class)}`,
    '',
  ];
  itemEntries.forEach(([k, v]) => lines.push(`${prettyLabel(k)}: ${naira(v)}`));
  extraEntries.forEach(([k, v]) => lines.push(`${prettyLabel(k)}: ${naira(v)}`));
  depositEntries.forEach(([k, v]) => lines.push(`${prettyLabel(k)} (paid): ${naira(v)}`));
  if (!itemEntries.length && !extraEntries.length && !depositEntries.length) {
    lines.push('No itemised charges recorded for this term.');
  }
  if (t.discount) lines.push('', `Discount applied: ${(t.discount * 100).toFixed(0)}%`);
  lines.push('', `Total Fee: ${naira(t.total)}`, `Paid: ${naira(t.paid)}`, `Balance: ${naira(t.balance)}`);
  return lines.join('\n');
}

function studentShareText(s) {
  const lines = [
    KBIS_CONFIG.SCHOOL_NAME,
    `Account Statement — ${s.lastName} ${s.firstName}`,
    `${classShort(s.currentClass)} · ${s.status === 'active' ? 'Currently enrolled' : `Left after ${s.lastSession}`}`,
    '',
  ];
  s.sessions.forEach((se) => {
    const activeTerms = se.terms.filter((t) => t.total || t.paid || t.balance);
    if (!activeTerms.length) return;
    lines.push(se.session);
    activeTerms.forEach((t) => {
      lines.push(`  ${t.term} (${classShort(t.class)}): Total ${naira(t.total)} · Paid ${naira(t.paid)} · Balance ${naira(t.balance)}`);
    });
    lines.push('');
  });
  lines.push(`Current Balance: ${naira(s.latestBalance)}`);
  return lines.join('\n');
}

/* -------------------------------- router ------------------------------ */
function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [path, query] = hash.split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: new URLSearchParams(query || '') };
}
window.addEventListener('hashchange', render);

/* -------------------------------- shell (nav) ------------------------------ */
const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'students', label: 'Students', icon: 'users' },
  { id: 'fees', label: 'Fees', icon: 'receipt' },
  { id: 'stock', label: 'Stock', icon: 'box' },
  { id: 'salary', label: 'Salary', icon: 'cash' },
  { id: 'sync', label: 'Sync', icon: 'cloud' },
];
const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 19.5c0-3.3 2.9-5.7 6.5-5.7s6.5 2.4 6.5 5.7"/><circle cx="17" cy="8.5" r="2.6"/><path d="M15.5 14c2.9.3 5 2.4 5 5.5"/>',
  receipt: '<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6V3Z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.5-9 5.5 5.5 0 0 1 10.6-1.7A4 4 0 0 1 17 18H7Z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  empty: '<circle cx="12" cy="12" r="9"/><path d="M9 10h.01M15 10h.01M8 15c1.2 1 2.6 1.5 4 1.5s2.8-.5 4-1.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5 15.4 6.5M8.6 13.5 15.4 17.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 6v.01M18 6v.01M6 18v-.01M18 18v-.01"/>',
};
function icon(name, cls = '') { return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`; }

function renderShell() {
  const root = $('#app-root');
  root.innerHTML = `
    <header class="topbar">
      <img class="topbar__crest" src="img/logo.png" alt="">
      <div class="topbar__title"><b>${KBIS_CONFIG.SCHOOL_NAME}</b><span>Student Records</span></div>
      <nav class="topnav" id="topnav">
        ${NAV_ITEMS.map((n) => `<button data-nav="${n.id}">${n.label}</button>`).join('')}
      </nav>
      <div class="topbar__status"><span class="dot" id="status-dot"></span><span id="status-label">Syncing…</span></div>
    </header>
    <main id="view"></main>
    <nav class="tabbar" id="tabbar">
      ${NAV_ITEMS.map((n) => `<button data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></button>`).join('')}
    </nav>
  `;
  $all('[data-nav]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.nav; }));
}

function setActiveNav(id) {
  $all('[data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === id));
}

/* -------------------------------- views ------------------------------ */
function filteredStudents() {
  const { q, session, klass, status } = STORE.filters;
  const query = q.trim().toLowerCase();
  return STORE.students.filter((s) => {
    if (status !== 'all' && s.status !== status) return false;
    if (klass !== 'all' && s.currentClass !== klass) return false;
    if (session !== 'all' && !s.sessions.some((se) => se.session === session)) return false;
    if (query && !(`${s.firstName} ${s.lastName}`.toLowerCase().includes(query))) return false;
    return true;
  });
}

function viewHome() {
  const m = STORE.meta;
  const classCounts = m.classCounts || {};
  const maxCount = Math.max(1, ...Object.values(classCounts));
  const orderedClasses = (m.classes || []).filter((c) => classCounts[c]);

  return `
    <div class="fade-in">
      <div class="hero">
        <div class="hero-row">
          <img src="img/logo.png" alt="">
          <div>
            <h1>Welcome back 👋</h1>
            <p>Here's how ${KBIS_CONFIG.SCHOOL_NAME} is looking right now.</p>
          </div>
        </div>
        <div class="session-pill">Current session <b>&nbsp;${escapeHtml(m.currentSession || '—')}</b></div>
      </div>

      <div class="section-head"><h2>At a glance</h2></div>
      <div class="stat-grid">
        <div class="shield-stat c-sky">${icon('users', 'icon')}<span class="n">${m.totalStudents ?? '—'}</span><span class="l">Total Records</span></div>
        <div class="shield-stat c-teal">${icon('check', 'icon')}<span class="n">${m.activeStudents ?? '—'}</span><span class="l">Currently Enrolled</span></div>
        <div class="shield-stat c-navy">${icon('back', 'icon')}<span class="n">${m.leftStudents ?? '—'}</span><span class="l">Past Students</span></div>
        <div class="shield-stat c-coral">${icon('receipt', 'icon')}<span class="n" style="font-size:19px">${naira(m.currentOutstanding)}</span><span class="l">Outstanding</span></div>
      </div>

      <div class="section-head"><h2>Enrolment by class</h2><span class="hint">current session</span></div>
      <div class="card card-pad">
        <div class="bars">
          ${orderedClasses.length ? orderedClasses.map((c) => `
            <div class="bar-row">
              <div class="label">${classShort(c)}</div>
              <div class="bar-track"><div class="bar-fill" style="width:${(classCounts[c] / maxCount) * 100}%"></div></div>
              <div class="count">${classCounts[c]}</div>
            </div>
          `).join('') : `<p>No active enrolment data yet.</p>`}
        </div>
      </div>

      <div class="section-head"><h2>Quick links</h2></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-ghost" data-nav="students">${icon('users')} Browse students</button>
        <button class="btn btn-ghost" data-nav="fees">${icon('receipt')} Fee structure</button>
        <button class="btn btn-ghost" data-nav="stock">${icon('box')} Stock (cost price)</button>
        <button class="btn btn-ghost" data-nav="salary">${icon('cash')} Salary</button>
      </div>
    </div>
  `;
}

function viewStudents() {
  const m = STORE.meta;
  const list = filteredStudents();
  const { session, klass, status } = STORE.filters;

  return `
    <div class="fade-in">
      <div class="section-head" style="margin-top:0"><h2>Students</h2><span class="hint">${list.length} of ${STORE.students.length}</span></div>

      <div class="search-wrap" style="margin-bottom:12px">
        ${icon('search')}
        <input class="input" id="stu-search" placeholder="Search by name…" value="${escapeHtml(STORE.filters.q)}">
      </div>

      <div class="filter-row" style="margin-bottom:18px">
        <select class="input" data-filter="status">
          <option value="all" ${status === 'all' ? 'selected' : ''}>All students</option>
          <option value="active" ${status === 'active' ? 'selected' : ''}>Enrolled</option>
          <option value="left" ${status === 'left' ? 'selected' : ''}>Past</option>
        </select>
        <select class="input" data-filter="session">
          <option value="all" ${session === 'all' ? 'selected' : ''}>Any session</option>
          ${(m.sessions || []).slice().reverse().map((s) => `<option value="${s}" ${session === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        <select class="input" data-filter="klass">
          <option value="all" ${klass === 'all' ? 'selected' : ''}>Any class</option>
          ${(m.classes || []).map((c) => `<option value="${c}" ${klass === c ? 'selected' : ''}>${classShort(c)}</option>`).join('')}
        </select>
      </div>

      <div id="stu-list">
        ${list.length ? list.map(studentRowHtml).join('') : emptyStateHtml('No students match your filters', 'Try clearing the search or filters above.')}
      </div>
    </div>
  `;
}

function studentRowHtml(s) {
  const bal = s.latestBalance || 0;
  return `
    <div class="stu-row" data-student="${s.id}" tabindex="0">
      <div class="avatar" style="background:${avatarGradient(s.id)}">${initials(s.firstName, s.lastName)}</div>
      <div class="stu-info">
        <div class="name">${escapeHtml(s.lastName)} ${escapeHtml(s.firstName)}</div>
        <div class="meta">${classShort(s.currentClass)} &middot; ${s.status === 'active' ? 'Enrolled' : `Left ${s.lastSession}`}</div>
      </div>
      <div class="stu-side">
        <span class="bal ${bal === 0 ? 'zero' : ''}">${naira(bal)}</span>
        <small>${bal === 0 ? 'Cleared' : 'Balance'}</small>
      </div>
    </div>
  `;
}

function emptyStateHtml(title, sub) {
  return `<div class="empty-state">${icon('empty')}<b>${escapeHtml(title)}</b><p>${escapeHtml(sub)}</p></div>`;
}

let openTermSession = null; // remembers which session tab is active per student view

function viewStudent(id) {
  const s = STORE.students.find((x) => x.id === id);
  if (!s) return `<div class="fade-in">${emptyStateHtml('Student not found', 'They may have been renamed in the latest data refresh.')}</div>`;

  if (!openTermSession || !s.sessions.some((se) => se.session === openTermSession)) {
    openTermSession = s.sessions[s.sessions.length - 1].session;
  }
  const activeSess = s.sessions.find((se) => se.session === openTermSession) || s.sessions[s.sessions.length - 1];

  return `
    <div class="fade-in">
      <div class="passport">
        <div class="passport-head">
          <div class="passport-actions">
            <button class="back" data-nav="students">${icon('back')}</button>
            <button class="back" type="button" data-share-student title="Share account statement" aria-label="Share account statement">${icon('share')}</button>
          </div>
          <div class="passport-id">
            <div class="avatar" style="background:${avatarGradient(s.id)}">${initials(s.firstName, s.lastName)}</div>
            <div>
              <h2>${escapeHtml(s.lastName)} ${escapeHtml(s.firstName)}</h2>
              <div class="sub">${classShort(s.currentClass)} &middot; ${s.status === 'active' ? 'Currently enrolled' : `Left after ${s.lastSession}`}</div>
            </div>
          </div>
        </div>
        <div class="passport-stats">
          <div class="cell"><b>${s.sessionCount}</b><span>Session${s.sessionCount === 1 ? '' : 's'}</span></div>
          <div class="cell"><b>${s.firstSession}</b><span>First seen</span></div>
          <div class="cell"><b class="mono" style="color:${s.latestBalance ? 'var(--danger)' : 'var(--ok)'}">${naira(s.latestBalance)}</b><span>Balance</span></div>
        </div>
        <div class="passport-body">
          <span class="tag ${s.status}">${s.status === 'active' ? 'Enrolled' : 'Alumnus'}</span>

          <div class="section-head"><h2 style="font-size:15px">Session history</h2></div>
          <div class="session-tabs">
            ${s.sessions.map((se) => `
              <button class="session-tab ${se.session === activeSess.session ? 'active' : ''} ${se.session === STORE.meta.currentSession ? 'current' : ''}" data-session="${se.session}">
                <span class="yy">${se.session}</span><span class="cnt">${se.terms.length} term${se.terms.length === 1 ? '' : 's'}</span>
              </button>
            `).join('')}
          </div>

          <div id="term-list">
            ${activeSess.terms.map((t, i) => termCardHtml(t, i)).join('')}
          </div>
        </div>
      </div>
    </div>
  `;
}

function termCardHtml(t, idx) {
  const paidPct = t.total ? Math.min(100, Math.round((t.paid / t.total) * 100)) : 0;
  const itemEntries = Object.entries(t.items || {});
  const refEntries = Object.entries(t.reference || {});
  const depositEntries = Object.entries(t.deposits || {});
  const extraEntries = Object.entries(t.extra || {});
  const hasBreakdown = itemEntries.length + depositEntries.length + extraEntries.length > 0;

  return `
    <div class="term-card" data-term-idx="${idx}">
      <div class="term-head" data-toggle-term="${idx}">
        <div class="term-badge">${(idx + 1)}</div>
        <div class="ti"><b>${escapeHtml(t.term)}</b><span>${classShort(t.class)}</span></div>
        <div class="tv">
          <div class="amt">${naira(t.total)}</div>
          <div class="st ${t.balance > 0 ? 'due' : 'paid'}">${t.balance > 0 ? naira(t.balance) + ' due' : 'Fully paid'}</div>
        </div>
        <button class="icon-btn" type="button" data-share-term="${idx}" title="Share this term's bill" aria-label="Share this term's bill">${icon('share')}</button>
        ${icon('chevron', 'chev')}
      </div>
      <div class="term-progress"><div class="fill" style="width:${paidPct}%"></div></div>
      <div class="term-detail">
        ${t.discount ? `<div class="discount-badge">${icon('check')} ${(t.discount * 100).toFixed(0)}% discount applied</div>` : ''}
        <div class="term-totals">
          <div class="t"><b>${naira(t.total)}</b><span>Total Fee</span></div>
          <div class="t"><b>${naira(t.paid)}</b><span>Paid</span></div>
          <div class="t"><b>${naira(t.balance)}</b><span>Balance</span></div>
        </div>
        ${hasBreakdown ? `
          <div class="receipt">
            ${itemEntries.map(([k, v]) => `<div class="receipt-row"><span class="k">${escapeHtml(prettyLabel(k))}</span><span class="v">${naira(v)}</span></div>`).join('')}
            ${extraEntries.map(([k, v]) => `<div class="receipt-row"><span class="k">${escapeHtml(prettyLabel(k))}</span><span class="v">${naira(v)}</span></div>`).join('')}
            ${depositEntries.map(([k, v]) => `<div class="receipt-row"><span class="k">${escapeHtml(prettyLabel(k))} (paid)</span><span class="v">${naira(v)}</span></div>`).join('')}
            <div class="receipt-row total"><span class="k">Total</span><span class="v">${naira(t.total)}</span></div>
          </div>
        ` : `<p style="text-align:center;padding:10px 0">No itemised charges recorded for this term.</p>`}
        ${refEntries.length ? `<div class="ref-note">Full (pre-discount) list price: ${refEntries.map(([k, v]) => `${prettyLabel(k)} ${naira(v)}`).join(' &middot; ')}</div>` : ''}
      </div>
    </div>
  `;
}

function viewFees() {
  const classes = STORE.invoice.classes || [];
  return `
    <div class="fade-in">
      <div class="section-head" style="margin-top:0"><h2>Fee Structure</h2><span class="hint">${STORE.meta.currentSession || ''} session</span></div>
      <p style="margin-bottom:16px">This is the master fee list from the current INVOICE — the reference every term's bill is generated from.</p>
      ${classes.length ? classes.map(classCardHtml).join('') : emptyStateHtml('No fee structure loaded', 'Add INVOICE.xlsx to the source folder and rebuild the data.')}
    </div>
  `;
}
function classCardHtml(c) {
  const items = Object.entries(c.items || {});
  return `
    <div class="class-card" data-class-toggle>
      <div class="class-head">
        <span class="name">${classShort(c.class)}</span>
        <span class="gt">${naira(c.grandTotal)}</span>
        <button class="icon-btn" type="button" data-share-class="${escapeHtml(c.class)}" title="Share this fee structure" aria-label="Share this fee structure">${icon('share')}</button>
        ${icon('chevron', 'chev')}
      </div>
      <div class="class-body">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Amount</th></tr></thead>
            <tbody>
              ${items.map(([k, v]) => `<tr><td>${escapeHtml(prettyLabel(k))}</td><td>${naira(v)}</td></tr>`).join('')}
              <tr class="total"><td>Grand Total</td><td>${naira(c.grandTotal)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

/* -------------------------------- stock view ------------------------------ */
function viewStock() {
  return `
    <div class="fade-in">
      <div class="section-head" style="margin-top:0"><h2>Stock</h2><span class="hint">Everything from STOCKS.xlsx</span></div>
      <p style="margin-bottom:16px">Textbooks and Notebooks &amp; Stationery: each item's selling price and total cost per class. Uniforms and Stock Orders keep their full detail.</p>
      <div class="filter-row" style="margin-bottom:18px">
        <select class="input" id="stock-tab-select">
          <option value="uniforms" ${stockTab === 'uniforms' ? 'selected' : ''}>Uniforms</option>
          <option value="textbooks" ${stockTab === 'textbooks' ? 'selected' : ''}>Textbooks</option>
          <option value="stationery" ${stockTab === 'stationery' ? 'selected' : ''}>Notebooks &amp; Stationery</option>
          <option value="orders" ${stockTab === 'orders' ? 'selected' : ''}>Stock Orders</option>
        </select>
      </div>
      <div id="stock-panel">${stockPanelHtml()}</div>
    </div>
  `;
}

function stockPanelHtml() {
  const data = STORE.stock || {};
  if (stockTab === 'textbooks') {
    const rows = data.textbooks || [];
    return `
      ${rows.length ? `
        <div class="search-wrap" style="margin-bottom:14px">
          ${icon('search')}
          <input class="input" id="stock-search" placeholder="Search class, subject or title…" value="${escapeHtml(stockQuery)}">
        </div>
      ` : ''}
      <div id="stock-textbook-list">${textbookGroupsHtml(applyStockQuery(rows))}</div>
    `;
  }
  if (stockTab === 'stationery') return stationeryByClassHtml(data.notebooksAndStationery || []);
  if (stockTab === 'orders') return stockOrdersHtml(data.stock || []);
  return uniformsHtml(data.uniforms || []);
}

function applyStockQuery(rows) {
  const q = stockQuery.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => `${r.class} ${r.subject} ${r.textbook} ${r.provider}`.toLowerCase().includes(q));
}

// Shared groupings, reused by both the render functions and the share-text builders.
function textbooksByClass() {
  const byClass = {};
  (STORE.stock.textbooks || []).forEach((r) => { (byClass[r.class] ||= []).push(r); });
  return byClass;
}
function stationeryByClass() {
  const byClass = {};
  (STORE.stock.notebooksAndStationery || []).forEach((r) => {
    Object.entries(r.qtyByClass || {}).forEach(([klass, qty]) => {
      if (!qty) return;
      (byClass[klass] ||= []).push({ item: r.item, sellingPrice: r.sellingPrice, qty, total: (r.sellingPrice || 0) * qty });
    });
  });
  return byClass;
}
function sortedStockClasses(byClass) {
  return Object.keys(byClass).sort((a, b) => {
    const ia = STOCK_CLASS_ORDER.indexOf(a), ib = STOCK_CLASS_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function textbookGroupsHtml(rows) {
  if (!rows.length) {
    return stockQuery.trim()
      ? emptyStateHtml('No textbooks match', 'Try a different search term.')
      : emptyStateHtml('No textbook data loaded', 'Add STOCKS.xlsx to the source folder and rebuild the data.');
  }
  const byClass = {};
  rows.forEach((r) => { (byClass[r.class] ||= []).push(r); });
  return Object.entries(byClass).map(([klass, items]) => {
    const total = items.reduce((sum, i) => sum + (i.sellPrice || 0), 0);
    return `
      <div class="class-card" data-class-toggle>
        <div class="class-head">
          <span class="name">${escapeHtml(klass || '—')}</span>
          <span class="gt">${naira(total)}</span>
          <button class="icon-btn" type="button" data-share-textbooks="${escapeHtml(klass)}" title="Share this class's textbook list" aria-label="Share this class's textbook list">${icon('share')}</button>
          ${icon('chevron', 'chev')}
        </div>
        <div class="class-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr><th>Book</th><th>Selling Price</th></tr></thead>
              <tbody>
                ${items.map((i) => `<tr><td>${escapeHtml(i.textbook)}<small>${escapeHtml(i.subject)}</small></td><td>${naira(i.sellPrice)}</td></tr>`).join('')}
                <tr class="total"><td>Total</td><td>${naira(total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function uniformsHtml(groups) {
  if (!groups.length) return emptyStateHtml('No uniform data loaded', 'Add STOCKS.xlsx to the source folder and rebuild the data.');
  return groups.map((g) => `
    <div class="class-card" data-class-toggle>
      <div class="class-head">
        <span class="name">${escapeHtml(g.group)}</span>
        ${icon('chevron', 'chev')}
      </div>
      <div class="class-body">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead><tr><th>Item</th><th>Cost Price</th></tr></thead>
            <tbody>
              ${g.items.map((i) => `<tr><td>${escapeHtml(i.item)}</td><td>${naira(i.costPrice)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `).join('');
}

function stationeryByClassHtml(rows) {
  if (!rows.length) return emptyStateHtml('No stationery data loaded', 'Add STOCKS.xlsx to the source folder and rebuild the data.');

  // Regroup the item-centric sheet (each item lists a qty per class) into a
  // class-centric view: for each class, the materials its students need,
  // each item's unit selling price and qty, and that item's total selling
  // cost per student for the class.
  const byClass = stationeryByClass();
  const classes = sortedStockClasses(byClass);

  return classes.map((klass) => {
    const items = byClass[klass];
    const total = items.reduce((sum, i) => sum + i.total, 0);
    return `
      <div class="class-card" data-class-toggle>
        <div class="class-head">
          <span class="name">${escapeHtml(STOCK_CLASS_LABELS[klass] || klass)}</span>
          <span class="gt">${naira(total)}</span>
          <button class="icon-btn" type="button" data-share-stationery="${escapeHtml(klass)}" title="Share this class's stationery list" aria-label="Share this class's stationery list">${icon('share')}</button>
          ${icon('chevron', 'chev')}
        </div>
        <div class="class-body">
          <div class="data-table-wrap">
            <table class="data-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Total</th></tr></thead>
              <tbody>
                ${items.map((i) => `<tr><td>${escapeHtml(i.item)}</td><td>${i.qty}</td><td>${naira(i.sellingPrice)}</td><td>${naira(i.total)}</td></tr>`).join('')}
                <tr class="total"><td colspan="3">Total</td><td>${naira(total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function stockOrdersHtml(rows) {
  if (!rows.length) return emptyStateHtml('No stock-order data loaded', 'Add STOCKS.xlsx to the source folder and rebuild the data.');
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Item</th><th>Available</th><th>Needed</th><th>Cost/Item</th><th>Total Cost</th><th>Paid</th><th>Balance</th></tr></thead>
        <tbody>
          ${rows.map((i) => `<tr><td>${escapeHtml(i.item)}</td><td>${i.availableQty}</td><td>${i.neededQty}</td><td>${naira(i.costPerItem)}</td><td>${naira(i.totalCost)}</td><td>${naira(i.amountPaid)}</td><td>${naira(i.balance)}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function textbookClassShareText(klass, items) {
  const total = items.reduce((sum, i) => sum + (i.sellPrice || 0), 0);
  return [
    KBIS_CONFIG.SCHOOL_NAME,
    `Textbook List — ${klass}`,
    '',
    ...items.map((i) => `${i.textbook} (${i.subject}): ${naira(i.sellPrice)}`),
    '',
    `Total: ${naira(total)}`,
  ].join('\n');
}

function stationeryClassShareText(klass, items) {
  const total = items.reduce((sum, i) => sum + i.total, 0);
  return [
    KBIS_CONFIG.SCHOOL_NAME,
    `Notebooks & Stationery List — ${STOCK_CLASS_LABELS[klass] || klass}`,
    '',
    ...items.map((i) => `${i.item} x${i.qty}: ${naira(i.total)}`),
    '',
    `Total: ${naira(total)}`,
  ].join('\n');
}

function renderStockListOnly() {
  const list = $('#stock-textbook-list');
  if (!list) return;
  list.innerHTML = textbookGroupsHtml(applyStockQuery((STORE.stock && STORE.stock.textbooks) || []));
  $all('[data-class-toggle]', list).forEach((c) => c.querySelector('.class-head').addEventListener('click', () => c.classList.toggle('open')));
}

/* -------------------------------- salary view ------------------------------ */
const MONTH_ORDER = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Flatten every year × category sheet in STORE.salary into one list per staff
// member, sorted chronologically from their first paid month to their last —
// spanning every year and category (Primary/Secondary/Support) they appear in.
function mergedSalaryByStaff() {
  const byStaff = {};
  Object.entries(STORE.salary || {}).forEach(([year, yearData]) => {
    Object.values(yearData.categories || {}).forEach((records) => {
      records.forEach((r) => {
        (byStaff[r.name] ||= []).push({ ...r, year });
      });
    });
  });
  Object.values(byStaff).forEach((months) => {
    months.sort((a, b) => {
      if (a.year !== b.year) return a.year.localeCompare(b.year);
      return MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month);
    });
  });
  return byStaff;
}

// Column definitions for the per-staff salary table, in display order.
// "always" columns show even if empty for this staff; the rest only appear
// if at least one of the staff's months actually has that field.
const SALARY_FIELD_DEFS = [
  { key: 'monthYear', label: 'Month', always: true, type: 'text' },
  { key: 'basicSalary', label: 'Basic Salary', always: true, type: 'naira' },
  { key: 'taxDeduction', label: 'Tax Ded.', type: 'naira' },
  { key: 'monthlyDeduction', label: '10% Ded.', type: 'naira' },
  { key: 'deduction', label: 'Deduction', type: 'naira' },
  { key: 'outstanding', label: 'Outstanding', type: 'naira' },
  { key: 'extraBonus', label: 'Bonus', type: 'naira' },
  { key: 'amountPayable', label: 'Payable', always: true, type: 'naira' },
  { key: 'paid', label: 'Paid', type: 'naira' },
  { key: 'balance', label: 'Balance', type: 'naira' },
  { key: 'bank', label: 'Bank', type: 'text' },
  { key: 'accountNumber', label: 'Acct No.', type: 'text' },
  { key: 'contract', label: 'Contract', type: 'text' },
  { key: 'dateDue', label: 'Date Due', type: 'text' },
];

function salaryTableHtml(months) {
  const cols = SALARY_FIELD_DEFS.filter((f) => f.always || months.some((m) => m[f.key] != null && m[f.key] !== ''));
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${cols.map((f) => `<th>${f.label}</th>`).join('')}</tr></thead>
        <tbody>
          ${months.map((m) => `
            <tr>
              ${cols.map((f) => {
                if (f.key === 'monthYear') return `<td>${escapeHtml(m.month || '—')}${m.year ? ' ' + escapeHtml(m.year) : ''}</td>`;
                const v = m[f.key];
                if (v == null || v === '') return '<td>—</td>';
                return `<td>${f.type === 'naira' ? naira(v) : escapeHtml(String(v))}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function viewSalary() {
  return `
    <div class="fade-in">
      <div class="section-head" style="margin-top:0"><h2>Salary</h2><span class="hint">By staff member</span></div>
      <p style="margin-bottom:16px">Every staff member, with their monthly pay from the first month they were paid through to the most recent.</p>
      <div class="search-wrap" style="margin-bottom:14px">
        ${icon('search')}
        <input class="input" id="salary-search" placeholder="Search staff name…" value="${escapeHtml(salaryQuery)}">
      </div>
      <div id="salary-panel">${salaryPanelHtml()}</div>
    </div>
  `;
}

function salaryPanelHtml() {
  const byStaff = mergedSalaryByStaff();
  const q = salaryQuery.trim().toLowerCase();
  const names = Object.keys(byStaff).sort((a, b) => a.localeCompare(b)).filter((n) => !q || n.toLowerCase().includes(q));

  if (!Object.keys(byStaff).length) return emptyStateHtml('No salary data loaded', 'Add SALARY.xlsx to the source folder and rebuild the data.');
  if (!names.length) return emptyStateHtml('No staff match', 'Try a different search term.');

  return names.map((staffName) => {
    const months = byStaff[staffName];
    return `
      <div class="class-card" data-class-toggle>
        <div class="class-head">
          <span class="name">${escapeHtml(staffName)}</span>
          <span class="gt">${months.length} month${months.length === 1 ? '' : 's'}</span>
          ${icon('chevron', 'chev')}
        </div>
        <div class="class-body">
          ${salaryTableHtml(months)}
        </div>
      </div>
    `;
  }).join('');
}

function renderSalaryListOnly() {
  const panel = $('#salary-panel');
  if (!panel) return;
  panel.innerHTML = salaryPanelHtml();
  $all('[data-class-toggle]', panel).forEach((c) => c.querySelector('.class-head').addEventListener('click', () => c.classList.toggle('open')));
}

function viewSync() {
  const lastSync = localStorage.getItem('kbis_last_sync');
  const genAt = STORE.meta.generatedAt;
  return `
    <div class="fade-in">
      <div class="section-head" style="margin-top:0"><h2>Sync &amp; App</h2></div>
      <div class="card card-pad">
        <div class="sync-row"><span class="k">Connection</span><span class="v" id="sync-conn">—</span></div>
        <div class="sync-row"><span class="k">Last synced on this device</span><span class="v">${lastSync ? new Date(lastSync).toLocaleString() : 'Never'}</span></div>
        <div class="sync-row"><span class="k">Data generated</span><span class="v">${genAt ? new Date(genAt).toLocaleString() : '—'}</span></div>
        <div class="sync-row"><span class="k">Students loaded</span><span class="v">${STORE.students.length}</span></div>
      </div>
      <div style="margin-top:16px;display:flex;flex-direction:column;gap:10px">
        <button class="btn btn-primary btn-block" id="btn-refresh">${icon('cloud')} Check for updates now</button>
        <button class="btn btn-outline btn-block" id="btn-lock">${icon('lock')} Sign out of this device</button>
      </div>
      <div class="section-head"><h2 style="font-size:15px">About</h2></div>
      <div class="card card-pad">
        <p style="margin-bottom:6px"><b style="color:var(--navy)">${KBIS_CONFIG.SCHOOL_NAME}</b> — Student Records &amp; Billing History</p>
        <p style="margin-bottom:0">Installable app · works offline · syncs new data automatically when you're back online. Data updates are published by school admin from the FEE and INVOICE workbooks.</p>
      </div>
    </div>
  `;
}

/* -------------------------------- render dispatcher ------------------------------ */
function render() {
  const view = $('#view');
  if (!view) return;
  const { parts } = currentRoute();
  const route = parts[0] || 'home';
  setActiveNav(route === 'student' ? 'students' : route);

  if (route === 'home') view.innerHTML = viewHome();
  else if (route === 'students') view.innerHTML = viewStudents();
  else if (route === 'student') view.innerHTML = viewStudent(parts[1]);
  else if (route === 'fees') view.innerHTML = viewFees();
  else if (route === 'stock') view.innerHTML = viewStock();
  else if (route === 'salary') view.innerHTML = viewSalary();
  else if (route === 'sync') view.innerHTML = viewSync();
  else view.innerHTML = viewHome();

  wireView(route);
  view.scrollTop = 0; window.scrollTo(0, 0);
}

function wireView(route) {
  $all('[data-nav]').forEach((b) => b.addEventListener('click', () => { location.hash = '#/' + b.dataset.nav; }));

  if (route === 'students') {
    const search = $('#stu-search');
    search && search.addEventListener('input', debounce((e) => { STORE.filters.q = e.target.value; renderListOnly(); }, 180));
    $all('select[data-filter]').forEach((sel) => sel.addEventListener('change', () => {
      STORE.filters[sel.dataset.filter] = sel.value;
      render();
    }));
    $all('[data-student]').forEach((row) => {
      row.addEventListener('click', () => { location.hash = '#/student/' + row.dataset.student; });
      row.addEventListener('keypress', (e) => { if (e.key === 'Enter') location.hash = '#/student/' + row.dataset.student; });
    });
  }

  if (route === 'student') {
    const { parts } = currentRoute();
    const student = STORE.students.find((x) => x.id === parts[1]);

    $all('[data-session]').forEach((tab) => tab.addEventListener('click', () => { openTermSession = tab.dataset.session; render(); }));
    $all('[data-toggle-term]').forEach((h) => h.addEventListener('click', () => {
      h.closest('.term-card').classList.toggle('open');
    }));
    // auto-open the first term with a balance, else the last term
    const cards = $all('.term-card');
    if (cards.length) {
      const due = cards.find((c, i) => { /* peek balance via DOM */ return c.querySelector('.st.due'); });
      (due || cards[cards.length - 1]).classList.add('open');
    }

    $all('[data-share-student]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (student) shareText(`${student.lastName} ${student.firstName} — Account Statement`, studentShareText(student));
    }));
    $all('[data-share-term]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!student) return;
      const activeSess = student.sessions.find((se) => se.session === openTermSession) || student.sessions[student.sessions.length - 1];
      const t = activeSess.terms[Number(b.dataset.shareTerm)];
      if (t) shareText(`${student.lastName} ${student.firstName} — ${t.term}`, termShareText(student, activeSess, t));
    }));
  }

  if (route === 'fees') {
    $all('[data-class-toggle]').forEach((c) => c.querySelector('.class-head').addEventListener('click', () => c.classList.toggle('open')));
    $all('[data-share-class]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const cls = (STORE.invoice.classes || []).find((c) => c.class === b.dataset.shareClass);
      if (cls) shareText(`${classShort(cls.class)} Fee Structure`, classShareText(cls));
    }));
  }

  if (route === 'stock') {
    const tabSelect = $('#stock-tab-select');
    tabSelect && tabSelect.addEventListener('change', () => { stockTab = tabSelect.value; render(); });
    $all('[data-class-toggle]').forEach((c) => c.querySelector('.class-head').addEventListener('click', () => c.classList.toggle('open')));
    const search = $('#stock-search');
    search && search.addEventListener('input', debounce((e) => { stockQuery = e.target.value; renderStockListOnly(); }, 180));
    $all('[data-share-textbooks]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const klass = b.dataset.shareTextbooks;
      const items = textbooksByClass()[klass] || [];
      shareText(`Textbook List — ${klass}`, textbookClassShareText(klass, items));
    }));
    $all('[data-share-stationery]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const klass = b.dataset.shareStationery;
      const items = stationeryByClass()[klass] || [];
      shareText(`Stationery List — ${STOCK_CLASS_LABELS[klass] || klass}`, stationeryClassShareText(klass, items));
    }));
  }

  if (route === 'salary') {
    $all('[data-class-toggle]').forEach((c) => c.querySelector('.class-head').addEventListener('click', () => c.classList.toggle('open')));
    const search = $('#salary-search');
    search && search.addEventListener('input', debounce((e) => { salaryQuery = e.target.value; renderSalaryListOnly(); }, 180));
  }

  if (route === 'sync') {
    setOnlineStatus(navigator.onLine);
    const connEl = $('#sync-conn'); if (connEl) connEl.textContent = navigator.onLine ? 'Online' : 'Offline';
    $('#btn-refresh').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Checking…';
      await Data.refreshInBackground(true);
      render();
    });
    $('#btn-lock').addEventListener('click', () => Auth.lock());
  }
}

function renderListOnly() {
  const list = $('#stu-list');
  if (!list) return;
  const items = filteredStudents();
  list.innerHTML = items.length ? items.map(studentRowHtml).join('') : emptyStateHtml('No students match your filters', 'Try clearing the search or filters above.');
  $all('[data-student]', list).forEach((row) => row.addEventListener('click', () => { location.hash = '#/student/' + row.dataset.student; }));
  const hint = $('.section-head .hint'); if (hint) hint.textContent = `${items.length} of ${STORE.students.length}`;
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* -------------------------------- boot ------------------------------ */
async function boot() {
  renderShell();
  setOnlineStatus(navigator.onLine);
  const hadCache = await Data.loadCachedFirst();
  if (hadCache) render(); else {
    $('#view').innerHTML = `<div style="padding:40px 0;text-align:center;color:var(--ink-faint)">Loading student records…</div>`;
  }
}

function init() {
  if (!Auth.isUnlocked()) { renderGate(); return; }
  boot();
}

document.addEventListener('DOMContentLoaded', init);

/* -------------------------------- service worker ------------------------------ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
