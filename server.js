const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const cors = require('cors');
const os = require('os');
const fs = require('fs');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ============= مسار قاعدة البيانات المشترك =============
// يجب أن يكون نفس المسار المستخدم في تطبيق desktop

function getDbPath() {
  const appData = process.env.APPDATA || os.homedir();
  const folder = path.join(appData, 'CoalFactory_Electron');
  return path.join(folder, 'factory_pro.db');
}

const dbPath = getDbPath();
console.log('📁 مسار قاعدة البيانات:', dbPath);

// التحقق من وجود قاعدة البيانات
if (!fs.existsSync(dbPath)) {
  console.error('❌ قاعدة البيانات غير موجودة! يرجى تشغيل تطبيق desktop أولاً');
} else {
  console.log('✅ قاعدة البيانات موجودة');
}

// الاتصال بقاعدة البيانات
const db = new sqlite3.Database(dbPath);

// ============= API: تسجيل دخول الموظف =============
app.post('/api/login', (req, res) => {
  const { phone, password } = req.body;
  
  console.log('📱 محاولة تسجيل دخول:', phone);
  
  if (!phone || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال رقم الهاتف وكلمة المرور' });
  }
  
  // البحث عن الموظف في جدول employees_auth
  db.get("SELECT * FROM employees_auth WHERE phone = ?", [phone], async (err, employee) => {
    if (err) {
      console.error('❌ خطأ في قاعدة البيانات:', err);
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
    
    if (!employee) {
      console.log('❌ رقم الهاتف غير موجود:', phone);
      return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
    }
    
    // التحقق من كلمة المرور
    const isValid = bcrypt.compareSync(password, employee.password);
    if (!isValid) {
      console.log('❌ كلمة مرور غير صحيحة لـ:', phone);
      return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
    }
    
    console.log('✅ تسجيل دخول ناجح:', employee.name);
    res.json({ 
      success: true, 
      employee: { 
        id: employee.id, 
        name: employee.name, 
        phone: employee.phone 
      } 
    });
  });
});

// ============= API: الحصول على تقارير الموظف =============
app.get('/api/employee/:name/reports', (req, res) => {
  const { name } = req.params;
  
  db.all(`SELECT id, arc_date, data_json, loan FROM archive WHERE emp_name = ? ORDER BY arc_date DESC`, 
    [name], (err, rows) => {
      if (err) {
        console.error('خطأ في تحميل البيانات:', err);
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

// ============= API: الحصول على معلومات الموظف =============
app.get('/api/employee/:name/info', (req, res) => {
  const { name } = req.params;
  
  db.get("SELECT phone, id_number FROM employee_info WHERE name = ?", [name], (err, row) => {
    if (err) {
      console.error('خطأ في تحميل المعلومات:', err);
      return res.status(500).json({ error: 'خطأ في تحميل المعلومات' });
    }
    
    res.json({ success: true, info: row || { phone: '', id_number: '' } });
  });
});

// ============= API: الحصول على إحصائيات الموظف =============
app.get('/api/employee/:name/stats', (req, res) => {
  const { name } = req.params;
  
  db.all("SELECT data_json, loan FROM archive WHERE emp_name = ?", [name], (err, rows) => {
    if (err) {
      console.error('خطأ في حساب الإحصائيات:', err);
      return res.status(500).json({ error: 'خطأ في حساب الإحصائيات' });
    }
    
    let totalHours = 0, totalOvertime = 0, totalVacation = 0, totalLoans = 0;
    
    rows.forEach(row => {
      const data = JSON.parse(row.data_json);
      const loan = row.loan || '0';
      
      // حساب ساعات العمل
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
    
    res.json({ 
      success: true, 
      stats: { totalHours, totalOvertime, totalVacation, totalLoans }
    });
  });
});

// ============= API: التحقق من وجود الحسابات (للتأكد) =============
app.get('/api/check', (req, res) => {
  db.all("SELECT id, name, phone FROM employees_auth", (err, rows) => {
    if (err) {
      res.json({ error: err.message });
    } else {
      res.json({ success: true, accounts: rows });
    }
  });
});

// ============= API: إضافة حساب تجريبي (للتسهيل) =============
app.get('/api/setup', (req, res) => {
  try {
    const hashedPassword = bcrypt.hashSync('123123', 10);
    
    db.run("INSERT OR IGNORE INTO employees_auth (name, phone, password) VALUES (?,?,?)", 
      ['وائل', '0779966565', hashedPassword], function(err) {
        if (err) {
          res.json({ success: false, error: err.message });
        } else {
          res.json({ success: true, message: 'تم إضافة الحساب التجريبي بنجاح' });
        }
      });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
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
  console.log(`🚀 خادم الموظفين يعمل على: http://localhost:${PORT}`);
  console.log(`🚀 ========================================`);
  console.log(`📱 الموظفون يمكنهم الدخول عبر الرابط: http://localhost:${PORT}`);
  console.log(`📁 مسار قاعدة البيانات: ${dbPath}\n`);
  
  // التحقق من وجود حسابات في قاعدة البيانات
  db.get("SELECT COUNT(*) as count FROM employees_auth", (err, row) => {
    if (err) {
      console.log('⚠️ جدول employees_auth غير موجود، قم بإضافة حسابات من تطبيق desktop أولاً');
    } else {
      console.log(`📊 عدد الحسابات المسجلة: ${row.count}`);
      if (row.count === 0) {
        console.log('⚠️ لا توجد حسابات!');
        console.log('💡 يمكنك إضافة حساب تجريبي عبر: http://localhost:5000/api/setup');
      } else {
        // عرض الحسابات الموجودة
        db.all("SELECT name, phone FROM employees_auth", (err, rows) => {
          if (!err && rows.length > 0) {
            console.log('\n📋 الحسابات المسجلة:');
            rows.forEach(row => {
              console.log(`   👤 ${row.name} | 📱 ${row.phone}`);
            });
            console.log('');
          }
        });
      }
    }
  });
});