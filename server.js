const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');  // ✅ تأكد من هذا السطر
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.use((req, res, next) => {
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    next();
});

// قاعدة البيانات
function getDbPath() {
    return path.join(__dirname, 'factory_pro.db');
}

const dbPath = getDbPath();
console.log('📁 مسار قاعدة البيانات:', dbPath);

let db;
try {
    db = new Database(dbPath);
    console.log('✅ قاعدة البيانات متصلة');
} catch(e) {
    console.error('❌ خطأ في فتح قاعدة البيانات:', e.message);
    process.exit(1);
}

// إنشاء الجداول
db.exec(`CREATE TABLE IF NOT EXISTS employees_auth (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.exec(`CREATE TABLE IF NOT EXISTS employee_info (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    phone TEXT,
    id_number TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    arc_date TEXT,
    emp_name TEXT,
    data_json TEXT,
    prod TEXT,
    ret TEXT,
    loan TEXT
)`);

db.exec(`CREATE TABLE IF NOT EXISTS current_day (
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

// إضافة حساب تجريبي
const existing = db.prepare("SELECT COUNT(*) as count FROM employees_auth").get();
if (existing.count === 0) {
    const hashedPassword = bcrypt.hashSync('123123', 10);
    db.prepare("INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)")
        .run('وائل محمد', '0779966565', hashedPassword);
    console.log('✅ تم إضافة حساب تجريبي: 0779966565 / 123123');
}

console.log('✅ قاعدة البيانات جاهزة');

// ============= API =============
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    console.log('📱 محاولة تسجيل دخول:', phone);
    
    if (!phone || !password) {
        return res.status(400).json({ error: 'الرجاء إدخال رقم الهاتف وكلمة المرور' });
    }
    
    try {
        const employee = db.prepare("SELECT * FROM employees_auth WHERE phone = ?").get(phone);
        if (!employee) {
            return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
        }
        
        const isValid = bcrypt.compareSync(password, employee.password);
        if (!isValid) {
            return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
        }
        
        res.json({ success: true, employee: { id: employee.id, name: employee.name, phone: employee.phone } });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

app.get('/api/employee/:name/reports', (req, res) => {
    const { name } = req.params;
    try {
        const rows = db.prepare(`SELECT id, arc_date, data_json, loan FROM archive WHERE emp_name = ? ORDER BY arc_date DESC`).all(name);
        const reports = rows.map(row => ({ id: row.id, date: row.arc_date, data: JSON.parse(row.data_json), loan: row.loan || '0' }));
        res.json({ success: true, reports });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في تحميل البيانات' });
    }
});

app.get('/api/employee/:name/stats', (req, res) => {
    const { name } = req.params;
    try {
        const rows = db.prepare("SELECT data_json, loan FROM archive WHERE emp_name = ?").all(name);
        let totalHours = 0, totalOvertime = 0, totalVacation = 0, totalLoans = 0;
        
        rows.forEach(row => {
            const data = JSON.parse(row.data_json);
            const loan = row.loan || '0';
            if (data.start_t && data.end_t && !data.start_t.includes('إجازة') && !data.start_t.includes('عطلة')) {
                totalHours += calculateHours(data.start_t, data.end_t);
            }
            totalOvertime += parseFloat(data.overtime) || 0;
            totalLoans += parseFloat(loan) || 0;
            if (data.notes && (data.notes.includes('إجازة') || data.notes.includes('عطلة'))) totalVacation++;
        });
        
        res.json({ success: true, stats: { totalHours, totalOvertime, totalVacation, totalLoans } });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في حساب الإحصائيات' });
    }
});

app.get('/api/employee/:name/info', (req, res) => {
    const { name } = req.params;
    try {
        const row = db.prepare("SELECT phone, id_number FROM employee_info WHERE name = ?").get(name);
        res.json({ success: true, info: row || { phone: '', id_number: '' } });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في تحميل المعلومات' });
    }
});

app.post('/api/employees/update', (req, res) => {
    const { employees } = req.body;
    console.log('📝 استلام تحديث بيانات الموظفين:', employees ? employees.length : 0);
    
    if (!employees || !Array.isArray(employees)) {
        return res.status(400).json({ error: 'بيانات غير صالحة' });
    }
    
    try {
        db.prepare("DELETE FROM current_day").run();
        if (employees.length === 0) {
            return res.json({ success: true, message: 'تم مسح جميع الموظفين' });
        }
        
        const stmt = db.prepare(`INSERT INTO current_day (name, date, start_t, end_t, overtime, discount, notes, sort_order, loan) VALUES (?,?,?,?,?,?,?,?,?)`);
        employees.forEach((emp, index) => {
            stmt.run(emp.name, emp.date, emp.start_t, emp.end_t, emp.overtime, emp.discount, emp.notes, index, emp.loan || '0');
        });
        res.json({ success: true, message: 'تم تحديث البيانات' });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في حفظ البيانات' });
    }
});

app.post('/api/archive/add', (req, res) => {
    const { emp_name, arc_date, data_json, prod, ret, loan } = req.body;
    console.log('📝 استلام سجل دوام:', { emp_name, arc_date });
    
    if (!emp_name || !arc_date || !data_json) {
        return res.status(400).json({ error: 'بيانات غير مكتملة' });
    }
    
    try {
        const info = db.prepare(`INSERT INTO archive (emp_name, arc_date, data_json, prod, ret, loan) VALUES (?,?,?,?,?,?)`)
            .run(emp_name, arc_date, data_json, prod || '0', ret || '0', loan || '0');
        res.json({ success: true, message: 'تم إضافة السجل', id: info.lastInsertRowid });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/current-employees', (req, res) => {
    try {
        const rows = db.prepare("SELECT name, date, start_t, end_t, overtime, discount, notes, loan, sort_order FROM current_day ORDER BY sort_order ASC").all();
        res.json({ success: true, employees: rows });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/archive/names', (req, res) => {
    try {
        const rows = db.prepare("SELECT DISTINCT emp_name FROM archive ORDER BY emp_name").all();
        res.json({ success: true, names: rows.map(r => r.emp_name) });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/archive/delete/:id', (req, res) => {
    const { id } = req.params;
    console.log('🗑️ حذف سجل أرشيف ID:', id);
    try {
        db.prepare("DELETE FROM archive WHERE id = ?").run(id);
        res.json({ success: true, message: 'تم حذف السجل' });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/employees/check-phone/:phone', (req, res) => {
    const { phone } = req.params;
    try {
        const row = db.prepare("SELECT id FROM employees_auth WHERE phone = ?").get(phone);
        res.json({ success: true, exists: !!row });
    } catch(e) {
        res.json({ success: false, error: e.message });
    }
});
app.post('/api/employees/add', (req, res) => {
    const { name, phone, password } = req.body;
    
    console.log('📝 محاولة إضافة حساب:', { name, phone });
    
    if (!name || !phone || !password) {
        return res.status(400).json({ error: 'الرجاء إدخال جميع البيانات' });
    }
    
    try {
        // التحقق من وجود الرقم
        const existing = db.prepare("SELECT id FROM employees_auth WHERE phone = ?").get(phone);
        if (existing) {
            return res.status(400).json({ error: 'رقم الهاتف موجود مسبقاً' });
        }
        
        const hashedPassword = bcrypt.hashSync(password, 10);
        const info = db.prepare("INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)")
            .run(name, phone, hashedPassword);
        
        res.json({ success: true, message: 'تم إضافة الحساب بنجاح', id: info.lastInsertRowid });
    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/employees/all', (req, res) => {
    try {
        const rows = db.prepare("SELECT id, name, phone, created_at FROM employees_auth ORDER BY name").all();
        res.json({ success: true, accounts: rows });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ============= API: حذف حساب موظف =============
app.delete('/api/employees/delete/:id', (req, res) => {
    const { id } = req.params;
    
    console.log('🗑️ حذف حساب ID:', id);
    
    try {
        const result = db.prepare("DELETE FROM employees_auth WHERE id = ?").run(id);
        
        if (result.changes === 0) {
            res.status(404).json({ success: false, error: "الحساب غير موجود" });
        } else {
            console.log('✅ تم حذف الحساب بنجاح');
            res.json({ success: true, message: 'تم حذف الحساب بنجاح' });
        }
    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============= API: حذف جميع الحسابات (للاختبار) =============
app.get('/api/employees/delete-all', (req, res) => {
    console.log('🗑️ حذف جميع الحسابات');
    
    try {
        const result = db.prepare("DELETE FROM employees_auth").run();
        // إعادة تعيين الـ auto increment
        db.prepare("DELETE FROM sqlite_sequence WHERE name='employees_auth'").run();
        res.json({ success: true, message: `تم حذف ${result.changes} حساب` });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/employees/reset-password/:id', (req, res) => {
    const { id } = req.params;
    const { password } = req.body;
    console.log('🔑 تغيير كلمة المرور للحساب ID:', id);
    
    try {
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare("UPDATE employees_auth SET password = ? WHERE id = ?").run(hashedPassword, id);
        res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/setup', (req, res) => {
    const hashedPassword = bcrypt.hashSync('123123', 10);
    try {
        db.prepare("INSERT OR IGNORE INTO employees_auth (name, phone, password) VALUES (?,?,?)")
            .run('وائل محمد', '0779966565', hashedPassword);
        res.json({ success: true, message: 'تم إضافة الحساب التجريبي: 0779966565 / 123123' });
    } catch(e) {
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/check', (req, res) => {
    res.json({ success: true, message: 'السيرفر يعمل بشكل صحيح', timestamp: new Date().toISOString() });
});

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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 ========================================`);
    console.log(`🚀 خادم الموظفين يعمل على المنفذ: ${PORT}`);
    console.log(`🚀 ========================================`);
    console.log(`📱 رابط التطبيق: https://employee-portal-8dp0.onrender.com`);
    console.log(`📁 مسار قاعدة البيانات: ${dbPath}\n`);
});