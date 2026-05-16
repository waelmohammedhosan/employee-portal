const express = require('express');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const fs = require('fs');
const jwt = require('jsonwebtoken'); // لإدارة جلسات المدير

const app = express();
const PORT = process.env.PORT || 3000;

// مفتاح التشفير الخاص بلوحة الإدارة (يمكنك تغييره لاحقاً)
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'SuperSecretAdminKeyRays2026';

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

// ============= دوال مساعدة =============
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

// Middleware للتحقق من صلاحيات المدير
const authenticateAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'غير مصرح لك بالوصول' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, ADMIN_JWT_SECRET);
        if (decoded.role !== 'admin') throw new Error('Role is not admin');
        req.admin = decoded;
        next();
    } catch (err) {
        res.status(401).json({ error: 'الجلسة منتهية أو الرمز غير صالح' });
    }
};

// ============= API مصادقة الموظفين =============
app.post('/api/login', (req, res) => {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'الرجاء إدخال رقم الهاتف وكلمة المرور' });
    try {
        const employee = db.prepare("SELECT * FROM employees_auth WHERE phone = ?").get(phone);
        if (!employee) return res.status(401).json({ error: 'رقم الهاتف غير موجود' });
        const isValid = bcrypt.compareSync(password, employee.password);
        if (!isValid) return res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
        res.json({ success: true, employee: { id: employee.id, name: employee.name, phone: employee.phone } });
    } catch(e) {
        res.status(500).json({ error: 'خطأ في الخادم' });
    }
});

// ============= API لوحة تحكم المدير =============
// 1. تسجيل الدخول للمدير
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const ADMIN_USER = process.env.ADMIN_USER || 'admin';
    const ADMIN_PASS = process.env.ADMIN_PASS || 'admin2026'; 

    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = jwt.sign({ role: 'admin', username }, ADMIN_JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, error: 'بيانات الدخول غير صحيحة' });
    }
});

