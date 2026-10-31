require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'acpay_jwt_secret_key_98765';
const BREVO_API_KEY = process.env.BREVO_API_KEY || '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';
const DB_FILE = path.join(__dirname, 'database.json');

// --- DATABASE FUNCTIONS (POINT 1) ---
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = { users: [], transactions: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    return { users: [], transactions: [] };
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Database write error:', e.message);
  }
}

const otpCache = {};

// --- EMAIL DISPATCH (NATIVE HTTPS) ---
function sendBrevoEmail(toEmail, subject, textContent) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      sender: { name: 'ACPay Support', email: 'halthaf261@gmail.com' },
      to: [{ email: toEmail }],
      subject: subject,
      htmlContent: `<div style="font-family:Arial,sans-serif;padding:20px;"><h2>ACPay Notification</h2><p>${textContent}</p></div>`
    });

    const options = {
      hostname: 'api.brevo.com',
      port: 443,
      path: '/v3/smtp/email',
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'api-key': BREVO_API_KEY.trim(),
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let rawData = '';
      res.on('data', chunk => rawData += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(true);
        } else {
          reject(new Error(`Brevo Error (${res.statusCode}): ${rawData}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error('Brevo connection failed: ' + err.message)));
    req.write(payload);
    req.end();
  });
}

// --- AUTHENTICATION MIDDLEWARE ---
function verifyAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Missing authorization token' });

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

// Serve index.html on root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.use(express.static(__dirname));

// --- 1. SEND OTP FOR REGISTRATION ---
app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCache[email] = { code: otp, expiresAt: Date.now() + 10 * 60 * 1000, purpose: 'register' };

  try {
    await sendBrevoEmail(email, 'ACPay Registration OTP', `Your verification code is: <strong>${otp}</strong>. It expires in 10 minutes.`);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to send OTP to email' });
  }
});

// --- 2. REGISTER USER (SAVES TO DATABASE - POINT 1) ---
app.post('/api/register', (req, res) => {
  const { email, password, otp, referralCode } = req.body;
  const cached = otpCache[email];

  if (!cached || cached.code !== otp || cached.purpose !== 'register' || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const db = loadDB();
  if (db.users.find(u => u.email === email)) {
    return res.status(400).json({ error: 'User is already registered with this email' });
  }

  const newUser = {
    id: 'user_' + Date.now(),
    email,
    password,
    referralCode: referralCode || null,
    upiId: null,
    points: referralCode ? 500 : 0,
    role: email === 'halthaf261@gmail.com' ? 'admin' : 'user',
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  saveDB(db);
  delete otpCache[email];

  const token = jwt.sign({ id: newUser.id, email: newUser.email, role: newUser.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ message: 'Registration successful', token, user: newUser });
});

// --- 3. LOGIN ---
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.email === email && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ message: 'Login successful', token, user });
});

// --- 4. FORGOT PASSWORD (POINT 2) ---
app.post('/api/forgot-password/send-otp', async (req, res) => {
  const { email } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.email === email);

  if (!user) {
    return res.status(404).json({ error: 'No account registered with this email' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCache[email] = { code: otp, expiresAt: Date.now() + 10 * 60 * 1000, purpose: 'reset' };

  try {
    await sendBrevoEmail(email, 'ACPay Password Reset OTP', `Your password reset code is: <strong>${otp}</strong>. It expires in 10 minutes.`);
    res.json({ message: 'Password reset OTP sent successfully' });
  } catch (err) {
    res.status(400).json({ error: 'Failed to send reset email' });
  }
});

app.post('/api/forgot-password/reset', (req, res) => {
  const { email, otp, newPassword } = req.body;
  const cached = otpCache[email];

  if (!cached || cached.code !== otp || cached.purpose !== 'reset' || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const db = loadDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.password = newPassword;
  saveDB(db);
  delete otpCache[email];

  res.json({ message: 'Password updated successfully! You can now log in.' });
});

// --- 5. USER PROFILE & SAVE UPI ---
app.get('/api/user/profile', verifyAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ email: user.email, points: user.points, upiId: user.upiId, role: user.role });
});

app.post('/api/user/save-upi', verifyAuth, (req, res) => {
  const { upiId } = req.body;
  if (!upiId) return res.status(400).json({ error: 'UPI ID is required' });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.upiId = upiId.trim();
  saveDB(db);
  res.json({ message: 'UPI ID updated successfully' });
});

// --- 6. SUBMIT 12-DIGIT UTR (POINT 3) ---
app.post('/api/payment/submit-utr', verifyAuth, (req, res) => {
  const { planName, amount, utrNumber } = req.body;

  if (!utrNumber || !/^\d{12}$/.test(utrNumber.trim())) {
    return res.status(400).json({ error: 'UTR must be an exact 12-digit reference number' });
  }

  const db = loadDB();
  if (db.transactions.find(t => t.utrNumber === utrNumber.trim())) {
    return res.status(400).json({ error: 'This 12-digit UTR has already been submitted' });
  }

  const newTx = {
    id: 'tx_' + Date.now(),
    userId: req.user.id,
    userEmail: req.user.email,
    planName: planName || 'Standard Tier',
    amount: Number(amount) || 18500,
    utrNumber: utrNumber.trim(),
    status: 'PENDING',
    submittedAt: new Date().toISOString()
  };

  db.transactions.unshift(newTx);
  saveDB(db);

  res.json({ message: 'UTR submitted! Admin will verify and credit your points.', transaction: newTx });
});

// --- 7. ADMIN CONTROLS (POINT 4) ---
app.get('/api/admin/data', verifyAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized: Admin access required' });
  }

  res.json({ users: db.users, transactions: db.transactions });
});

app.post('/api/admin/action-utr', verifyAuth, (req, res) => {
  const { transactionId, action, points } = req.body;
  const db = loadDB();

  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized: Admin access required' });
  }

  const tx = db.transactions.find(t => t.id === transactionId);
  if (!tx || tx.status !== 'PENDING') return res.status(400).json({ error: 'Transaction is already processed' });

  if (action === 'APPROVE') {
    tx.status = 'APPROVED';
    const targetUser = db.users.find(u => u.id === tx.userId);
    if (targetUser) {
      const addedPoints = (points !== null && !isNaN(points)) ? Number(points) : tx.amount;
      targetUser.points = (targetUser.points || 0) + addedPoints;
    }
  } else {
    tx.status = 'REJECTED';
  }

  saveDB(db);
  res.json({ message: `Transaction has been ${action.toLowerCase()}d successfully` });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ACPay running live on port ${PORT}`);
});