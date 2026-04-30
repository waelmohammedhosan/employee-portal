let currentEmployee = null;

// ============= تسجيل الدخول =============
async function login() {
  const phone = document.getElementById('phone-input').value.trim();
  const password = document.getElementById('password-input').value;
  const errorDiv = document.getElementById('login-error');
  
  if (!phone || !password) {
    errorDiv.textContent = '❌ الرجاء إدخال رقم الهاتف وكلمة المرور';
    errorDiv.style.display = 'block';
    return;
  }
  
  errorDiv.style.display = 'none';
  
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    
    const data = await response.json();
    
    if (data.success) {
      currentEmployee = data.employee;
      await loadDashboard();
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('dashboard-screen').classList.remove('hidden');
    } else {
      errorDiv.textContent = '❌ ' + (data.error || 'فشل تسجيل الدخول');
      errorDiv.style.display = 'block';
    }
  } catch (error) {
    errorDiv.textContent = '❌ خطأ في الاتصال بالخادم';
    errorDiv.style.display = 'block';
  }
}

// ============= تحميل لوحة التحكم =============
async function loadDashboard() {
  if (!currentEmployee) return;
  
  document.getElementById('employee-name').textContent = `👤 ${currentEmployee.name}`;
  document.getElementById('employee-phone').textContent = `📱 ${currentEmployee.phone}`;
  
  // تحميل الإحصائيات
  const statsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/stats`);
  const statsData = await statsRes.json();
  
  if (statsData.success) {
    document.getElementById('total-hours').textContent = statsData.stats.totalHours;
    document.getElementById('total-overtime').textContent = statsData.stats.totalOvertime;
    document.getElementById('total-vacation').textContent = statsData.stats.totalVacation;
    document.getElementById('total-loans').textContent = `${statsData.stats.totalLoans} ₪`;
  }
  
  // تحميل التقارير
  const reportsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/reports`);
  const reportsData = await reportsRes.json();
  
  const tbody = document.getElementById('reports-body');
  if (reportsData.success && reportsData.reports.length > 0) {
    tbody.innerHTML = '';
    for (const report of reportsData.reports) {
      const data = report.data;
      const workHours = calculateHours(data.start_t, data.end_t);
      
      const row = tbody.insertRow();
      row.insertCell(0).textContent = report.date;
      row.insertCell(1).textContent = data.start_t || '';
      row.insertCell(2).textContent = data.end_t || '';
      row.insertCell(3).textContent = data.overtime || '0';
      row.insertCell(4).textContent = data.discount || 'لا يوجد';
      row.insertCell(5).textContent = data.notes || '';
      row.insertCell(6).textContent = workHours;
      row.insertCell(7).textContent = report.loan;
    }
  } else {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">لا توجد سجلات بعد</td></tr>';
  }
}

// ============= حساب ساعات العمل =============
function calculateHours(start_t, end_t) {
  if (!start_t || !end_t) return 0;
  if (start_t.includes('إجازة') || start_t.includes('عطلة')) return 0;
  
  function timeToFloat(t) {
    const isPM = t.includes('PM') || t.includes('مساءً') || t.includes('م');
    let clean = t.replace(/AM|PM|\(ص\)|\(م\)|صباحاً|مساءً/g, '').trim();
    let parts = clean.split(':');
    let h = parseInt(parts[0]) || 0;
    let m = parseInt(parts[1]) || 0;
    if (isPM && h !== 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return h + m / 60;
  }
  
  let hours = timeToFloat(end_t) - timeToFloat(start_t);
  if (hours < 0) hours += 24;
  return Math.round(hours * 10) / 10;
}

// ============= حفظ التقرير كصورة =============
async function exportReportAsImage() {
  const dashboard = document.querySelector('.dashboard-container');
  if (!dashboard) {
    showToast('لا توجد بيانات للحفظ', 'error');
    return;
  }
  
  showToast('جاري إنشاء الصورة...', 'info');
  
  try {
    const canvas = await html2canvas(dashboard, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true
    });
    
    const link = document.createElement('a');
    const date = new Date().toISOString().split('T')[0];
    link.download = `تقرير_${currentEmployee.name}_${date}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    
    showToast('تم حفظ الصورة بنجاح', 'success');
  } catch (error) {
    console.error('Error:', error);
    showToast('حدث خطأ في حفظ الصورة', 'error');
  }
}

// ============= رسائل منبثقة =============
function showToast(message, type) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 12px 20px;
    border-radius: 8px;
    color: white;
    z-index: 1000;
    animation: fadeInOut 3s ease;
    background-color: ${type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3'};
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ============= تسجيل الخروج =============
function logout() {
  currentEmployee = null;
  document.getElementById('dashboard-screen').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('phone-input').value = '';
  document.getElementById('password-input').value = '';
}

// ============= دعم Enter =============
document.getElementById('password-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('phone-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('password-input').focus();
});