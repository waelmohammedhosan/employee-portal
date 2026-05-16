let currentEmployee = null;

// ============= تسجيل الدخول =============
async function login() {
  const phone = document.getElementById('phone-input').value.trim();
  const password = document.getElementById('password-input').value;
  const errorDiv = document.getElementById('login-error');
  
  if (!phone || !password) {
    errorDiv.textContent = ' الرجاء إدخال رقم الهاتف وكلمة المرور';
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
  try {
    const statsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/stats`);
    const statsData = await statsRes.json();
    
    if (statsData.success) {
      document.getElementById('total-hours').textContent = statsData.stats.totalHours || 0;
      document.getElementById('total-overtime').textContent = statsData.stats.totalOvertime || 0;
      document.getElementById('total-vacation').textContent = statsData.stats.totalVacation || 0;
      document.getElementById('total-loans').textContent = `${statsData.stats.totalLoans || 0} ₪`;
    }
  } catch (error) {
    console.error('Error loading stats:', error);
  }
  
  // تحميل التقارير (سجل الدوام)
  try {
    const reportsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/reports`);
    const reportsData = await reportsRes.json();
    
    const tbody = document.getElementById('reports-body');
    if (!tbody) return;
    
    if (reportsData.success && reportsData.reports && reportsData.reports.length > 0) {
      tbody.innerHTML = '';
      for (const report of reportsData.reports) {
        const data = report.data;
        const workHours = calculateHours(data.start_t, data.end_t);
        
        const row = tbody.insertRow();
        row.insertCell(0).textContent = report.date || '-';
        row.insertCell(1).textContent = data.start_t || '-';
        row.insertCell(2).textContent = data.end_t || '-';
        row.insertCell(3).textContent = data.overtime || '0';
        row.insertCell(4).textContent = data.discount || 'لا يوجد';
        row.insertCell(5).textContent = data.notes || '-';
        row.insertCell(6).textContent = workHours;
        row.insertCell(7).textContent = report.loan || '0';
      }
    } else {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">لا توجد سجلات دوام بعد</td></tr>';
    }
  } catch (error) {
    console.error('Error loading reports:', error);
    const tbody = document.getElementById('reports-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:red;">خطأ في تحميل البيانات</td></tr>';
    }
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

// ============= حفظ التقرير كصورة PNG (بدقة عالية) =============
async function exportReportAsImage() {
  const dashboard = document.querySelector('.dashboard-container');
  if (!dashboard) {
    showToast('لا توجد بيانات للحفظ', 'error');
    return;
  }
  
  showToast('جاري إنشاء الصورة...', 'info');
  
  try {
    // استخدام دقة عالية (3x)
    const canvas = await html2canvas(dashboard, {
      scale: 3,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      windowWidth: dashboard.scrollWidth,
      windowHeight: dashboard.scrollHeight,
      onclone: (clonedDoc, element) => {
        // تحسين الخطوط في الصورة
        const style = clonedDoc.createElement('style');
        style.textContent = `
          * { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif !important; }
          body { background: white !important; }
        `;
        clonedDoc.head.appendChild(style);
      }
    });
    
    // تحويل canvas إلى رابط تحميل
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
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
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
// ============= نظام تحديث البيانات التلقائي =============

let autoRefreshInterval = null;
let isAutoRefreshEnabled = true;

// بدء التحديث التلقائي (كل 30 ثانية)
function startAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    autoRefreshInterval = setInterval(async () => {
        if (isAutoRefreshEnabled && currentEmployee) {
            console.log('🔄 جاري تحديث البيانات تلقائياً...');
            await refreshDashboardData();
        }
    }, 30000); // 30 ثانية
}

// إيقاف التحديث التلقائي
function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// تحديث بيانات لوحة التحكم فقط (بدون إعادة تحميل الصفحة)
async function refreshDashboardData() {
    if (!currentEmployee) return;
    
    try {
        // تحديث الإحصائيات
        const statsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/stats?t=${Date.now()}`);
        const statsData = await statsRes.json();
        
        if (statsData.success) {
            document.getElementById('total-hours').textContent = statsData.stats.totalHours || 0;
            document.getElementById('total-overtime').textContent = statsData.stats.totalOvertime || 0;
            document.getElementById('total-vacation').textContent = statsData.stats.totalVacation || 0;
            document.getElementById('total-loans').textContent = `${statsData.stats.totalLoans || 0} ₪`;
        }
        
        // تحديث جدول التقارير
        const reportsRes = await fetch(`/api/employee/${encodeURIComponent(currentEmployee.name)}/reports?t=${Date.now()}`);
        const reportsData = await reportsRes.json();
        
        const tbody = document.getElementById('reports-body');
        if (reportsData.success && reportsData.reports && reportsData.reports.length > 0) {
            tbody.innerHTML = '';
            for (const report of reportsData.reports) {
                const data = report.data;
                const workHours = calculateHours(data.start_t, data.end_t);
                
                const row = tbody.insertRow();
                row.insertCell(0).textContent = report.date || '-';
                row.insertCell(1).textContent = data.start_t || '-';
                row.insertCell(2).textContent = data.end_t || '-';
                row.insertCell(3).textContent = data.overtime || '0';
                row.insertCell(4).textContent = data.discount || 'لا يوجد';
                row.insertCell(5).textContent = data.notes || '-';
                row.insertCell(6).textContent = workHours;
                row.insertCell(7).textContent = report.loan || '0';
            }
        }
        
        showToast('🔄 تم تحديث البيانات', 'success');
        
    } catch (error) {
        console.error('خطأ في التحديث التلقائي:', error);
    }
}

// تحديث يدوي (زر التحديث)
async function manualRefresh() {
    showToast('جاري تحديث البيانات...', 'info');
    await refreshDashboardData();
}

// تفعيل/تعطيل التحديث التلقائي
function toggleAutoRefresh() {
    isAutoRefreshEnabled = !isAutoRefreshEnabled;
    const btn = document.getElementById('toggle-auto-refresh');
    if (btn) {
        if (isAutoRefreshEnabled) {
            btn.textContent = '⏸️ إيقاف التحديث التلقائي';
            btn.style.background = '#ff9800';
            startAutoRefresh();
            showToast('✅ تم تفعيل التحديث التلقائي (كل 30 ثانية)', 'success');
        } else {
            btn.textContent = '▶️ تشغيل التحديث التلقائي';
            btn.style.background = '#4caf50';
            showToast('⏸️ تم إيقاف التحديث التلقائي', 'info');
        }
    }
}

// إضافة زر التحديث إلى واجهة المستخدم
function addRefreshButtons() {
    const dashboardHeader = document.querySelector('.dashboard-header');
    if (dashboardHeader && !document.getElementById('refresh-buttons')) {
        const buttonsDiv = document.createElement('div');
        buttonsDiv.id = 'refresh-buttons';
        buttonsDiv.style.display = 'flex';
        buttonsDiv.style.gap = '10px';
        buttonsDiv.innerHTML = `
            <button class="btn-refresh" onclick="manualRefresh()" style="background: #2196f3; color: white; padding: 8px 15px; border: none; border-radius: 8px; cursor: pointer;">
                <i class="fas fa-sync-alt"></i> تحديث الآن
            </button>
            <button id="toggle-auto-refresh" class="btn-auto-refresh" onclick="toggleAutoRefresh()" style="background: #ff9800; color: white; padding: 8px 15px; border: none; border-radius: 8px; cursor: pointer;">
                ⏸️ إيقاف التحديث التلقائي
            </button>
        `;
        
        // إضافة الأزرار بجانب أزرار الخروج
        const existingButtons = dashboardHeader.querySelector('div:last-child');
        if (existingButtons) {
            existingButtons.appendChild(buttonsDiv);
        } else {
            dashboardHeader.appendChild(buttonsDiv);
        }
    }
}

// تعديل دالة login لبدء التحديث التلقائي بعد تسجيل الدخول
const originalLogin = login;
window.login = async function() {
    await originalLogin();
    if (currentEmployee) {
        startAutoRefresh();
        addRefreshButtons();
    }
}

// تعديل دالة logout لإيقاف التحديث التلقائي
const originalLogout = logout;
window.logout = function() {
    stopAutoRefresh();
    originalLogout();
}

// إضافة مؤقت يعرض آخر تحديث
let lastUpdateTime = null;

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('ar-EG');
    let timeDisplay = document.getElementById('last-update-time');
    
    if (!timeDisplay) {
        const statsGrid = document.querySelector('.stats-grid');
        if (statsGrid) {
            const timeDiv = document.createElement('div');
            timeDiv.className = 'stat-card';
            timeDiv.id = 'last-update-time-card';
            timeDiv.style.background = 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)';
            timeDiv.innerHTML = `
                <div class="stat-icon">🕐</div>
                <div class="stat-value" id="last-update-time" style="font-size: 18px;">${timeString}</div>
                <div class="stat-label">آخر تحديث</div>
            `;
            statsGrid.appendChild(timeDiv);
            timeDisplay = document.getElementById('last-update-time');
        }
    }
    
    if (timeDisplay) {
        timeDisplay.textContent = timeString;
    }
}

// تحديث دالة refreshDashboardData لتحديث وقت آخر تحديث
const originalRefresh = refreshDashboardData;
window.refreshDashboardData = async function() {
    await originalRefresh();
    updateLastUpdateTime();
}

// ============= دعم Enter =============
document.getElementById('password-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') login();
});
document.getElementById('phone-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') document.getElementById('password-input').focus();
});