// 2. جلب جميع الموظفين للمدير
app.get('/api/admin/employees', authenticateAdmin, (req, res) => {
    try {
        const rows = db.prepare("SELECT name, phone FROM employees_auth ORDER BY name").all();
        res.json({ success: true, employees: rows });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. جلب بيانات موظف محدد للمدير
app.get('/api/admin/employee/:name', authenticateAdmin, (req, res) => {
    const { name } = req.params;
    try {
        const rows = db.prepare("SELECT arc_date, data_json, loan FROM archive WHERE emp_name = ? ORDER BY arc_date DESC").all(name);
        const records = rows.map(row => {
            const data = JSON.parse(row.data_json);
            return {
                date: row.arc_date,
                start_t: data.start_t || '',
                end_t: data.end_t || '',
                overtime: data.overtime || '0',
                discount: data.discount || 'لا يوجد',
                notes: data.notes || '',
                loan: row.loan || '0',
                work_hours: calculateHours(data.start_t, data.end_t)
            };
        });
        res.json({ success: true, records });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ============= ميزة الحذف الشامل (الأساسية) =============
app.delete('/api/employees/full-delete/:name', (req, res) => {
    const { name } = req.params;
    console.log(`🗑️ جاري الحذف الشامل للموظف: ${name}`);

    try {
        const tx = db.transaction(() => {
            const authResult = db.prepare("DELETE FROM employees_auth WHERE name = ?").run(name);
            const archiveResult = db.prepare("DELETE FROM archive WHERE emp_name = ?").run(name);
            const currentResult = db.prepare("DELETE FROM current_day WHERE name = ?").run(name);
            db.prepare("DELETE FROM employee_info WHERE name = ?").run(name);
            
            return { accountDeleted: authResult.changes > 0, archiveRecordsDeleted: archiveResult.changes, currentDayDeleted: currentResult.changes > 0 };
        });

        const result = tx();
        res.json({ success: true, message: 'تم الحذف الشامل بنجاح', details: result });
    } catch (error) {
        console.error('❌ خطأ أثناء الحذف الشامل:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============= باقي الـ APIs الاعتيادية =============
app.get('/api/archive/names', (req, res) => {
    try {
        const rows = db.prepare("SELECT DISTINCT emp_name FROM archive ORDER BY emp_name").all();
        res.json({ success: true, names: rows.map(row => row.emp_name) });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/employee/:name/reports', (req, res) => {
    const { name } = req.params;
    try {
        const rows = db.prepare(`SELECT id, arc_date, data_json, loan FROM archive WHERE emp_name = ? ORDER BY arc_date DESC`).all(name);
        res.json({ success: true, reports: rows.map(row => ({ id: row.id, date: row.arc_date, data: JSON.parse(row.data_json), loan: row.loan || '0' })) });
    } catch(e) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/archive/add', (req, res) => {
    const { emp_name, arc_date, data_json, prod, ret, loan } = req.body;
    try {
        const info = db.prepare(`INSERT INTO archive (emp_name, arc_date, data_json, prod, ret, loan) VALUES (?,?,?,?,?,?)`).run(emp_name, arc_date, data_json, prod || '0', ret || '0', loan || '0');
        res.json({ success: true, id: info.lastInsertRowid });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/archive/delete/:id', (req, res) => {
    try {
        db.prepare("DELETE FROM archive WHERE id = ?").run(req.params.id);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/employee/:name/stats', (req, res) => {
    const { name } = req.params;
    try {
        const rows = db.prepare("SELECT data_json, loan FROM archive WHERE emp_name = ?").all(name);
        let totalHours = 0, totalOvertime = 0, totalVacation = 0, totalLoans = 0;
        rows.forEach(row => {
            const data = JSON.parse(row.data_json);
            if (data.start_t && data.end_t && !data.start_t.includes('إجازة') && !data.start_t.includes('عطلة')) totalHours += calculateHours(data.start_t, data.end_t);
            totalOvertime += parseFloat(data.overtime) || 0;
            totalLoans += parseFloat(row.loan) || 0;
            if (data.notes && (data.notes.includes('إجازة') || data.notes.includes('عطلة'))) totalVacation++;
        });
        res.json({ success: true, stats: { totalHours, totalOvertime, totalVacation, totalLoans } });
    } catch(e) { res.status(500).json({ error: 'خطأ' }); }
});

app.post('/api/employees/update', (req, res) => {
    const { employees } = req.body;
    if (!employees || !Array.isArray(employees)) return res.status(400).json({ error: 'بيانات غير صالحة' });
    try {
        db.prepare("DELETE FROM current_day").run();
        if (employees.length > 0) {
            const stmt = db.prepare(`INSERT INTO current_day (name, date, start_t, end_t, overtime, discount, notes, sort_order, loan) VALUES (?,?,?,?,?,?,?,?,?)`);
            employees.forEach((emp, index) => stmt.run(emp.name, emp.date, emp.start_t, emp.end_t, emp.overtime, emp.discount, emp.notes, index, emp.loan || '0'));
        }
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'خطأ' }); }
});

app.get('/api/employees/all', (req, res) => {
    try { res.json({ success: true, accounts: db.prepare("SELECT id, name, phone, created_at FROM employees_auth ORDER BY name").all() }); } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/employees/add', (req, res) => {
    const { name, phone, password } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
    try {
        const existing = db.prepare("SELECT id FROM employees_auth WHERE phone = ?").get(phone);
        if (existing) return res.status(400).json({ error: 'رقم الهاتف موجود مسبقاً' });
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.prepare("INSERT INTO employees_auth (name, phone, password) VALUES (?,?,?)").run(name, phone, hashedPassword);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/employees/update/:id', (req, res) => {
    const { id } = req.params; const { name, phone, password } = req.body;
    try {
        if (password) {
            const hashedPassword = bcrypt.hashSync(password, 10);
            db.prepare("UPDATE employees_auth SET name = ?, phone = ?, password = ? WHERE id = ?").run(name, phone, hashedPassword, id);
        } else {
            db.prepare("UPDATE employees_auth SET name = ?, phone = ? WHERE id = ?").run(name, phone, id);
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

// تشغيل السيرفر
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 خادم مصنع الريس يعمل على المنفذ: ${PORT}`);
    console.log(`📱 رابط التطبيق: https://employee-portal-8dp0.onrender.com`);
    console.log(`📁 مسار قاعدة البيانات: ${dbPath}\n`);
});