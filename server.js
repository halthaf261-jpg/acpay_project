const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'acpay_prod_secret_2026';

const DB_FILE = path.join(__dirname, 'database.json');
const SCANNERS_FILE = path.join(__dirname, 'scanners_config.json');

const ADMIN_CONFIG = {
  authorizedEmail: (process.env.ADMIN_EMAIL || 'althaf97hussain01@gmail.com').trim().toLowerCase(),
  masterPin: (process.env.ADMIN_PIN || '8899').trim()
};

const defaultDb = {
  users: {},
  pendingUtrSlips: [],
  withdrawalRequests: [],
  activityLogs: [],
  supportChats: {},
  completedTransactions: []
};

const defaultScanners = {
  scanners: [
    { id: "scan_1", title: "mandru.b@ptyes", upiVpa: "mandru.b@ptyes", accountName: "madru vijay babu" },
    { id: "scan_2", title: "vaddi praveen", upiVpa: "raviii00794@okhdfcbank", accountName: "vaddi praveen" },
    { id: "scan_3", title: "pattulasairam", upiVpa: "pattula01@ptyes", accountName: "pattulasairam" }
  ],
  companyBank: {
    bankName: "State Bank of India",
    accountHolder: "Althaf Hussain",
    accountNumber: "42971394203",
    ifsc: "SBIN0000977"
  }
};

function readDb() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2), 'utf-8');
      return defaultDb;
    }
    const data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!data.completedTransactions) data.completedTransactions = [];
    if (!data.supportChats) data.supportChats = {};
    return data;
  } catch (e) {
    return defaultDb;
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Database write error:', e.message);
  }
}

function readScanners() {
  try {
    if (!fs.existsSync(SCANNERS_FILE)) {
      fs.writeFileSync(SCANNERS_FILE, JSON.stringify(defaultScanners, null, 2), 'utf-8');
      return defaultScanners;
    }
    const data = JSON.parse(fs.readFileSync(SCANNERS_FILE, 'utf-8'));
    if (!Array.isArray(data.scanners)) {
      const list = [];
      if (data.scanner1) list.push({ id: "scan_1", ...data.scanner1 });
      if (data.scanner2) list.push({ id: "scan_2", ...data.scanner2 });
      if (data.scanner3) list.push({ id: "scan_3", ...data.scanner3 });
      data.scanners = list.length > 0 ? list : defaultScanners.scanners;
      writeScanners(data);
    }
    return data;
  } catch (e) {
    return defaultScanners;
  }
}

function writeScanners(data) {
  try {
    fs.writeFileSync(SCANNERS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Scanners write error:', e.message);
  }
}

// PRODUCTION-READY SSL TRANSPORTER CONFIGURATION (PORT 465)
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: (process.env.GMAIL_USER || '').trim(),
    pass: (process.env.GMAIL_APP_PASS || '').trim()
  },
  tls: {
    rejectUnauthorized: false
  }
});

// VERIFY SMTP CONNECTION AT SERVER STARTUP
transporter.verify((error, success) => {
  if (error) {
    console.error('❌ SMTP Connection Error:', error.message);
  } else {
    console.log('✅ SMTP Server is ready to send verification emails.');
  }
});

async function sendOtpEmail(toEmail, otpCode, purpose = 'Security Verification') {
  return await transporter.sendMail({
    from: `"${process.env.SENDER_NAME || 'ACPay Security'}" <${(process.env.GMAIL_USER || '').trim()}>`,
    to: toEmail,
    subject: `ACPay Verification Code: ${otpCode}`,
    html: `
      <div style="font-family: Arial, sans-serif; background: #0f172a; padding: 25px; color: #f8fafc;">
        <div style="max-width: 480px; margin: auto; background: #1e293b; border-radius: 16px; padding: 28px; border: 1px solid #334155; text-align: center;">
          <h2 style="color: #6366f1; margin: 0 0 8px 0;">ACPay Terminal</h2>
          <p style="color: #94a3b8; font-size: 14px;">Your code for <strong>${purpose}</strong> is:</p>
          <div style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #38bdf8; background: #0f172a; padding: 16px; border-radius: 12px; margin: 20px 0; border: 1px solid #38bdf840;">
            ${otpCode}
          </div>
          <p style="color: #64748b; font-size: 12px; margin: 0;">Expires in 5 minutes. Keep this private.</p>
        </div>
      </div>
    `
  });
}

