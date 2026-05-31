/* ============================================================
 *  app.js — ระบบติดตามการใช้จ่ายงบประมาณค่าสอน (Frontend)
 *  เชื่อมต่อ Google Apps Script Web App (ไฟล์ Code.gs)
 * ============================================================ */

/* ====== 1) ตั้งค่า ====== */
// วาง Web app URL ที่ลงท้ายด้วย /exec ของคุณตรงนี้
const APP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbygmzJSiM7mNOqkrWfpNy2oJDY8JFCUemDYo4CRPtGx0Cyocelqk8NAStjrJHtEMV6xUA/exec';

// สาขา/ภาคเรียน ดึงจากข้อมูลจริงในชีต (รวมค่าที่เคยมีในรายวิชาทั้งหมด)
// ฟอร์มใช้แบบพิมพ์ได้ + รายการแนะนำ จึงเพิ่มค่าใหม่ได้แม้ชีตยังว่าง
function getDepartments() {
  return [...new Set(STATE.courses.map(c => c.department).filter(Boolean))].sort();
}
function getSemesters() {
  return [...new Set(STATE.courses.map(c => c.semester).filter(Boolean))].sort();
}

/* ====== 2) สถานะแอป (ข้อมูลจริงจาก backend) ====== */
const STATE = {
  users: [],
  courses: [],
  categories: [],
  budgets: [],
  expenses: []
};

let currentUser = null;
let sidebarOpen = true;
let currentPage = 'dashboard';
const charts = {}; // เก็บอินสแตนซ์กราฟไว้ทำลายก่อนวาดใหม่

/* ====== 3) ชั้นเชื่อมต่อ API ======
   ส่งทุกคำสั่งแบบ POST + Content-Type: text/plain
   เพื่อเลี่ยง CORS preflight (OPTIONS) ที่ Apps Script ไม่รองรับ */
async function api(action, data) {
  if (!APP_SCRIPT_URL || APP_SCRIPT_URL.indexOf('XXXX') !== -1) {
    throw new Error('ยังไม่ได้ตั้งค่า APP_SCRIPT_URL ในไฟล์ app.js');
  }
  let res;
  try {
    res = await fetch(APP_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, data || {})),
      redirect: 'follow'
    });
  } catch (e) {
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ ตรวจสอบ URL และการเชื่อมต่ออินเทอร์เน็ต');
  }
  let out;
  try {
    out = await res.json();
  } catch (e) {
    throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง (ตรวจการ Deploy เป็น Web app / Anyone)');
  }
  if (!out.success) throw new Error(out.error || 'เกิดข้อผิดพลาด');
  return out.data;
}

function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }
function toBool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 1 || v === '1'; }

// โหลดข้อมูลทั้งหมดเข้า STATE
async function loadAll() {
  const [users, courses, categories, budgets, expenses] = await Promise.all([
    api('getUsers'), api('getCourses'), api('getCategories'), api('getBudgets'), api('getExpenses')
  ]);
  STATE.users      = (users || []);
  STATE.courses    = (courses || []).map(c => ({ ...c, hours: num(c.hours) }));
  STATE.categories = (categories || []).map(c => ({ ...c, active: toBool(c.active) }));
  STATE.budgets    = (budgets || []).map(b => ({ ...b, allocatedAmount: num(b.allocatedAmount), ratePerHour: num(b.ratePerHour) }));
  STATE.expenses   = (expenses || []).map(e => ({ ...e, hours: num(e.hours), amount: num(e.amount) }));
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}

// ครอบการทำงานที่ต้องบันทึก: ยิง API → โหลดใหม่ → วาดหน้าเดิม
async function mutate(fn, successMsg) {
  showLoading(true);
  try {
    await fn();
    await loadAll();
    renderPage(currentPage);
    if (successMsg) showToast(successMsg);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    showLoading(false);
  }
}

function closeArea(id) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = '';
}

