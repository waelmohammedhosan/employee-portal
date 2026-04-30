const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============= مسار قاعدة البيانات =============
function getDbPath() {
  const isRender = process.env.RENDER === 'true';
  const baseDir = isRender ? '/opt/render' : process.cwd();
  const folder = path.join(baseDir, 'data');
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
  return path.join(folder, 'factory_pro.db');
}

const dbPath = getDbPath();
console.log('📁 مسار قاعدة البيانات:', dbPath);

// ============= إنشاء قاعدة البيانات =============
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // جدول حسابات الموظفين
  db.run(`CREATE TABLE IF NOT EXISTS employees_auth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // جدول معلومات الموظفين
  db.run(`CREATE TABLE IF NOT EXISTS employee_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    phone TEXT,
    id_number TEXT
  )`);
  
  // جدول الأرشيف
  db.run(`CREATE TABLE IF NOT EXISTS archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arc_date TEXT,
    emp_name TEXT,
    data_json TEXT,
    prod TEXT,
    ret TEXT,
    loan TEXT
  )`);
  
  // إضافة أعمدة جديدة
  db.run("ALTER TABLE archive ADD COLUMN loan TEXT", () => {});
  
  // إضافة حساب تجريبي
  db.get("SELECT COUNT(*) as count FROM employees_auth", (err, row) => {
    if (row && row.count === 0) {
      const hashedPassword = bcrypt.hashSync('123123', 10);
      db.run(`INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)`,
        ['وائل محمد', '0779966565', hashedPassword]);
      console.log('✅ تم إضافة حساب تجريبي: 0779966565 / 123123');
    }
  });
});

console.log('✅ قاعدة البيانات جاهزة');

// ============= API: تسجيل الدخول =============
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  
  console.log('📱 محاولة تسجيل دخول:', phone);
  
  if (!phone || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال رقم الهاتف وكلمة المرور' });
  }
  
  db.get("SELECT * FROM employees_auth WHERE phone = ?", [phone], (err, employee) => {
    if (err) {
      console.error('❌ خطأ في قاعدة البيانات:', err);
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
    
    if (!employee) {
      console.log('❌ رقم الهاتف غير موجود:', phone);
      return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
    }
    
    const isValid = bcrypt.compareSync(password, employee.password);
    if (!isValid) {
      console.log('❌ كلمة مرور غير صحيحة');
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }
    
    console.log('✅ تسجيل دخول ناجح:', employee.name);
    res.json({
      success: true,
      employee: { id: employee.id, name: employee.name, phone: employee.phone }
    });
  });
});

// ============= API: الحصول على تقارير الموظف =============
app.get('/api/employee/:name/reports', (req, res) => {
  const { name } = req.params;
  
  db.all(`SELECT id, arc_date, data_json, loan FROM archive WHERE emp_name = ? ORDER BY arc_date DESC`,
    [name], (err, rows) => {
      if (err) {
        return res.status(500).json({ error: 'خطأ في تحميل البيانات' });
      }
      
      const reports = rows.map(row => ({
        id: row.id,
        date: row.arc_date,
        data: JSON.parse(row.data_json),
        loan: row.loan || '0'
      }));
      
      res.json({ success: true, reports });
    });
});

// ============= API: إحصائيات الموظف =============
app.get('/api/employee/:name/stats', (req, res) => {
  const { name } = req.params;
  
  db.all("SELECT data_json, loan FROM archive WHERE emp_name = ?", [name], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في حساب الإحصائيات' });
    }
    
    let totalHours = 0, totalOvertime = 0, totalVacation = 0, totalLoans = 0;
    
    rows.forEach(row => {
      const data = JSON.parse(row.data_json);
      const loan = row.loan || '0';
      
      if (data.start_t && data.end_t && !data.start_t.includes('إجازة') && !data.start_t.includes('عطلة')) {
        const hours = calculateHours(data.start_t, data.end_t);
        totalHours += hours;
      }
      
      totalOvertime += parseFloat(data.overtime) || 0;
      totalLoans += parseFloat(loan) || 0;
      
      if (data.notes && (data.notes.includes('إجازة') || data.notes.includes('عطلة'))) {
        totalVacation++;
      }
    });
    
    res.json({ success: true, stats: { totalHours, totalOvertime, totalVacation, totalLoans } });
  });
});

// ============= API: معلومات الموظف =============
app.get('/api/employee/:name/info', (req, res) => {
  const { name } = req.params;
  
  db.get("SELECT phone, id_number FROM employee_info WHERE name = ?", [name], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'خطأ في تحميل المعلومات' });
    }
    res.json({ success: true, info: row || { phone: '', id_number: '' } });
  });
});

// ============= API: إضافة حساب جديد =============
app.post('/api/employees/add', (req, res) => {
  const { name, phone, password } = req.body;
  
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال جميع البيانات' });
  }
  
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.run("INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)",
    [name, phone, hashedPassword], function(err) {
      if (err) {
        res.status(500).json({ success: false, error: err.message });
      } else {
        res.json({ success: true, message: 'تم إضافة الحساب بنجاح' });
      }
    });
});

// ============= API: الحصول على جميع الحسابات =============
app.get('/api/employees/all', (req, res) => {
  db.all("SELECT id, name, phone, created_at FROM employees_auth ORDER BY name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true, accounts: rows });
    }
  });
});

// ============= API: حذف حساب =============
app.delete('/api/employees/delete/:id', (req, res) => {
  const { id } = req.params;
  
  db.run("DELETE FROM employees_auth WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'تم حذف الحساب بنجاح' });
    }
  });
});

// ============= API: تغيير كلمة المرور =============
app.put('/api/employees/reset-password/:id', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.run("UPDATE employees_auth SET password = ? WHERE id = ?", [hashedPassword, id], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    }
  });
});

// ============= API: إعداد حساب تجريبي =============
app.get('/api/setup', (req, res) => {
  const hashedPassword = bcrypt.hashSync('123123', 10);
  db.run("INSERT OR IGNORE INTO employees_auth (name, phone, password) VALUES (?,?,?)",
    ['وائل محمد', '0779966565', hashedPassword], function(err) {
      if (err) {
        res.json({ success: false, error: err.message });
      } else {
        res.json({ success: true, message: 'تم إضافة الحساب التجريبي: 0779966565 / 123123' });
      }
    });
});

// ============= دالة حساب ساعات العمل =============
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

// ============= تشغيل السيرفر =============
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 ========================================`);
  console.log(`🚀 خادم الموظفين يعمل على المنفذ: ${PORT}`);
  console.log(`🚀 ========================================`);
  console.log(`📱 الرابط: https://employee-portal-8dp0.onrender.com`);
  console.log(`📁 مسار قاعدة البيانات: ${dbPath}\n`);
});