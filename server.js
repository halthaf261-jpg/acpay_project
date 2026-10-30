require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 10000;
const JWT_SECRET = process.env.JWT_SECRET || 'acpay_jwt_secret_key_98765';
const BREVO_API_KEY = process.env.BREVO_API_KEY;
const DB_FILE = path.join(__dirname, 'database.json');

// --- DATABASE HELPERS ---
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const initialData = { users: [], transactions: [] };
    fs.writeFileSync(DB_FILE, JSON.stringify(initialData, null, 2));
    return initialData;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (err) {
    return { users: [], transactions: [] };
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// In-memory OTP storage for registration and password resets
const otpCache = {}; // { email: { code, expiresAt, purpose } }

// --- EMAIL DISPATCH (BREVO HTTP API) ---
async function sendBrevoEmail(toEmail, subject, textContent) {
  if (!BREVO_API_KEY) {
    throw new Error('BREVO_API_KEY is not configured in environment variables');
  }

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      sender: { name: 'ACPay Support', email: 'halthaf261@gmail.com' },
      to: [{ email: toEmail }],
      subject: subject,
      htmlContent: `<div style="font-family:sans-serif;padding:20px;"><h2>ACPay Notification</h2><p>${textContent}</p></div>`
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.message || 'Brevo API call failed');
  }
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
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

// --- ROOT ROUTE: DIRECTLY SERVE PAYMENT.HTML ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment.html'));
});

// --- 1. REGISTRATION OTP ---
app.post('/api/send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCache[email] = { code: otp, expiresAt: Date.now() + 10 * 60 * 1000, purpose: 'register' };

  try {
    await sendBrevoEmail(email, 'ACPay Registration OTP', `Your verification code is: <strong>${otp}</strong>. It expires in 10 minutes.`);
    console.log(`[ACPay] Register OTP dispatched to ${email}`);
    res.json({ message: 'OTP sent successfully' });
  } catch (err) {
    console.error('[ACPay] Send OTP Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// --- 2. REGISTER USER ---
app.post('/api/register', (req, res) => {
  const { email, password, otp } = req.body;
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
    points: 0,
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

// --- 4. FORGOT PASSWORD: SEND OTP ---
app.post('/api/forgot-password/send-otp', async (req, res) => {
  const { email } = req.body;
  const db = loadDB();
  const user = db.users.find(u => u.email === email);

  if (!user) {
    return res.status(404).json({ error: 'No account found with this email' });
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  otpCache[email] = { code: otp, expiresAt: Date.now() + 10 * 60 * 1000, purpose: 'reset' };

  try {
    await sendBrevoEmail(email, 'ACPay Password Reset OTP', `Your password reset code is: <strong>${otp}</strong>. It expires in 10 minutes.`);
    console.log(`[ACPay] Password Reset OTP sent to ${email}`);
    res.json({ message: 'Password reset OTP sent successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 5. FORGOT PASSWORD: VERIFY & UPDATE ---
app.post('/api/forgot-password/reset', (req, res) => {
  const { email, otp, newPassword } = req.body;
  const cached = otpCache[email];

  if (!cached || cached.code !== otp || cached.purpose !== 'reset' || Date.now() > cached.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const db = loadDB();
  const userIndex = db.users.findIndex(u => u.email === email);
  if (userIndex === -1) return res.status(404).json({ error: 'User not found' });

  db.users[userIndex].password = newPassword;
  saveDB(db);
  delete otpCache[email];

  res.json({ message: 'Password updated successfully. You can now log in.' });
});

// --- 6. USER PROFILE & CURRENT BALANCE ---
app.get('/api/user/profile', verifyAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ email: user.email, points: user.points, role: user.role });
});

// --- 7. SUBMIT PAYMENT WITH 12-DIGIT UTR ---
app.post('/api/payment/submit-utr', verifyAuth, (req, res) => {
  const { planName, amount, utrNumber } = req.body;

  if (!utrNumber || !/^\d{12}$/.test(utrNumber.trim())) {
    return res.status(400).json({ error: 'UTR must be an exact 12-digit reference number' });
  }

  const db = loadDB();
  const existingUtr = db.transactions.find(t => t.utrNumber === utrNumber.trim());
  if (existingUtr) {
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

  res.json({ message: 'UTR submitted successfully. Pending Admin verification.', transaction: newTx });
});

// --- 8. ADMIN: GET ALL USERS & SUBMITTED UTRS ---
app.get('/api/admin/data', verifyAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized: Admin access required' });
  }

  res.json({
    users: db.users.map(u => ({ id: u.id, email: u.email, points: u.points, role: u.role, createdAt: u.createdAt })),
    transactions: db.transactions
  });
});

// --- 9. ADMIN: APPROVE OR REJECT UTR & CREDIT POINTS ---
app.post('/api/admin/action-utr', verifyAuth, (req, res) => {
  const { transactionId, action } = req.body;
  const db = loadDB();

  const user = db.users.find(u => u.id === req.user.id);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Unauthorized: Admin access required' });
  }

  const tx = db.transactions.find(t => t.id === transactionId);
  if (!tx) return res.status(404).json({ error: 'Transaction not found' });
  if (tx.status !== 'PENDING') return res.status(400).json({ error: 'Transaction is already processed' });

  if (action === 'APPROVE') {
    tx.status = 'APPROVED';
    const targetUser = db.users.find(u => u.id === tx.userId);
    if (targetUser) {
      targetUser.points = (targetUser.points || 0) + tx.amount;
    }
  } else {
    tx.status = 'REJECTED';
  }

  saveDB(db);
  res.json({ message: `Transaction has been ${action.toLowerCase()}d successfully` });
});

// --- FALLBACK ROUTE: CATCH-ALL TO SERVE HTML ---
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment.html'));
});

app.listen(PORT, () => {
  console.log(`ACPay running live on port ${PORT}`);
});