/* ====== 4) ฟังก์ชันช่วยจัดรูปแบบ ====== */
function formatNumber(n) {
  return new Intl.NumberFormat('th-TH').format(num(n));
}
function formatCurrency(n) {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(num(n));
}
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const colors = { success: 'bg-green-500', error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-blue-500' };
  const toast = document.createElement('div');
  toast.className = `toast ${colors[type] || colors.success} text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
function getPercentClass(p) {
  if (p >= 100) return 'text-red-600 bg-red-50 border-red-200';
  if (p >= 80)  return 'text-amber-600 bg-amber-50 border-amber-200';
  return 'text-green-600 bg-green-50 border-green-200';
}
function getProgressColor(p) {
  if (p >= 100) return 'bg-red-500';
  if (p >= 80)  return 'bg-amber-500';
  return 'bg-green-500';
}

/* ====== 5) สิทธิ์ตามบทบาท ====== */
function canEdit()        { return ['admin', 'academic', 'secretary'].includes(currentUser?.role); }
function canManageUsers() { return currentUser?.role === 'admin'; }
function canManageBudget(){ return ['admin', 'academic'].includes(currentUser?.role); }

/* ====== 6) การคำนวณ ====== */
function getExpensesForBudget(budgetId) { return STATE.expenses.filter(e => e.budgetId === budgetId); }
function getTotalSpent(budgetId)        { return getExpensesForBudget(budgetId).reduce((s, e) => s + num(e.amount), 0); }
function getCourseExpenses(courseId)    { return STATE.expenses.filter(e => e.courseId === courseId); }
function getCourseBudgets(courseId)     { return STATE.budgets.filter(b => b.courseId === courseId); }
function getCourseTotalAllocated(id)    { return getCourseBudgets(id).reduce((s, b) => s + num(b.allocatedAmount), 0); }
function getCourseTotalSpent(id)        { return getCourseExpenses(id).reduce((s, e) => s + num(e.amount), 0); }
function getDepartmentBudgets(dept) {
  const ids = STATE.courses.filter(c => c.department === dept).map(c => c.id);
  return STATE.budgets.filter(b => ids.includes(b.courseId));
}
function getDepartmentAllocated(dept) { return getDepartmentBudgets(dept).reduce((s, b) => s + num(b.allocatedAmount), 0); }
function getDepartmentSpent(dept) {
  const ids = STATE.courses.filter(c => c.department === dept).map(c => c.id);
  return STATE.expenses.filter(e => ids.includes(e.courseId)).reduce((s, e) => s + num(e.amount), 0);
}
function getRoleName(role) {
  const names = { admin: 'ผู้ดูแลระบบ', academic: 'เจ้าหน้าที่วิชาการ', secretary: 'เลขาสาขา', teacher: 'อาจารย์/รอง ผอ.' };
  return names[role] || role;
}

/* ====== 7) เข้าสู่ระบบ / ออกจากระบบ ====== */
async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  btn.disabled = true;
  btn.textContent = 'กำลังเข้าสู่ระบบ...';
  try {
    const user = await api('login', { username, password });
    currentUser = user;
    showLoading(true);
    await loadAll();
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    document.getElementById('user-info').textContent = `${user.fullName} (${getRoleName(user.role)})`;
    buildNav();
    navigateTo('dashboard');
    showToast(`ยินดีต้อนรับ ${user.fullName}`);
  } catch (e2) {
    err.classList.remove('hidden');
    err.textContent = e2.message;
  } finally {
    showLoading(false);
    btn.disabled = false;
    btn.textContent = 'เข้าสู่ระบบ';
  }
}

function handleLogout() {
  currentUser = null;
  STATE.users = []; STATE.courses = []; STATE.categories = []; STATE.budgets = []; STATE.expenses = [];
  document.getElementById('main-app').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  document.getElementById('login-error').classList.add('hidden');
}

/* ====== 8) เมนู / นำทาง ====== */
function toggleSidebar() {
  sidebarOpen = !sidebarOpen;
  const sidebar = document.getElementById('sidebar');
  if (sidebarOpen) {
    sidebar.classList.remove('-translate-x-full', 'w-0');
    sidebar.classList.add('w-64');
  } else {
    sidebar.classList.add('-translate-x-full', 'w-0');
    sidebar.classList.remove('w-64');
  }
}

function buildNav() {
  const menu = [
    { id: 'dashboard',  icon: 'layout-dashboard', label: 'แดชบอร์ด',        roles: ['admin','academic','secretary','teacher'] },
    { id: 'courses',    icon: 'book-open',        label: 'จัดการรายวิชา',    roles: ['admin','academic','secretary','teacher'] },
    { id: 'budgets',    icon: 'wallet',           label: 'จัดการงบประมาณ',   roles: ['admin','academic','secretary','teacher'] },
    { id: 'expenses',   icon: 'receipt',          label: 'บันทึกการใช้จ่าย', roles: ['admin','academic','secretary','teacher'] },
    { id: 'reports',    icon: 'bar-chart-3',      label: 'รายงาน',           roles: ['admin','academic','secretary','teacher'] },
    { id: 'categories', icon: 'tags',             label: 'หมวดเงิน',         roles: ['admin','academic'] },
    { id: 'users',      icon: 'users',            label: 'จัดการผู้ใช้',     roles: ['admin'] }
  ];
  const nav = document.getElementById('nav-menu');
  nav.innerHTML = menu.filter(m => m.roles.includes(currentUser.role)).map(m => `
    <button onclick="navigateTo('${m.id}')" id="nav-${m.id}" class="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm font-medium transition-colors hover:bg-gray-100 text-gray-700">
      <i data-lucide="${m.icon}" style="width:18px;height:18px"></i>
      <span>${m.label}</span>
    </button>
  `).join('');
  lucide.createIcons();
}

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('#nav-menu button').forEach(btn => {
    btn.classList.remove('bg-secondary/10', 'text-secondary', 'font-semibold');
    btn.classList.add('text-gray-700');
  });
  const active = document.getElementById(`nav-${page}`);
  if (active) {
    active.classList.add('bg-secondary/10', 'text-secondary', 'font-semibold');
    active.classList.remove('text-gray-700');
  }
  renderPage(page);
  if (window.innerWidth < 768 && sidebarOpen) toggleSidebar();
}

function renderPage(page) {
  const main = document.getElementById('main-content');
  const pages = {
    dashboard: renderDashboard,
    courses: renderCourses,
    budgets: renderBudgets,
    expenses: renderExpenses,
    reports: renderReports,
    categories: renderCategories,
    users: renderUsers
  };
  if (pages[page]) pages[page](main);
  lucide.createIcons();
}

/* ====== 9) แดชบอร์ด ====== */
function renderDashboard(container) {
  const totalAllocated = STATE.budgets.reduce((s, b) => s + num(b.allocatedAmount), 0);
  const totalSpent = STATE.expenses.reduce((s, e) => s + num(e.amount), 0);
  const remaining = totalAllocated - totalSpent;
  const percent = totalAllocated > 0 ? (totalSpent / totalAllocated * 100) : 0;

  const warnings = [];
  STATE.courses.forEach(c => {
    const allocated = getCourseTotalAllocated(c.id);
    const spent = getCourseTotalSpent(c.id);
    if (allocated > 0) {
      const p = spent / allocated * 100;
      if (p >= 100) warnings.push({ course: c, percent: p, type: 'danger' });
      else if (p >= 80) warnings.push({ course: c, percent: p, type: 'warning' });
    }
  });

  container.innerHTML = `
    <div class="fade-in">
      <h2 class="text-2xl font-bold text-primary mb-6">แดชบอร์ด</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div class="flex items-center justify-between">
            <div><p class="text-xs text-gray-500 font-medium">งบจัดสรรรวม</p>
              <p class="text-xl font-bold text-primary mt-1">${formatCurrency(totalAllocated)}</p></div>
            <div class="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <i data-lucide="piggy-bank" class="text-secondary" style="width:20px;height:20px"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div class="flex items-center justify-between">
            <div><p class="text-xs text-gray-500 font-medium">ใช้ไปแล้ว</p>
              <p class="text-xl font-bold text-amber-600 mt-1">${formatCurrency(totalSpent)}</p></div>
            <div class="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
              <i data-lucide="trending-up" class="text-amber-500" style="width:20px;height:20px"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div class="flex items-center justify-between">
            <div><p class="text-xs text-gray-500 font-medium">คงเหลือ</p>
              <p class="text-xl font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-600'} mt-1">${formatCurrency(remaining)}</p></div>
            <div class="w-10 h-10 ${remaining < 0 ? 'bg-red-50' : 'bg-green-50'} rounded-lg flex items-center justify-center">
              <i data-lucide="wallet" class="${remaining < 0 ? 'text-red-500' : 'text-green-500'}" style="width:20px;height:20px"></i></div>
          </div>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <div class="flex items-center justify-between">
            <div><p class="text-xs text-gray-500 font-medium">% การใช้งบ</p>
              <p class="text-xl font-bold ${percent >= 100 ? 'text-red-600' : percent >= 80 ? 'text-amber-600' : 'text-green-600'} mt-1">${percent.toFixed(1)}%</p></div>
            <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
              <i data-lucide="percent" class="text-purple-500" style="width:20px;height:20px"></i></div>
          </div>
          <div class="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div class="h-full ${getProgressColor(percent)} rounded-full transition-all" style="width:${Math.min(percent, 100)}%"></div>
          </div>
        </div>
      </div>

      ${warnings.length > 0 ? `
      <div class="mb-6">
        <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <i data-lucide="alert-triangle" class="text-amber-500" style="width:16px;height:16px"></i> รายวิชาที่ต้องระวัง
        </h3>
        <div class="space-y-2">
          ${warnings.map(w => `
            <div class="flex items-center justify-between p-3 rounded-lg border ${w.type === 'danger' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}">
              <div class="flex items-center gap-2">
                <i data-lucide="${w.type === 'danger' ? 'x-circle' : 'alert-circle'}" class="${w.type === 'danger' ? 'text-red-500' : 'text-amber-500'}" style="width:16px;height:16px"></i>
                <span class="text-sm font-medium">${w.course.code} ${w.course.name}</span>
              </div>
              <span class="text-sm font-bold ${w.type === 'danger' ? 'text-red-600' : 'text-amber-600'}">${w.percent.toFixed(1)}%</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 class="text-sm font-semibold text-gray-700 mb-4">งบประมาณแยกตามสาขาวิชา</h3>
          <canvas id="chart-dept" height="200"></canvas>
        </div>
        <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
          <h3 class="text-sm font-semibold text-gray-700 mb-4">สถานะการใช้งบรายวิชา</h3>
          <canvas id="chart-course" height="200"></canvas>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => {
    if (charts.dept) charts.dept.destroy();
    if (charts.course) charts.course.destroy();

    const deptLabels = getDepartments().filter(d => getDepartmentAllocated(d) > 0);
    charts.dept = new Chart(document.getElementById('chart-dept'), {
      type: 'bar',
      data: {
        labels: deptLabels,
        datasets: [
          { label: 'จัดสรร', data: deptLabels.map(d => getDepartmentAllocated(d)), backgroundColor: '#4a90d9' },
          { label: 'ใช้ไป',  data: deptLabels.map(d => getDepartmentSpent(d)),     backgroundColor: '#f39c12' }
        ]
      },
      options: { responsive: true, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } }
    });

    const courses = STATE.courses.filter(c => getCourseTotalAllocated(c.id) > 0);
    const coursePercents = courses.map(c => {
      const a = getCourseTotalAllocated(c.id);
      return a > 0 ? (getCourseTotalSpent(c.id) / a * 100) : 0;
    });
    charts.course = new Chart(document.getElementById('chart-course'), {
      type: 'bar',
      data: {
        labels: courses.map(c => c.code),
        datasets: [{ label: '% ใช้งบ', data: coursePercents,
          backgroundColor: coursePercents.map(p => p >= 100 ? '#e74c3c' : p >= 80 ? '#f39c12' : '#27ae60') }]
      },
      options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 120 } } }
    });
  }, 100);
}