// 5 FIXED PACKAGES CONFIGURED WITH EXACT 18% DAILY CLAIM YIELD
const BUY_PACKAGES = [
  { id: 'PKG-18K', amount: 18500, title: 'Starter Yield Tier', dailyIncome: 3330 },
  { id: 'PKG-36K', amount: 36500, title: 'Silver Growth Tier', dailyIncome: 6570 },
  { id: 'PKG-72K', amount: 72500, title: 'Gold Prime Tier', dailyIncome: 13050 },
  { id: 'PKG-144K', amount: 144500, title: 'Platinum VIP Tier', dailyIncome: 26010 },
  { id: 'PKG-200K', amount: 200500, title: 'Diamond Supreme Tier', dailyIncome: 36090 }
];

const regOtpStore = {};
const loginOtpStore = {};
const forgotOtpStore = {};

// PAGE ROUTING
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'payment.html')));

// MASTER ADMIN AUTH
app.post('/api/admin/verify-access', (req, res) => {
  const { email, pin } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPin = (pin || '').trim();

  if (cleanEmail === ADMIN_CONFIG.authorizedEmail && cleanPin === ADMIN_CONFIG.masterPin) {
    const adminToken = jwt.sign({ role: 'MASTER_ADMIN', email: cleanEmail }, JWT_SECRET, { expiresIn: '12h' });
    return res.json({ success: true, token: adminToken, message: 'Master Access Granted!' });
  }
  res.status(401).json({ error: 'Unauthorized: Invalid Admin Email or Master Security PIN.' });
});

// DYNAMIC SCANNER & BANK CONFIGS
app.get('/api/scanners/config', (req, res) => {
  res.json({ success: true, config: readScanners() });
});

app.post('/api/admin/update-scanners', (req, res) => {
  try {
    const updated = req.body;
    writeScanners(updated);
    res.json({ success: true, message: '✅ Live Scanners and Bank details updated successfully!', config: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to save scanner configuration.' });
  }
});

// USER REGISTRATION
app.post('/api/auth/register-send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid Gmail is required' });
  const cleanEmail = email.trim().toLowerCase();
  const db = readDb();
  if (db.users[cleanEmail]) return res.status(400).json({ error: 'Email already registered.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  regOtpStore[cleanEmail] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  try {
    await sendOtpEmail(cleanEmail, otp, 'Account Registration');
    res.json({ success: true, message: 'Registration OTP sent to your Gmail!' });
  } catch (err) {
    console.error('Registration email sending failure:', err);
    res.status(500).json({ error: 'Failed to send email.' });
  }
});

app.post('/api/auth/register-create-account', (req, res) => {
  const { email, otp, password, referralCode } = req.body;
  if (!email || !otp || !password) return res.status(400).json({ error: 'All fields required' });
  const cleanEmail = email.trim().toLowerCase();
  const record = regOtpStore[cleanEmail];

  if (!record || record.otp !== otp.trim() || Date.now() > record.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  const db = readDb();
  let referrerEmail = null;
  if (referralCode) {
    const cleanRef = referralCode.trim().toUpperCase();
    for (const em in db.users) {
      if (db.users[em].myReferralCode === cleanRef) {
        referrerEmail = em;
        break;
      }
    }
  }

  const newRefCode = 'AC-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  db.users[cleanEmail] = {
    uid: Math.floor(100000 + Math.random() * 900000).toString(),
    email: cleanEmail,
    password: password.trim(),
    balance: 0.00,
    todayEarn: 0.00,
    totalEarn: 0.00,
    myReferralCode: newRefCode,
    referredBy: referrerEmail,
    activePlans: [],
    upiList: [],
    createdAt: new Date().toLocaleString()
  };

  delete regOtpStore[cleanEmail];
  writeDb(db);
  res.json({ success: true, message: 'Account registered! Please sign in.' });
});

