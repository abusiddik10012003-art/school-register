require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { signToken, requireAuth, requireAdmin, COOKIE_NAME } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProd,
  maxAge: 7 * 24 * 60 * 60 * 1000
};

// ---------- AUTH ----------

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid email or password.' });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password.' });

  const token = signToken(user);
  res.cookie(COOKIE_NAME, token, cookieOpts);
  res.json({ id: user.id, name: user.name, email: user.email, role: user.role, class: user.class });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json(req.user);
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// ---------- USER MANAGEMENT (admin only) ----------

app.get('/api/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, class, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, role, class: className } = req.body;
  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'Name, email, password, and role are required.' });
  }
  if (!['admin', 'teacher'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin or teacher.' });
  }
  if (role === 'teacher' && !className) {
    return res.status(400).json({ error: 'Teachers must be assigned a class.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  try {
    const hash = bcrypt.hashSync(password, 10);
    const info = db.prepare(
      `INSERT INTO users (name, email, password_hash, role, class) VALUES (?, ?, ?, ?, ?)`
    ).run(name.trim(), email.toLowerCase().trim(), hash, role, role === 'teacher' ? className.trim() : null);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    if (String(e).includes('UNIQUE')) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    res.status(500).json({ error: 'Could not create user.' });
  }
});

app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ---------- STUDENTS ----------
// Scoping rule: admin sees all students; teacher sees only their own class.

function scopeFilter(req) {
  if (req.user.role === 'admin') return null;
  return req.user.class;
}

app.get('/api/students', requireAuth, (req, res) => {
  const scope = scopeFilter(req);
  const search = (req.query.q || '').toLowerCase().trim();
  const classFilter = (req.query.class || '').trim();

  let rows;
  if (scope) {
    rows = db.prepare('SELECT * FROM students WHERE class = ? ORDER BY name').all(scope);
  } else {
    rows = classFilter
      ? db.prepare('SELECT * FROM students WHERE class = ? ORDER BY name').all(classFilter)
      : db.prepare('SELECT * FROM students ORDER BY name').all();
  }

  if (search) {
    rows = rows.filter(s =>
      s.name.toLowerCase().includes(search) || s.student_code.toLowerCase().includes(search)
    );
  }

  const resultCountStmt = db.prepare('SELECT COUNT(*) AS c, AVG(score) AS avg FROM results WHERE student_id = ?');
  const withStats = rows.map(s => {
    const stats = resultCountStmt.get(s.id);
    return { ...s, result_count: stats.c, average_score: stats.avg ? Math.round(stats.avg) : null };
  });

  res.json(withStats);
});

app.get('/api/students/:id', requireAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const scope = scopeFilter(req);
  if (scope && student.class !== scope) return res.status(403).json({ error: 'Not authorized for this class.' });

  const results = db.prepare('SELECT * FROM results WHERE student_id = ? ORDER BY created_at DESC').all(student.id);
  res.json({ ...student, results });
});

app.post('/api/students', requireAuth, (req, res) => {
  const { name, class: className, session, guardian, contact, notes } = req.body;
  if (!name || !className) return res.status(400).json({ error: 'Name and class are required.' });

  const scope = scopeFilter(req);
  if (scope && className.trim() !== scope) {
    return res.status(403).json({ error: `As a teacher, you can only add students to your own class (${scope}).` });
  }

  const code = 'S-' + Math.random().toString(36).slice(2, 7).toUpperCase();
  const info = db.prepare(`
    INSERT INTO students (student_code, name, class, session, guardian, contact, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(code, name.trim(), className.trim(), session || 'AM', guardian || '', contact || '', notes || '', req.user.id);

  res.json({ id: info.lastInsertRowid, student_code: code });
});

app.delete('/api/students/:id', requireAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const scope = scopeFilter(req);
  if (scope && student.class !== scope) return res.status(403).json({ error: 'Not authorized for this class.' });

  db.prepare('DELETE FROM students WHERE id = ?').run(student.id);
  res.json({ ok: true });
});

// ---------- RESULTS ----------

app.post('/api/students/:id/results', requireAuth, (req, res) => {
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });
  const scope = scopeFilter(req);
  if (scope && student.class !== scope) return res.status(403).json({ error: 'Not authorized for this class.' });

  const { subject, term, score } = req.body;
  const numScore = Number(score);
  if (!subject || !term || isNaN(numScore) || numScore < 0 || numScore > 100) {
    return res.status(400).json({ error: 'Subject, term, and a score between 0-100 are required.' });
  }

  const info = db.prepare(`
    INSERT INTO results (student_id, subject, term, score, recorded_by) VALUES (?, ?, ?, ?, ?)
  `).run(student.id, subject.trim(), term.trim(), numScore, req.user.id);

  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/results/:id', requireAuth, (req, res) => {
  const result = db.prepare('SELECT * FROM results WHERE id = ?').get(req.params.id);
  if (!result) return res.status(404).json({ error: 'Result not found.' });
  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(result.student_id);
  const scope = scopeFilter(req);
  if (scope && student.class !== scope) return res.status(403).json({ error: 'Not authorized for this class.' });

  db.prepare('DELETE FROM results WHERE id = ?').run(result.id);
  res.json({ ok: true });
});

// ---------- DASHBOARD STATS ----------

app.get('/api/stats', requireAuth, (req, res) => {
  const scope = scopeFilter(req);
  const studentCount = scope
    ? db.prepare('SELECT COUNT(*) AS c FROM students WHERE class = ?').get(scope).c
    : db.prepare('SELECT COUNT(*) AS c FROM students').get().c;

  const classCount = scope
    ? 1
    : db.prepare('SELECT COUNT(DISTINCT class) AS c FROM students').get().c;

  const resultCount = scope
    ? db.prepare(`SELECT COUNT(*) AS c FROM results r JOIN students s ON r.student_id = s.id WHERE s.class = ?`).get(scope).c
    : db.prepare('SELECT COUNT(*) AS c FROM results').get().c;

  const avgByClass = scope
    ? db.prepare(`
        SELECT s.class AS class, AVG(r.score) AS avg
        FROM results r JOIN students s ON r.student_id = s.id
        WHERE s.class = ? GROUP BY s.class
      `).all(scope)
    : db.prepare(`
        SELECT s.class AS class, AVG(r.score) AS avg
        FROM results r JOIN students s ON r.student_id = s.id
        GROUP BY s.class ORDER BY s.class
      `).all();

  res.json({
    studentCount,
    classCount,
    resultCount,
    avgByClass: avgByClass.map(r => ({ class: r.class, avg: Math.round(r.avg) }))
  });
});

app.listen(PORT, () => {
  console.log(`School register server running on http://localhost:${PORT}`);
});
