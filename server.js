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
  return path.join(__dirname, 'factory_pro.db');
}

const dbPath = getDbPath();
console.log('📁 مسار قاعدة البيانات:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.error('❌ قاعدة البيانات غير موجودة!');
} else {
  console.log('✅ قاعدة البيانات موجودة');
}

// ============= الاتصال بقاعدة البيانات =============
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS employees_auth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS employee_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    phone TEXT,
    id_number TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arc_date TEXT,
    emp_name TEXT,
    data_json TEXT,
    prod TEXT,
    ret TEXT,
    loan TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS current_day (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    date TEXT,
    start_t TEXT,
    end_t TEXT,
    overtime TEXT,
    discount TEXT,
    notes TEXT,
    sort_order INTEGER,
    loan TEXT
  )`);
  
  db.run("ALTER TABLE archive ADD COLUMN loan TEXT", () => {});
  db.run("ALTER TABLE current_day ADD COLUMN loan TEXT", () => {});
  
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
      return res.status(500).json({ error: 'خطأ في الخادم' });
    }
    
    if (!employee) {
      return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
    }
    
    const isValid = bcrypt.compareSync(password, employee.password);
    if (!isValid) {
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

// ============= API: تحديث بيانات الموظفين =============
app.post('/api/employees/update', (req, res) => {
  const { employees } = req.body;
  
  console.log('📝 استلام تحديث بيانات الموظفين:', employees ? employees.length : 0);
  
  if (!employees || !Array.isArray(employees)) {
    return res.status(400).json({ error: 'بيانات غير صالحة' });
  }
  
  db.run("DELETE FROM current_day", (err) => {
    if (err) {
      console.error('❌ خطأ في حذف البيانات:', err);
      return res.status(500).json({ error: err.message });
    }
    
    if (employees.length === 0) {
      return res.json({ success: true, message: 'تم مسح جميع الموظفين' });
    }
    
    let completed = 0;
    let hasError = false;
    
    employees.forEach((emp, index) => {
      db.run(
        `INSERT INTO current_day (name, date, start_t, end_t, overtime, discount, notes, sort_order, loan) 
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [emp.name, emp.date, emp.start_t, emp.end_t, emp.overtime, emp.discount, emp.notes, index, emp.loan || '0'],
        (err) => {
          if (err) {
            console.error('❌ خطأ في إدراج الموظف:', err);
            hasError = true;
          }
          completed++;
          if (completed === employees.length) {
            if (hasError) {
              res.status(500).json({ error: 'خطأ في حفظ البيانات' });
            } else {
              console.log('✅ تم تحديث بيانات الموظفين بنجاح');
              res.json({ success: true, message: 'تم تحديث البيانات' });
            }
          }
        }
      );
    });
  });
});

// ============= API: حذف موظف =============
app.delete('/api/employees/delete/:name', (req, res) => {
  const { name } = req.params;
  
  console.log('🗑️ حذف موظف:', name);
  
  db.run("DELETE FROM current_day WHERE name = ?", [name], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true, message: 'تم حذف الموظف' });
    }
  });
});

// ============= API: إضافة سجل دوام =============
app.post('/api/archive/add', (req, res) => {
  const { emp_name, arc_date, data_json, prod, ret, loan } = req.body;
  
  console.log('📝 استلام سجل دوام:', { emp_name, arc_date });
  
  if (!emp_name || !arc_date || !data_json) {
    return res.status(400).json({ error: 'بيانات غير مكتملة' });
  }
  
  db.run(`INSERT INTO archive (emp_name, arc_date, data_json, prod, ret, loan) VALUES (?,?,?,?,?,?)`,
    [emp_name, arc_date, data_json, prod || '0', ret || '0', loan || '0'], function(err) {
      if (err) {
        console.error('❌ خطأ في الإضافة:', err);
        res.status(500).json({ error: err.message });
      } else {
        console.log('✅ تم إضافة سجل دوام للموظف:', emp_name);
        res.json({ success: true, message: 'تم إضافة السجل', id: this.lastID });
      }
    });
});