// USER LOGIN
app.post('/api/auth/login-send-otp', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];

  if (!user) return res.status(400).json({ error: 'Account not found. Register first.' });
  if (user.password !== (password || '').trim()) return res.status(400).json({ error: 'Incorrect password.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  loginOtpStore[cleanEmail] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  try {
    await sendOtpEmail(cleanEmail, otp, 'Sign-In Security Verification');
    res.json({ success: true, message: 'Sign-in OTP sent to your Gmail inbox!' });
  } catch (err) {
    console.error('Login email sending failure:', err);
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

app.post('/api/auth/login-verify', (req, res) => {
  const { email, password, otp } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];

  if (!user || user.password !== (password || '').trim()) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const record = loginOtpStore[cleanEmail];
  if (!record || record.otp !== (otp || '').trim() || Date.now() > record.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  delete loginOtpStore[cleanEmail];
  const token = jwt.sign({ email: user.email, uid: user.uid }, JWT_SECRET, { expiresIn: '7d' });
  const safeUser = { ...user };
  delete safeUser.password;

  res.json({ success: true, token, user: safeUser });
});

// FORGOT PASSWORD PIPELINE (3-STEP VERIFICATION)
app.post('/api/auth/forgot-send-otp', async (req, res) => {
  const { email } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = readDb();

  if (!db.users[cleanEmail]) return res.status(404).json({ error: 'No account registered with this email.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  forgotOtpStore[cleanEmail] = { otp, expires: Date.now() + 5 * 60 * 1000, verified: false };

  try {
    await sendOtpEmail(cleanEmail, otp, 'Password Reset Request');
    res.json({ success: true, message: 'Password reset OTP sent to your Gmail!' });
  } catch (err) {
    console.error('Forgot password email sending failure:', err);
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

app.post('/api/auth/forgot-verify-otp', (req, res) => {
  const { email, otp } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const record = forgotOtpStore[cleanEmail];

  if (!record || record.otp !== (otp || '').trim() || Date.now() > record.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP. Please try again.' });
  }

  record.verified = true;
  res.json({ success: true, message: 'OTP verified successfully! Please enter your new password.' });
});

app.post('/api/auth/forgot-reset-password', (req, res) => {
  const { email, newPassword, confirmPassword } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const record = forgotOtpStore[cleanEmail];

  if (!record || !record.verified) {
    return res.status(400).json({ error: 'Unauthorized: OTP verification required before resetting password.' });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Password must be at least 4 characters long.' });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match. Please retype carefully.' });
  }

  const db = readDb();
  if (db.users[cleanEmail]) {
    db.users[cleanEmail].password = newPassword.trim();
    writeDb(db);
    delete forgotOtpStore[cleanEmail];
    return res.json({ success: true, message: 'Password updated successfully! Please sign in with your new password.' });
  }
  res.status(404).json({ error: 'User account not found.' });
});

// 3-DAY REFERRAL & 6-DAY 18% LIFECYCLE
app.get('/api/user/yield-status', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const plan = (user.activePlans || [])[0];
  if (!plan) {
    return res.json({ hasActivePlan: false, message: 'No active plan. Deposit to activate 3-Day Referral Window.' });
  }

  const now = Date.now();
  const refWindowExpiresAt = plan.purchaseTimestamp + (3 * 24 * 60 * 60 * 1000);
  const isRefOfferExpired = now > refWindowExpiresAt;
  const nextClaimTime = (plan.lastClaimTimestamp || 0) + (24 * 60 * 60 * 1000);
  const canClaimNow = isRefOfferExpired && (plan.completedClaims < 6) && (now >= nextClaimTime);
  const refTimeRemainingMs = Math.max(0, refWindowExpiresAt - now);

  res.json({
    hasActivePlan: true,
    planTitle: plan.title,
    planAmount: plan.amount,
    daily18Rate: plan.amount * 0.18,
    isRefOfferExpired,
    refTimeRemainingMs,
    completedClaims: plan.completedClaims || 0,
    isFullyUnlocked: (plan.completedClaims || 0) >= 6,
    canClaimNow,
    nextClaimTime
  });
});

app.post('/api/user/claim-daily-18', (req, res) => {
  const cleanEmail = (req.body.email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];
  if (!user) return res.status(404).json({ error: 'User not found' });

  const plan = (user.activePlans || [])[0];
  if (!plan) return res.status(400).json({ error: 'No active plan found.' });

  const now = Date.now();
  const refWindowExpiresAt = plan.purchaseTimestamp + (3 * 24 * 60 * 60 * 1000);

  if (now <= refWindowExpiresAt) {
    return res.status(400).json({ error: 'The 3-day referral window is still active! Refer a friend to get instant bonus.' });
  }

  if (plan.completedClaims >= 6) {
    return res.status(400).json({ error: 'All 6 days of 18% claims are already completed! Payout is unlocked.' });
  }

  const nextClaimTime = (plan.lastClaimTimestamp || 0) + (24 * 60 * 60 * 1000);
  if (plan.lastClaimTimestamp && now < nextClaimTime) {
    const hoursLeft = Math.ceil((nextClaimTime - now) / (1000 * 60 * 60));
    return res.status(400).json({ error: `Next 18% claim available in ${hoursLeft} hours.` });
  }

  const claimAmount = plan.amount * 0.18;
  plan.completedClaims = (plan.completedClaims || 0) + 1;
  plan.lastClaimTimestamp = now;
  user.balance += claimAmount;
  user.todayEarn = claimAmount;
  user.totalEarn += claimAmount;

  if (plan.completedClaims >= 6) {
    plan.isUnlockedForWithdrawal = true;
    db.activityLogs.unshift({
      user: cleanEmail,
      action: `Completed 6/6 Days of 18% Claims! Full capital (₹${plan.amount.toLocaleString()}) & yield unlocked for withdrawal.`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString()
    });
  } else {
    db.activityLogs.unshift({
      user: cleanEmail,
      action: `Claimed Day ${plan.completedClaims}/6 Daily 18% Yield (+₹${claimAmount.toLocaleString()})`,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      date: new Date().toLocaleDateString()
    });
  }

  writeDb(db);
  res.json({
    success: true,
    message: `Claimed Day ${plan.completedClaims}/6! ₹${claimAmount.toLocaleString()} credited to balance.`,
    completedClaims: plan.completedClaims,
    balance: user.balance,
    isFullyUnlocked: plan.completedClaims >= 6
  });
});

// UTR & RECEIPT SCREENSHOT SUBMISSION
app.post('/api/user/submit-utr', (req, res) => {
  const { email, amount, utr, selectedScanner, packageId, screenshot } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanUtr = (utr || '').trim();
  const num = parseFloat(amount);

  if (!cleanUtr || cleanUtr.length < 8) {
    return res.status(400).json({ error: 'Please enter a valid 12-digit UTR reference number' });
  }

  if (!screenshot) {
    return res.status(400).json({ error: 'Please upload your payment screenshot/receipt slip.' });
  }

  const db = readDb();
  const isDuplicate = db.pendingUtrSlips.some(s => s.utr === cleanUtr);
  if (isDuplicate) {
    return res.status(400).json({ error: 'This UTR has already been submitted and is in the queue.' });
  }

  const newSlip = {
    id: `UTR-${Math.floor(100000 + Math.random() * 900000)}`,
    email: cleanEmail,
    amount: isNaN(num) ? 18500 : num,
    packageId: packageId || 'CUSTOM',
    utr: cleanUtr,
    screenshot: screenshot,
    scannerUsed: selectedScanner || 'Scanner 1',
    date: new Date().toLocaleString(),
    timestamp: Date.now(),
    status: 'Pending Admin Verification'
  };

  db.pendingUtrSlips.unshift(newSlip);
  writeDb(db);
  res.json({ success: true, message: 'Receipt submitted! Admin will verify your payment screenshot and UTR.', slip: newSlip });
});

// RESOLVE UTR
app.post('/api/admin/resolve-utr', (req, res) => {
  const { id, action } = req.body;
  const db = readDb();
  const idx = db.pendingUtrSlips.findIndex(s => s.id === id);

  if (idx !== -1) {
    const slip = db.pendingUtrSlips[idx];
    
    db.completedTransactions.unshift({
      id: slip.id,
      email: slip.email,
      type: 'DEPOSIT',
      amount: slip.amount,
      method: slip.scannerUsed,
      refNumber: slip.utr,
      screenshot: slip.screenshot || '',
      status: action === 'approve' ? 'APPROVED' : 'REJECTED',
      timestamp: Date.now(),
      date: new Date().toLocaleString()
    });

    if (action === 'approve') {
      const user = db.users[slip.email];
      if (user) {
        user.balance += slip.amount;

        const pkg = BUY_PACKAGES.find(p => p.amount === slip.amount) || {
          id: 'CUSTOM',
          amount: slip.amount,
          title: `Custom Investment Tier (₹${slip.amount})`,
          dailyIncome: Math.round(slip.amount * 0.18)
        };

        user.activePlans = [{
          planId: pkg.id,
          amount: pkg.amount,
          title: pkg.title,
          purchaseTimestamp: Date.now(),
          purchaseDate: new Date().toLocaleString(),
          completedClaims: 0,
          lastClaimTimestamp: 0,
          isUnlockedForWithdrawal: false
        }];

        db.activityLogs.unshift({
          user: slip.email,
          action: `Plan Activated: ${pkg.title} (₹${slip.amount.toLocaleString()}) via verified receipt.`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toLocaleDateString()
        });

        if (user.referredBy && db.users[user.referredBy]) {
          const referrer = db.users[user.referredBy];
          const refPlan = (referrer.activePlans || [])[0];
          const isReferrerEligible = refPlan && (Date.now() <= refPlan.purchaseTimestamp + (3 * 24 * 60 * 60 * 1000));

          if (isReferrerEligible) {
            const totalIncentive = (pkg.amount * 0.30) + 800;
            referrer.balance += totalIncentive;
            referrer.totalEarn += totalIncentive;

            db.activityLogs.unshift({
              user: user.referredBy,
              action: `3-Day Referral Reward: ₹${totalIncentive.toFixed(2)} (30% + ₹800 from ${slip.email})`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              date: new Date().toLocaleDateString()
            });
          }
        }
      }
    }

    db.pendingUtrSlips.splice(idx, 1);
    writeDb(db);
    return res.json({ success: true, message: `UTR Slip ${action}d successfully!` });
  }
  res.status(404).json({ error: 'Slip not found' });
});

// WITHDRAWAL
app.post('/api/user/withdraw', (req, res) => {
  const { email, amount, paymentMethod } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];

  if (!user) return res.status(404).json({ error: 'User not found' });

  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return res.status(400).json({ error: 'Enter a valid amount' });
  if (user.balance < num) return res.status(400).json({ error: 'Insufficient balance' });

  const plan = (user.activePlans || [])[0];
  if (plan && !plan.isUnlockedForWithdrawal && (plan.completedClaims || 0) < 6) {
    return res.status(400).json({
      error: `Withdrawal Locked: You must complete all 6 days of 18% claims (${plan.completedClaims || 0}/6 completed).`
    });
  }

  user.balance -= num;
  const reqItem = {
    id: `WTH-${Math.floor(10000 + Math.random() * 90000)}`,
    email: cleanEmail,
    amount: num,
    paymentMethod: paymentMethod || 'Bound Account',
    date: new Date().toLocaleString(),
    timestamp: Date.now(),
    status: 'Pending Admin Transfer'
  };

  db.withdrawalRequests.unshift(reqItem);
  db.activityLogs.unshift({
    user: cleanEmail,
    action: `Requested withdrawal of ₹${num.toLocaleString()} to ${paymentMethod}`,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    date: new Date().toLocaleDateString()
  });

  writeDb(db);
  res.json({ success: true, message: 'Withdrawal submitted to Admin!', balance: user.balance });
});

// 1-YEAR TRANSACTION HISTORY
app.get('/api/user/transactions', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  const db = readDb();
  const now = Date.now();
  const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);

  const userLedger = (db.completedTransactions || []).filter(t => t.email === cleanEmail);
  const pendingDeposits = (db.pendingUtrSlips || []).filter(s => s.email === cleanEmail).map(s => ({
    id: s.id,
    email: s.email,
    type: 'DEPOSIT',
    amount: s.amount,
    method: s.scannerUsed,
    refNumber: s.utr,
    screenshot: s.screenshot || '',
    status: 'PENDING',
    date: s.date,
    timestamp: s.timestamp || now
  }));

  const pendingWithdrawals = (db.withdrawalRequests || []).filter(w => w.email === cleanEmail).map(w => ({
    id: w.id,
    email: w.email,
    type: 'WITHDRAWAL',
    amount: w.amount,
    method: w.paymentMethod,
    refNumber: w.id,
    status: 'PENDING',
    date: w.date,
    timestamp: w.timestamp || now
  }));

  const allTx = [...userLedger, ...pendingDeposits, ...pendingWithdrawals].sort((a, b) => b.timestamp - a.timestamp);

  let deposit1Year = 0;
  let withdraw1Year = 0;

  userLedger.forEach(t => {
    if (t.status === 'APPROVED') {
      if (t.type === 'DEPOSIT' && t.timestamp >= oneYearAgo) deposit1Year += t.amount;
      if (t.type === 'WITHDRAWAL' && t.timestamp >= oneYearAgo) withdraw1Year += t.amount;
    }
  });

  res.json({
    success: true,
    summary: {
      deposit1Year,
      withdraw1Year,
      net1Year: deposit1Year - withdraw1Year,
      totalCount: allTx.length
    },
    transactions: allTx
  });
});

// ADMIN AUDIT APIS
app.get('/api/admin/all-user-ledgers', (req, res) => {
  const db = readDb();
  const now = Date.now();
  const oneYearAgo = now - (365 * 24 * 60 * 60 * 1000);

  const usersLedgerSummary = Object.keys(db.users).map(email => {
    const user = db.users[email];
    let dep1Y = 0;
    let wth1Y = 0;

    (db.completedTransactions || []).filter(t => t.email === email && t.status === 'APPROVED').forEach(t => {
      if (t.type === 'DEPOSIT' && t.timestamp >= oneYearAgo) dep1Y += t.amount;
      if (t.type === 'WITHDRAWAL' && t.timestamp >= oneYearAgo) wth1Y += t.amount;
    });

    return {
      email,
      uid: user.uid,
      balance: user.balance,
      deposit1Year: dep1Y,
      withdraw1Year: wth1Y,
      activePlansCount: (user.activePlans || [])[0] ? 1 : 0
    };
  });

  res.json({ success: true, ledgers: usersLedgerSummary });
});

app.get('/api/admin/user-claim-status', (req, res) => {
  const db = readDb();
  const now = Date.now();

  const statuses = Object.keys(db.users).map(email => {
    const user = db.users[email];
    const plan = (user.activePlans || [])[0];

    if (!plan) {
      return { email, uid: user.uid, status: 'No Active Deposit', badge: 'gray', progress: '0/6 Claims' };
    }

    const refExpiresAt = plan.purchaseTimestamp + (3 * 24 * 60 * 60 * 1000);
    if (now <= refExpiresAt) {
      const hoursLeft = Math.ceil((refExpiresAt - now) / (1000 * 60 * 60));
      return {
        email,
        uid: user.uid,
        status: `3-Day Referral Window (${hoursLeft}h left)`,
        badge: 'purple',
        progress: 'Referral Window Active'
      };
    }

    return {
      email,
      uid: user.uid,
      status: (plan.completedClaims || 0) >= 6 ? 'Unlocked for Payout' : `Day ${(plan.completedClaims || 0)}/6 Claimed (18%)`,
      badge: (plan.completedClaims || 0) >= 6 ? 'emerald' : 'amber',
      progress: `${plan.completedClaims || 0}/6 Claims Completed`
    };
  });

  res.json({ success: true, statuses });
});

// CHAT APIS
app.get('/api/chat/history', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  const db = readDb();
  res.json({ success: true, messages: db.supportChats[cleanEmail] || [] });
});