/* ====== 10) รายวิชา ====== */
function renderCourses(container) {
  const isReadOnly = !canEdit();
  container.innerHTML = `
    <div class="fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-2xl font-bold text-primary">จัดการรายวิชา</h2>
        ${!isReadOnly ? `<button onclick="showCourseForm()" class="bg-secondary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <i data-lucide="plus" style="width:16px;height:16px"></i> เพิ่มรายวิชา</button>` : ''}
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b"><tr>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">รหัสวิชา</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">ชื่อวิชา</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">สาขา</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">ภาคเรียน</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">อาจารย์</th>
            <th class="text-center px-4 py-3 font-semibold text-gray-600">ชม.</th>
            ${!isReadOnly ? '<th class="text-center px-4 py-3 font-semibold text-gray-600">จัดการ</th>' : ''}
          </tr></thead>
          <tbody>
            ${STATE.courses.map(c => `
              <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium text-primary">${c.code}</td>
                <td class="px-4 py-3">${c.name}</td>
                <td class="px-4 py-3 hidden md:table-cell text-gray-500">${c.department}</td>
                <td class="px-4 py-3 hidden md:table-cell">${c.semester}</td>
                <td class="px-4 py-3 hidden lg:table-cell text-gray-500">${c.teacher}</td>
                <td class="px-4 py-3 text-center">${c.hours}</td>
                ${!isReadOnly ? `<td class="px-4 py-3 text-center">
                  <button onclick="showCourseForm('${c.id}')" class="text-secondary hover:text-blue-700 p-1"><i data-lucide="edit" style="width:15px;height:15px"></i></button>
                  <button onclick="deleteCourse('${c.id}')" class="text-red-400 hover:text-red-600 p-1 ml-1"><i data-lucide="trash-2" style="width:15px;height:15px"></i></button>
                </td>` : ''}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div id="course-form-area"></div>
    </div>`;
}

function showCourseForm(id) {
  const course = id ? STATE.courses.find(c => c.id === id) : null;
  const teacherOptions = [...new Set(STATE.courses.map(c => c.teacher).filter(Boolean))];
  const deptOptions = getDepartments();
  const semOptions = getSemesters();
  document.getElementById('course-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 fade-in max-h-[90%] overflow-y-auto">
        <h3 class="text-lg font-bold text-primary mb-4">${course ? 'แก้ไขรายวิชา' : 'เพิ่มรายวิชาใหม่'}</h3>
        <form onsubmit="saveCourse(event, '${id || ''}')" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">รหัสวิชา</label>
              <input type="text" id="f-code" value="${course?.code || ''}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">ชั่วโมงสอน</label>
              <input type="number" id="f-hours" value="${course?.hours || ''}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          </div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">ชื่อวิชา</label>
            <input type="text" id="f-name" value="${course?.name || ''}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">สาขาวิชา</label>
              <input list="dept-list" id="f-dept" value="${course?.department || ''}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
              <datalist id="dept-list">${deptOptions.map(d => `<option value="${d}">`).join('')}</datalist></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">ภาคเรียน</label>
              <input list="sem-list" id="f-semester" value="${course?.semester || ''}" placeholder="เช่น 1/2567" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
              <datalist id="sem-list">${semOptions.map(s => `<option value="${s}">`).join('')}</datalist></div>
          </div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">อาจารย์ผู้สอน</label>
            <input list="teacher-list" id="f-teacher" value="${course?.teacher || ''}" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
            <datalist id="teacher-list">${teacherOptions.map(t => `<option value="${t}">`).join('')}</datalist></div>
          <div class="flex gap-3 pt-2">
            <button type="submit" class="flex-1 bg-secondary hover:bg-blue-600 text-white py-2 rounded-lg font-medium transition-colors">บันทึก</button>
            <button type="button" onclick="closeArea('course-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg font-medium transition-colors">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>`;
  lucide.createIcons();
}

function saveCourse(e, id) {
  e.preventDefault();
  const data = {
    code: document.getElementById('f-code').value,
    name: document.getElementById('f-name').value,
    department: document.getElementById('f-dept').value,
    semester: document.getElementById('f-semester').value,
    teacher: document.getElementById('f-teacher').value,
    hours: num(document.getElementById('f-hours').value)
  };
  closeArea('course-form-area');
  mutate(async () => {
    if (id) await api('updateCourse', { data: { ...data, id } });
    else    await api('createCourse', { data });
  }, id ? 'แก้ไขรายวิชาเรียบร้อย' : 'เพิ่มรายวิชาเรียบร้อย');
}

function deleteCourse(id) {
  document.getElementById('course-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full fade-in text-center">
        <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <i data-lucide="alert-triangle" class="text-red-500" style="width:24px;height:24px"></i></div>
        <h3 class="font-bold text-lg mb-2">ยืนยันการลบ?</h3>
        <p class="text-gray-500 text-sm mb-4">การลบรายวิชานี้จะไม่สามารถกู้คืนได้</p>
        <div class="flex gap-3">
          <button onclick="confirmDeleteCourse('${id}')" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium">ลบ</button>
          <button onclick="closeArea('course-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
        </div>
      </div>
    </div>`;
  lucide.createIcons();
}

function confirmDeleteCourse(id) {
  closeArea('course-form-area');
  mutate(async () => { await api('deleteCourse', { id }); }, 'ลบรายวิชาเรียบร้อย');
}

/* ====== 11) งบประมาณ ====== */
function renderBudgets(container) {
  container.innerHTML = `
    <div class="fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-2xl font-bold text-primary">จัดการงบประมาณ</h2>
        ${canManageBudget() ? `<button onclick="showBudgetForm()" class="bg-secondary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <i data-lucide="plus" style="width:16px;height:16px"></i> ตั้งงบประมาณ</button>` : ''}
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        ${STATE.categories.filter(c => c.active).map(cat => {
          const catBudgets = STATE.budgets.filter(b => b.categoryId === cat.id);
          const catAllocated = catBudgets.reduce((s, b) => s + num(b.allocatedAmount), 0);
          const catSpent = STATE.expenses.filter(e => e.categoryId === cat.id).reduce((s, e) => s + num(e.amount), 0);
          const catPercent = catAllocated > 0 ? (catSpent / catAllocated * 100) : 0;
          return `
            <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
              <h4 class="font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <i data-lucide="tag" class="text-secondary" style="width:16px;height:16px"></i> ${cat.name}</h4>
              <div class="grid grid-cols-3 gap-2 text-center text-xs mb-3">
                <div><p class="text-gray-500">จัดสรร</p><p class="font-bold text-primary">${formatNumber(catAllocated)}</p></div>
                <div><p class="text-gray-500">ใช้ไป</p><p class="font-bold text-amber-600">${formatNumber(catSpent)}</p></div>
                <div><p class="text-gray-500">คงเหลือ</p><p class="font-bold ${catAllocated - catSpent < 0 ? 'text-red-600' : 'text-green-600'}">${formatNumber(catAllocated - catSpent)}</p></div>
              </div>
              <div class="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div class="${getProgressColor(catPercent)} h-full rounded-full" style="width:${Math.min(catPercent, 100)}%"></div></div>
              <p class="text-right text-xs mt-1 ${catPercent >= 80 ? 'text-amber-600 font-bold' : 'text-gray-400'}">${catPercent.toFixed(1)}%</p>
            </div>`;
        }).join('')}
      </div>

      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b"><tr>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">รายวิชา</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">หมวดเงิน</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">จัดสรร</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">อัตรา/ชม.</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">ใช้ไป</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">คงเหลือ</th>
            <th class="text-center px-4 py-3 font-semibold text-gray-600">สถานะ</th>
            ${canManageBudget() ? '<th class="text-center px-4 py-3 font-semibold text-gray-600">จัดการ</th>' : ''}
          </tr></thead>
          <tbody>
            ${STATE.budgets.map(b => {
              const course = STATE.courses.find(c => c.id === b.courseId);
              const cat = STATE.categories.find(c => c.id === b.categoryId);
              const spent = getTotalSpent(b.id);
              const remaining = num(b.allocatedAmount) - spent;
              const pct = num(b.allocatedAmount) > 0 ? (spent / num(b.allocatedAmount) * 100) : 0;
              return `
                <tr class="border-b hover:bg-gray-50">
                  <td class="px-4 py-3 font-medium">${course?.code || '-'} ${course?.name || ''}</td>
                  <td class="px-4 py-3 hidden md:table-cell text-gray-500">${cat?.name || '-'}</td>
                  <td class="px-4 py-3 text-right">${formatNumber(b.allocatedAmount)}</td>
                  <td class="px-4 py-3 text-right">${formatNumber(b.ratePerHour)}</td>
                  <td class="px-4 py-3 text-right text-amber-600 font-medium">${formatNumber(spent)}</td>
                  <td class="px-4 py-3 text-right ${remaining < 0 ? 'text-red-600' : 'text-green-600'} font-medium">${formatNumber(remaining)}</td>
                  <td class="px-4 py-3 text-center"><span class="px-2 py-1 rounded-full text-xs font-semibold border ${getPercentClass(pct)}">${pct.toFixed(0)}%</span></td>
                  ${canManageBudget() ? `<td class="px-4 py-3 text-center">
                    <button onclick="deleteBudget('${b.id}')" class="text-red-400 hover:text-red-600 p-1"><i data-lucide="trash-2" style="width:15px;height:15px"></i></button>
                  </td>` : ''}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div id="budget-form-area"></div>
    </div>`;
}

function showBudgetForm() {
  document.getElementById('budget-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 fade-in">
        <h3 class="text-lg font-bold text-primary mb-4">ตั้งงบประมาณใหม่</h3>
        <form onsubmit="saveBudget(event)" class="space-y-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">รายวิชา</label>
            <select id="fb-course" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
              <option value="">-- เลือกรายวิชา --</option>
              ${STATE.courses.map(c => `<option value="${c.id}">${c.code} - ${c.name} (${c.semester})</option>`).join('')}
            </select></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">หมวดเงิน</label>
            <select id="fb-cat" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
              ${STATE.categories.filter(c => c.active).map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">งบจัดสรร (บาท)</label>
              <input type="number" id="fb-amount" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">อัตรา/ชั่วโมง (บาท)</label>
              <input type="number" id="fb-rate" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" class="flex-1 bg-secondary hover:bg-blue-600 text-white py-2 rounded-lg font-medium transition-colors">บันทึก</button>
            <button type="button" onclick="closeArea('budget-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg font-medium transition-colors">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>`;
  lucide.createIcons();
}

function saveBudget(e) {
  e.preventDefault();
  const courseId = document.getElementById('fb-course').value;
  const course = STATE.courses.find(c => c.id === courseId);
  const data = {
    courseId,
    categoryId: document.getElementById('fb-cat').value,
    allocatedAmount: num(document.getElementById('fb-amount').value),
    ratePerHour: num(document.getElementById('fb-rate').value),
    semester: course?.semester || ''
  };
  closeArea('budget-form-area');
  mutate(async () => { await api('createBudget', { data }); }, 'ตั้งงบประมาณเรียบร้อย');
}

function deleteBudget(id) {
  document.getElementById('budget-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full fade-in text-center">
        <h3 class="font-bold text-lg mb-2">ยืนยันลบงบประมาณ?</h3>
        <p class="text-gray-500 text-sm mb-4">รายการใช้จ่ายที่ผูกกับงบนี้จะยังคงอยู่</p>
        <div class="flex gap-3 mt-2">
          <button onclick="confirmDeleteBudget('${id}')" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium">ลบ</button>
          <button onclick="closeArea('budget-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
        </div>
      </div>
    </div>`;
}

function confirmDeleteBudget(id) {
  closeArea('budget-form-area');
  mutate(async () => { await api('deleteBudget', { id }); }, 'ลบงบประมาณเรียบร้อย');
}

/* ====== 12) การใช้จ่าย ====== */
function renderExpenses(container) {
  const isReadOnly = !canEdit();
  const sorted = STATE.expenses.slice().sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  container.innerHTML = `
    <div class="fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-2xl font-bold text-primary">บันทึกการใช้จ่าย</h2>
        ${!isReadOnly ? `<button onclick="showExpenseForm()" class="bg-secondary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <i data-lucide="plus" style="width:16px;height:16px"></i> บันทึกรายการใหม่</button>` : ''}
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b"><tr>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">วันที่</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">รายวิชา</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">หมวดเงิน</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">ชม.</th>
            <th class="text-right px-4 py-3 font-semibold text-gray-600">จำนวนเงิน</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">หมายเหตุ</th>
            ${!isReadOnly ? '<th class="text-center px-4 py-3 font-semibold text-gray-600">จัดการ</th>' : ''}
          </tr></thead>
          <tbody>
            ${sorted.map(exp => {
              const course = STATE.courses.find(c => c.id === exp.courseId);
              const cat = STATE.categories.find(c => c.id === exp.categoryId);
              return `
                <tr class="border-b hover:bg-gray-50">
                  <td class="px-4 py-3 text-gray-500">${exp.date}</td>
                  <td class="px-4 py-3 font-medium">${course?.code || '-'} ${course?.name || ''}</td>
                  <td class="px-4 py-3 hidden md:table-cell text-gray-500">${cat?.name || '-'}</td>
                  <td class="px-4 py-3 text-right">${exp.hours}</td>
                  <td class="px-4 py-3 text-right font-medium text-amber-600">${formatNumber(exp.amount)}</td>
                  <td class="px-4 py-3 hidden lg:table-cell text-gray-500 max-w-[200px] truncate">${exp.note || '-'}</td>
                  ${!isReadOnly ? `<td class="px-4 py-3 text-center">
                    <button onclick="deleteExpense('${exp.id}')" class="text-red-400 hover:text-red-600 p-1"><i data-lucide="trash-2" style="width:15px;height:15px"></i></button>
                  </td>` : ''}
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
      <div id="expense-form-area"></div>
    </div>`;
}

function showExpenseForm() {
  document.getElementById('expense-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 fade-in max-h-[90%] overflow-y-auto">
        <h3 class="text-lg font-bold text-primary mb-4">บันทึกการใช้จ่าย</h3>
        <form onsubmit="saveExpense(event)" class="space-y-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">รายวิชา</label>
            <select id="fe-course" onchange="updateExpenseInfo()" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
              <option value="">-- เลือกรายวิชา --</option>
              ${STATE.courses.map(c => `<option value="${c.id}">${c.code} - ${c.name}</option>`).join('')}
            </select></div>
          <div id="fe-budget-select"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">วันที่</label>
            <input type="text" id="fe-date" placeholder="2567-MM-DD" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">จำนวนชั่วโมงสอน</label>
            <input type="number" id="fe-hours" onchange="calcExpenseAmount()" oninput="calcExpenseAmount()" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          <div id="fe-calc-info" class="p-3 bg-gray-50 rounded-lg text-sm hidden"></div>
          <div id="fe-warning" class="hidden"></div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
            <input type="text" id="fe-note" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none"></div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="fe-submit" class="flex-1 bg-secondary hover:bg-blue-600 text-white py-2 rounded-lg font-medium transition-colors">บันทึก</button>
            <button type="button" onclick="closeArea('expense-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg font-medium transition-colors">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>`;
  lucide.createIcons();
}

function updateExpenseInfo() {
  const courseId = document.getElementById('fe-course').value;
  const budgets = STATE.budgets.filter(b => b.courseId === courseId);
  const sel = document.getElementById('fe-budget-select');
  if (budgets.length > 0) {
    sel.innerHTML = `
      <label class="block text-sm font-medium text-gray-700 mb-1">งบประมาณ (หมวดเงิน)</label>
      <select id="fe-budget" onchange="calcExpenseAmount()" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
        ${budgets.map(b => {
          const cat = STATE.categories.find(c => c.id === b.categoryId);
          return `<option value="${b.id}">${cat?.name || '-'} (อัตรา ${formatNumber(b.ratePerHour)} บ./ชม. | จัดสรร ${formatNumber(b.allocatedAmount)} บ.)</option>`;
        }).join('')}
      </select>`;
  } else {
    sel.innerHTML = '<p class="text-sm text-red-500">ไม่พบงบประมาณสำหรับรายวิชานี้ กรุณาตั้งงบประมาณก่อน</p>';
  }
  calcExpenseAmount();
}

function calcExpenseAmount() {
  const budgetId = document.getElementById('fe-budget')?.value;
  const hours = num(document.getElementById('fe-hours')?.value);
  const budget = STATE.budgets.find(b => b.id === budgetId);
  const info = document.getElementById('fe-calc-info');
  const warning = document.getElementById('fe-warning');

  if (budget && hours > 0) {
    const amount = hours * num(budget.ratePerHour);
    const currentSpent = getTotalSpent(budget.id);
    const afterSpent = currentSpent + amount;
    const remaining = num(budget.allocatedAmount) - afterSpent;
    const pct = num(budget.allocatedAmount) > 0 ? (afterSpent / num(budget.allocatedAmount) * 100) : 0;

    info.classList.remove('hidden');
    info.innerHTML = `
      <div class="space-y-1">
        <p><span class="text-gray-500">คำนวณ:</span> <span class="font-bold">${hours} ชม. × ${formatNumber(budget.ratePerHour)} บ. = ${formatNumber(amount)} บาท</span></p>
        <p><span class="text-gray-500">ใช้ไปก่อนหน้า:</span> ${formatNumber(currentSpent)} บาท</p>
        <p><span class="text-gray-500">หลังบันทึก:</span> <span class="font-bold ${pct >= 80 ? 'text-amber-600' : ''}">${formatNumber(afterSpent)} / ${formatNumber(budget.allocatedAmount)} บาท (${pct.toFixed(1)}%)</span></p>
        <p><span class="text-gray-500">คงเหลือ:</span> <span class="font-bold ${remaining < 0 ? 'text-red-600' : 'text-green-600'}">${formatNumber(remaining)} บาท</span></p>
      </div>`;

    if (pct >= 100) {
      warning.classList.remove('hidden');
      warning.innerHTML = `<div class="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm font-medium flex items-center gap-2">
        <i data-lucide="alert-circle" style="width:16px;height:16px"></i> ⚠️ เกินงบประมาณ! คงเหลือติดลบ ${formatNumber(Math.abs(remaining))} บาท</div>`;
      lucide.createIcons();
    } else if (pct >= 80) {
      warning.classList.remove('hidden');
      warning.innerHTML = `<div class="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm font-medium flex items-center gap-2">
        <i data-lucide="alert-triangle" style="width:16px;height:16px"></i> ใกล้เต็มงบ (${pct.toFixed(1)}%) กรุณาตรวจสอบก่อนบันทึก</div>`;
      lucide.createIcons();
    } else {
      warning.classList.add('hidden');
    }
  } else {
    info.classList.add('hidden');
    warning.classList.add('hidden');
  }
}

function saveExpense(e) {
  e.preventDefault();
  const budgetId = document.getElementById('fe-budget')?.value;
  const budget = STATE.budgets.find(b => b.id === budgetId);
  if (!budget) { showToast('กรุณาเลือกงบประมาณ', 'error'); return; }
  const hours = num(document.getElementById('fe-hours').value);
  const data = {
    courseId: budget.courseId,
    categoryId: budget.categoryId,
    budgetId: budget.id,
    hours,
    amount: hours * num(budget.ratePerHour),
    date: document.getElementById('fe-date').value,
    note: document.getElementById('fe-note').value,
    createdBy: currentUser?.username || ''
  };
  closeArea('expense-form-area');
  mutate(async () => { await api('createExpense', { data }); }, 'บันทึกการใช้จ่ายเรียบร้อย');
}

function deleteExpense(id) {
  document.getElementById('expense-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full fade-in text-center">
        <h3 class="font-bold text-lg mb-2">ยืนยันการลบ?</h3>
        <div class="flex gap-3 mt-4">
          <button onclick="confirmDeleteExpense('${id}')" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium">ลบ</button>
          <button onclick="closeArea('expense-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
        </div>
      </div>
    </div>`;
}

function confirmDeleteExpense(id) {
  closeArea('expense-form-area');
  mutate(async () => { await api('deleteExpense', { id }); }, 'ลบรายการเรียบร้อย');
}

/* ====== 13) รายงาน ====== */
function renderReports(container) {
  container.innerHTML = `
    <div class="fade-in">
      <h2 class="text-2xl font-bold text-primary mb-6">รายงาน</h2>
      <div class="bg-white rounded-xl p-5 shadow-sm border border-gray-100 mb-6">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div><label class="block text-xs font-medium text-gray-500 mb-1">ภาคเรียน</label>
            <select id="rpt-semester" onchange="filterReport()" class="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">ทั้งหมด</option>${getSemesters().map(s => `<option>${s}</option>`).join('')}</select></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">สาขาวิชา</label>
            <select id="rpt-dept" onchange="filterReport()" class="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">ทั้งหมด</option>${getDepartments().map(d => `<option>${d}</option>`).join('')}</select></div>
          <div><label class="block text-xs font-medium text-gray-500 mb-1">หมวดเงิน</label>
            <select id="rpt-cat" onchange="filterReport()" class="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="">ทั้งหมด</option>${STATE.categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
          <div class="flex items-end gap-2">
            <button onclick="exportCSV()" class="flex-1 bg-green-600 hover:bg-green-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition-colors">
              <i data-lucide="download" style="width:14px;height:14px"></i> CSV</button>
            <button onclick="window.print()" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-1 transition-colors">
              <i data-lucide="printer" style="width:14px;height:14px"></i> พิมพ์</button>
          </div>
        </div>
      </div>
      <div id="report-table"></div>
    </div>`;
  filterReport();
}

function filterReport() {
  const semester = document.getElementById('rpt-semester')?.value || '';
  const dept = document.getElementById('rpt-dept')?.value || '';
  const catId = document.getElementById('rpt-cat')?.value || '';

  let filtered = [...STATE.expenses];
  if (semester) {
    const ids = STATE.courses.filter(c => c.semester === semester).map(c => c.id);
    filtered = filtered.filter(e => ids.includes(e.courseId));
  }
  if (dept) {
    const ids = STATE.courses.filter(c => c.department === dept).map(c => c.id);
    filtered = filtered.filter(e => ids.includes(e.courseId));
  }
  if (catId) filtered = filtered.filter(e => e.categoryId === catId);

  const totalAmount = filtered.reduce((s, e) => s + num(e.amount), 0);
  const totalHours = filtered.reduce((s, e) => s + num(e.hours), 0);

  document.getElementById('report-table').innerHTML = `
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
      <div class="p-4 border-b bg-gray-50 flex items-center justify-between">
        <span class="text-sm text-gray-500">พบ ${filtered.length} รายการ</span>
        <span class="text-sm font-bold">รวม: ${formatNumber(totalHours)} ชม. | ${formatCurrency(totalAmount)}</span>
      </div>
      <table class="w-full text-sm" id="report-data-table">
        <thead class="bg-gray-50 border-b"><tr>
          <th class="text-left px-4 py-3 font-semibold text-gray-600">วันที่</th>
          <th class="text-left px-4 py-3 font-semibold text-gray-600">รายวิชา</th>
          <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">สาขา</th>
          <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">หมวดเงิน</th>
          <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden lg:table-cell">อาจารย์</th>
          <th class="text-right px-4 py-3 font-semibold text-gray-600">ชม.</th>
          <th class="text-right px-4 py-3 font-semibold text-gray-600">จำนวนเงิน</th>
        </tr></thead>
        <tbody>
          ${filtered.map(exp => {
            const course = STATE.courses.find(c => c.id === exp.courseId);
            const cat = STATE.categories.find(c => c.id === exp.categoryId);
            return `
              <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3">${exp.date}</td>
                <td class="px-4 py-3 font-medium">${course?.code || ''} ${course?.name || ''}</td>
                <td class="px-4 py-3 hidden md:table-cell text-gray-500">${course?.department || ''}</td>
                <td class="px-4 py-3 hidden md:table-cell text-gray-500">${cat?.name || ''}</td>
                <td class="px-4 py-3 hidden lg:table-cell text-gray-500">${course?.teacher || ''}</td>
                <td class="px-4 py-3 text-right">${exp.hours}</td>
                <td class="px-4 py-3 text-right font-medium">${formatNumber(exp.amount)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  lucide.createIcons();
}

function exportCSV() {
  const rows = [['วันที่', 'รหัสวิชา', 'ชื่อวิชา', 'สาขา', 'หมวดเงิน', 'อาจารย์', 'ชั่วโมง', 'จำนวนเงิน', 'หมายเหตุ']];
  STATE.expenses.forEach(exp => {
    const course = STATE.courses.find(c => c.id === exp.courseId);
    const cat = STATE.categories.find(c => c.id === exp.categoryId);
    rows.push([exp.date, course?.code || '', course?.name || '', course?.department || '', cat?.name || '', course?.teacher || '', exp.hours, exp.amount, exp.note || '']);
  });
  const csv = '\uFEFF' + rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'รายงานค่าสอน.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('ดาวน์โหลด CSV เรียบร้อย');
}

/* ====== 14) หมวดเงิน ====== */
function renderCategories(container) {
  container.innerHTML = `
    <div class="fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-2xl font-bold text-primary">หมวดเงิน</h2>
        <button onclick="showCategoryForm()" class="bg-secondary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <i data-lucide="plus" style="width:16px;height:16px"></i> เพิ่มหมวดเงิน</button>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100">
        ${STATE.categories.map(c => `
          <div class="flex items-center justify-between px-5 py-4 border-b last:border-b-0">
            <div class="flex items-center gap-3">
              <div class="w-3 h-3 rounded-full ${c.active ? 'bg-green-500' : 'bg-gray-300'}"></div>
              <span class="font-medium">${c.name}</span>
              <span class="text-xs px-2 py-0.5 rounded-full ${c.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}">${c.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
            </div>
            <button onclick="toggleCategory('${c.id}')" class="text-sm px-3 py-1 rounded-lg ${c.active ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-green-50 text-green-600 hover:bg-green-100'} transition-colors">
              ${c.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
          </div>`).join('')}
      </div>
      <div id="cat-form-area"></div>
    </div>`;
}

function showCategoryForm() {
  document.getElementById('cat-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 fade-in">
        <h3 class="text-lg font-bold text-primary mb-4">เพิ่มหมวดเงิน</h3>
        <form onsubmit="saveCategory(event)" class="space-y-4">
          <div><label class="block text-sm font-medium text-gray-700 mb-1">ชื่อหมวดเงิน</label>
            <input type="text" id="fc-name" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          <div class="flex gap-3">
            <button type="submit" class="flex-1 bg-secondary hover:bg-blue-600 text-white py-2 rounded-lg font-medium">บันทึก</button>
            <button type="button" onclick="closeArea('cat-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>`;
}

function saveCategory(e) {
  e.preventDefault();
  const name = document.getElementById('fc-name').value;
  closeArea('cat-form-area');
  mutate(async () => { await api('createCategory', { data: { name } }); }, 'เพิ่มหมวดเงินเรียบร้อย');
}

function toggleCategory(id) {
  const cat = STATE.categories.find(c => c.id === id);
  if (!cat) return;
  mutate(async () => { await api('updateCategory', { data: { id, active: !cat.active } }); });
}

/* ====== 15) จัดการผู้ใช้ ====== */
function renderUsers(container) {
  container.innerHTML = `
    <div class="fade-in">
      <div class="flex flex-wrap items-center justify-between gap-4 mb-6">
        <h2 class="text-2xl font-bold text-primary">จัดการผู้ใช้</h2>
        <button onclick="showUserForm()" class="bg-secondary hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors">
          <i data-lucide="plus" style="width:16px;height:16px"></i> เพิ่มผู้ใช้</button>
      </div>
      <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 border-b"><tr>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">ชื่อผู้ใช้</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">ชื่อ-สกุล</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600">บทบาท</th>
            <th class="text-left px-4 py-3 font-semibold text-gray-600 hidden md:table-cell">สาขา</th>
            <th class="text-center px-4 py-3 font-semibold text-gray-600">จัดการ</th>
          </tr></thead>
          <tbody>
            ${STATE.users.map(u => `
              <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${u.username}</td>
                <td class="px-4 py-3">${u.fullName}</td>
                <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">${getRoleName(u.role)}</span></td>
                <td class="px-4 py-3 hidden md:table-cell text-gray-500">${u.department}</td>
                <td class="px-4 py-3 text-center">
                  <button onclick="resetPassword('${u.id}')" class="text-amber-500 hover:text-amber-700 p-1" title="รีเซ็ตรหัสผ่าน"><i data-lucide="key" style="width:15px;height:15px"></i></button>
                  ${u.username !== 'admin' ? `<button onclick="deleteUser('${u.id}')" class="text-red-400 hover:text-red-600 p-1 ml-1"><i data-lucide="trash-2" style="width:15px;height:15px"></i></button>` : ''}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div id="user-form-area"></div>
    </div>`;
}

function showUserForm() {
  document.getElementById('user-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 fade-in">
        <h3 class="text-lg font-bold text-primary mb-4">เพิ่มผู้ใช้ใหม่</h3>
        <form onsubmit="saveUser(event)" class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้ใช้</label>
              <input type="text" id="fu-username" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">รหัสผ่าน</label>
              <input type="text" id="fu-password" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          </div>
          <div><label class="block text-sm font-medium text-gray-700 mb-1">ชื่อ-สกุล</label>
            <input type="text" id="fu-fullname" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="block text-sm font-medium text-gray-700 mb-1">บทบาท</label>
              <select id="fu-role" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none" required>
                <option value="admin">ผู้ดูแลระบบ</option>
                <option value="academic">เจ้าหน้าที่วิชาการ</option>
                <option value="secretary">เลขาสาขา</option>
                <option value="teacher">อาจารย์/รอง ผอ.</option>
              </select></div>
            <div><label class="block text-sm font-medium text-gray-700 mb-1">สาขา</label>
              <input list="udept-list" id="fu-dept" value="ทั้งหมด" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-secondary outline-none">
              <datalist id="udept-list"><option value="ทั้งหมด">${getDepartments().map(d => `<option value="${d}">`).join('')}</datalist></div>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" class="flex-1 bg-secondary hover:bg-blue-600 text-white py-2 rounded-lg font-medium">บันทึก</button>
            <button type="button" onclick="closeArea('user-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
          </div>
        </form>
      </div>
    </div>`;
}

function saveUser(e) {
  e.preventDefault();
  const data = {
    username: document.getElementById('fu-username').value.trim(),
    password: document.getElementById('fu-password').value,
    fullName: document.getElementById('fu-fullname').value,
    role: document.getElementById('fu-role').value,
    department: document.getElementById('fu-dept').value
  };
  closeArea('user-form-area');
  mutate(async () => { await api('createUser', { data }); }, 'เพิ่มผู้ใช้เรียบร้อย');
}

function resetPassword(id) {
  const user = STATE.users.find(u => u.id === id);
  if (!user) return;
  mutate(async () => { await api('resetPassword', { id, newPassword: '123456' }); },
    `รีเซ็ตรหัสผ่านของ ${user.username} เป็น "123456" เรียบร้อย`);
}

function deleteUser(id) {
  document.getElementById('user-form-area').innerHTML = `
    <div class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full fade-in text-center">
        <h3 class="font-bold text-lg mb-2">ยืนยันลบผู้ใช้?</h3>
        <div class="flex gap-3 mt-4">
          <button onclick="confirmDeleteUser('${id}')" class="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded-lg font-medium">ลบ</button>
          <button onclick="closeArea('user-form-area')" class="flex-1 bg-gray-100 hover:bg-gray-200 py-2 rounded-lg font-medium">ยกเลิก</button>
        </div>
      </div>
    </div>`;
}

function confirmDeleteUser(id) {
  closeArea('user-form-area');
  mutate(async () => { await api('deleteUser', { id }); }, 'ลบผู้ใช้เรียบร้อย');
}

/* ====== 16) เริ่มต้นทำงาน ====== */
document.addEventListener('DOMContentLoaded', () => {
  lucide.createIcons();
  if (window.innerWidth < 768) {
    sidebarOpen = false;
    const sb = document.getElementById('sidebar');
    sb.classList.add('-translate-x-full', 'w-0');
    sb.classList.remove('w-64');
  }
});