// ============= API: إضافة سجل دوام (نسخة أخرى للاختبار) =============
app.post('/api/archive/add-test', (req, res) => {
  const data = req.body;
  console.log('📝 بيانات الاختبار:', data);
  res.json({ success: true, message: 'تم استلام البيانات', data: data });
});

// ============= API: الحصول على جميع الموظفين الحاليين =============
app.get('/api/current-employees', (req, res) => {
  db.all("SELECT name, date, start_t, end_t, overtime, discount, notes, loan, sort_order FROM current_day ORDER BY sort_order ASC",
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
      } else {
        res.json({ success: true, employees: rows });
      }
    });
});

// ============= API: أسماء الأرشيف =============
app.get('/api/archive/names', (req, res) => {
  db.all("SELECT DISTINCT emp_name FROM archive ORDER BY emp_name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true, names: rows.map(r => r.emp_name) });
    }
  });
});

// ============= API: حذف سجل من الأرشيف =============
app.delete('/api/archive/delete/:id', (req, res) => {
  const { id } = req.params;
  
  console.log('🗑️ حذف سجل أرشيف ID:', id);
  
  db.run("DELETE FROM archive WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'تم حذف السجل' });
    }
  });
});

// ============= API: إدارة حسابات الموظفين =============
app.get('/api/employees/check-phone/:phone', (req, res) => {
  const { phone } = req.params;
  
  db.get("SELECT id FROM employees_auth WHERE phone = ?", [phone], (err, row) => {
    if (err) {
      res.json({ success: false, error: err.message });
    } else {
      res.json({ success: true, exists: !!row });
    }
  });
});

app.post('/api/employees/add', (req, res) => {
  const { name, phone, password } = req.body;
  
  console.log('📝 محاولة إضافة حساب:', { name, phone });
  
  if (!name || !phone || !password) {
    return res.status(400).json({ error: 'الرجاء إدخال جميع البيانات' });
  }
  
  db.get("SELECT id FROM employees_auth WHERE phone = ?", [phone], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    if (row) {
      return res.status(400).json({ error: 'رقم الهاتف موجود مسبقاً' });
    }
    
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    db.run("INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)",
      [name, phone, hashedPassword], function(err) {
        if (err) {
          console.error('❌ خطأ في الإضافة:', err);
          res.status(500).json({ error: err.message });
        } else {
          console.log('✅ تم إضافة الحساب بنجاح:', name);
          res.json({ success: true, message: 'تم إضافة الحساب بنجاح', id: this.lastID });
        }
      });
  });
});

app.get('/api/employees/all', (req, res) => {
  db.all("SELECT id, name, phone, created_at FROM employees_auth ORDER BY name", (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true, accounts: rows });
    }
  });
});

app.delete('/api/employees/delete/:id', (req, res) => {
  const { id } = req.params;
  
  console.log('🗑️ حذف حساب ID:', id);
  
  db.run("DELETE FROM employees_auth WHERE id = ?", [id], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'تم حذف الحساب بنجاح' });
    }
  });
});

app.put('/api/employees/reset-password/:id', (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  
  console.log('🔑 تغيير كلمة المرور للحساب ID:', id);
  
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  db.run("UPDATE employees_auth SET password = ? WHERE id = ?", [hashedPassword, id], function(err) {
    if (err) {
      res.status(500).json({ success: false, error: err.message });
    } else {
      res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    }
  });
});

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

// ============= API: التحقق من صحة السيرفر =============
app.get('/api/check', (req, res) => {
  res.json({ success: true, message: 'السيرفر يعمل بشكل صحيح', timestamp: new Date().toISOString() });
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
  console.log(`📱 رابط التطبيق: https://employee-portal-8dp0.onrender.com`);
  console.log(`📁 مسار قاعدة البيانات: ${dbPath}\n`);
});