app.post('/api/chat/send', (req, res) => {
  const { email, text, sender } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanText = (text || '').trim();
  if (!cleanEmail || !cleanText) return res.status(400).json({ error: 'Invalid message.' });

  const db = readDb();
  if (!db.supportChats[cleanEmail]) db.supportChats[cleanEmail] = [];

  const messageItem = {
    id: `MSG-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    sender: sender || 'user',
    text: cleanText,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: Date.now()
  };

  db.supportChats[cleanEmail].push(messageItem);
  writeDb(db);
  res.json({ success: true, message: messageItem });
});

app.get('/api/admin/chat-threads', (req, res) => {
  const db = readDb();
  const threads = Object.keys(db.supportChats).map(email => {
    const list = db.supportChats[email];
    const lastMsg = list.length > 0 ? list[list.length - 1] : null;
    return {
      email,
      lastMessage: lastMsg ? lastMsg.text : '',
      lastTime: lastMsg ? lastMsg.time : '',
      lastSender: lastMsg ? lastMsg.sender : 'user',
      unreadCount: list.filter(m => m.sender === 'user').length
    };
  });
  res.json({ success: true, threads });
});

// PROFILE & DETAILS
app.get('/api/user/profile', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];
  if (!user) return res.status(404).json({ error: 'User not found' });
  const safe = { ...user };
  delete safe.password;
  res.json({ success: true, user: safe });
});

app.get('/api/user/activity', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  const db = readDb();
  res.json({ success: true, logs: db.activityLogs.filter(l => l.user === cleanEmail) });
});

app.post('/api/user/add-upi', (req, res) => {
  const { email, upiId, bankName, accountNumber, ifsc } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const db = readDb();
  const user = db.users[cleanEmail];
  if (!user) return res.status(404).json({ error: 'User not found' });

  user.upiList.push({
    upiId: (upiId || '').trim(),
    bankName: (bankName || 'Direct UPI Bank').trim(),
    accountNumber: (accountNumber || '').trim(),
    ifsc: (ifsc || '').trim().toUpperCase(),
    addedAt: new Date().toLocaleString()
  });

  writeDb(db);
  res.json({ success: true, message: 'Settlement account bound!', upiList: user.upiList });
});

app.get('/api/packages/list', (req, res) => res.json({ success: true, packages: BUY_PACKAGES }));
app.get('/api/admin/all-users', (req, res) => res.json({ success: true, users: Object.values(readDb().users) }));
app.get('/api/admin/utr-slips', (req, res) => res.json({ success: true, slips: readDb().pendingUtrSlips }));
app.get('/api/admin/withdrawals', (req, res) => res.json({ success: true, withdrawals: readDb().withdrawalRequests }));

app.post('/api/admin/approve-withdrawal', (req, res) => {
  const { id, action } = req.body;
  const db = readDb();
  const idx = db.withdrawalRequests.findIndex(w => w.id === id);
  if (idx !== -1) {
    const item = db.withdrawalRequests[idx];
    if (action === 'reject' && db.users[item.email]) db.users[item.email].balance += item.amount;
    db.withdrawalRequests.splice(idx, 1);
    writeDb(db);
    return res.json({ success: true, message: `Withdrawal ${action}d` });
  }
  res.status(404).json({ error: 'Request not found' });
});

app.listen(PORT, () => console.log(`ACPay Production Server running on port ${PORT}`));