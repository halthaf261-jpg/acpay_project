const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ limit: '25mb', extended: true }));

// Transporter with SSL (Port 465) for Gmail App Passwords
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: (process.env.EMAIL_USER || '').trim(),
    pass: (process.env.EMAIL_PASS || '').trim()
  }
});

transporter.verify((error) => {
  if (error) {
    console.error('SMTP Connection Warning:', error.message);
  } else {
    console.log('Real Gmail SMTP Server is ready to dispatch OTPs.');
  }
});

// Paths to storage files
const SCANNERS_FILE = path.join(__dirname, 'scanners_config.json');

const defaultScanners = {
  scanner1: {
    title: "Primary Fast Scanner (PhonePe / GPay)",
    upiVpa: "9381136860@ybl",
    accountName: "Althaf Hussain",
    image: ""
  },
  scanner2: {
    title: "Backup Business Scanner (Paytm / BHIM)",
    upiVpa: "9381136860@ibl",
    accountName: "Althaf Hussain (Business)",
    image: ""
  },
  companyBank: {
    bankName: "State Bank of India",
    accountHolder: "Althaf Hussain",
    accountNumber: "42971394203",
    ifsc: "SBIN0000977"
  }
};

function getScannersConfig() {
  try {
    if (!fs.existsSync(SCANNERS_FILE)) {
      fs.writeFileSync(SCANNERS_FILE, JSON.stringify(defaultScanners, null, 2), 'utf-8');
      return defaultScanners;
    }
    return JSON.parse(fs.readFileSync(SCANNERS_FILE, 'utf-8'));
  } catch (err) {
    return defaultScanners;
  }
}

// 5 Core Packages
const BUY_PACKAGES = [
  { id: 'PKG-1', amount: 18500, title: 'Starter Package', dailyIncome: 536.50 },
  { id: 'PKG-2', amount: 36500, title: 'Silver Package', dailyIncome: 1058.50 },
  { id: 'PKG-3', amount: 72500, title: 'Gold Package', dailyIncome: 2102.50 },
  { id: 'PKG-4', amount: 144500, title: 'Platinum Package', dailyIncome: 4190.50 },
  { id: 'PKG-5', amount: 200500, title: 'Diamond VIP Package', dailyIncome: 5814.50 }
];

// In-Memory Collections
const users = {};
const regOtpStore = {};
const loginOtpStore = {};
const pendingUtrSlips = [];
const withdrawalRequests = [];
const activityLogs = [];

// Static Web Pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/payment', (req, res) => res.sendFile(path.join(__dirname, 'payment.html')));

// 1. Send Registration OTP
app.post('/api/auth/register-send-otp', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid Gmail address required' });

  const cleanEmail = email.trim().toLowerCase();
  if (users[cleanEmail]) return res.status(400).json({ error: 'Email already registered. Please sign in.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  regOtpStore[cleanEmail] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  console.log(`[REGISTRATION] Sending OTP ${otp} to ${cleanEmail}`);

  try {
    await transporter.sendMail({
      from: `"ACPay Registration" <${(process.env.EMAIL_USER || '').trim()}>`,
      to: cleanEmail,
      subject: 'ACPay Account Registration Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f6f7fb;">
          <div style="max-width: 480px; margin: auto; background: white; padding: 30px; border-radius: 16px; border: 1px solid #e2e8f0;">
            <h2 style="color: #6440fe; margin-top: 0;">Welcome to ACPay</h2>
            <p style="color: #475569; font-size: 14px;">Your registration verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e1b4b; background: #ede9fe; padding: 15px; text-align: center; border-radius: 12px; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #64748b; font-size: 12px;">Valid for 5 minutes. Enter this code to set your account password.</p>
          </div>
        </div>
      `
    });
    res.json({ success: true, message: 'OTP sent to your Gmail inbox!' });
  } catch (err) {
    console.error('Mail error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP. Check your .env EMAIL_USER and EMAIL_PASS.' });
  }
});

// 2. Register Account with Custom Password & Referral Code
app.post('/api/auth/register-create-account', (req, res) => {
  const { email, otp, password, referralCode } = req.body;
  if (!email || !otp || !password) return res.status(400).json({ error: 'All fields are required' });

  const cleanEmail = email.trim().toLowerCase();
  const record = regOtpStore[cleanEmail];

  if (!record || record.otp !== otp.trim() || Date.now() > record.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  let referrerEmail = null;
  if (referralCode) {
    const cleanRefCode = referralCode.trim().toUpperCase();
    for (const em in users) {
      if (users[em].myReferralCode === cleanRefCode) {
        referrerEmail = em;
        break;
      }
    }
  }

  const newRefCode = 'AC-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  users[cleanEmail] = {
    email: cleanEmail,
    uid: Math.floor(100000 + Math.random() * 900000).toString(),
    level: 'Lv.1 Novice',
    password: password.trim(),
    balance: 0.00,
    todayEarn: 0.00,
    totalEarn: 0.00,
    myReferralCode: newRefCode,
    referredBy: referrerEmail,
    activePlans: [],
    upiList: [],
    pinCode: '',
    createdAt: new Date().toLocaleString()
  };

  delete regOtpStore[cleanEmail];
  res.json({ success: true, message: 'Account registered successfully! Please sign in.' });
});

// 3. Login Security OTP
app.post('/api/auth/login-send-otp', async (req, res) => {
  const { email, password } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = users[cleanEmail];

  if (!user) return res.status(400).json({ error: 'No account registered with this Gmail.' });
  if (user.password !== (password || '').trim()) return res.status(400).json({ error: 'Incorrect password.' });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  loginOtpStore[cleanEmail] = { otp, expires: Date.now() + 5 * 60 * 1000 };

  console.log(`[LOGIN] Sending OTP ${otp} to ${cleanEmail}`);

  try {
    await transporter.sendMail({
      from: `"ACPay Security" <${(process.env.EMAIL_USER || '').trim()}>`,
      to: cleanEmail,
      subject: 'ACPay Sign-In Verification Code',
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #f6f7fb;">
          <div style="max-width: 480px; margin: auto; background: white; padding: 30px; border-radius: 16px; border: 1px solid #e2e8f0;">
            <h2 style="color: #6440fe; margin-top: 0;">ACPay Sign-In Verification</h2>
            <p style="color: #475569; font-size: 14px;">Your login verification code is:</p>
            <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #1e1b4b; background: #ede9fe; padding: 15px; text-align: center; border-radius: 12px; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #64748b; font-size: 12px;">Valid for 5 minutes.</p>
          </div>
        </div>
      `
    });
    res.json({ success: true, message: 'Verification OTP sent to your Gmail inbox!' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// 4. Verify Login Credentials
app.post('/api/auth/login-verify', (req, res) => {
  const { email, password, otp } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = users[cleanEmail];

  if (!user || user.password !== (password || '').trim()) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const record = loginOtpStore[cleanEmail];
  if (!record || record.otp !== (otp || '').trim() || Date.now() > record.expires) {
    return res.status(400).json({ error: 'Invalid or expired OTP' });
  }

  delete loginOtpStore[cleanEmail];
  res.json({ success: true, user });
});

// 5. Package Management
app.get('/api/packages/list', (req, res) => {
  res.json({ success: true, packages: BUY_PACKAGES });
});

// 6. Two-Scanner Config Endpoints
app.get('/api/scanners/config', (req, res) => {
  res.json({ success: true, config: getScannersConfig() });
});

app.post('/api/admin/update-scanners', (req, res) => {
  try {
    const updated = req.body;
    fs.writeFileSync(SCANNERS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
    res.json({ success: true, message: 'Both scanners updated in scanners_config.json!', config: updated });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write scanners_config.json' });
  }
});

// 7. Submit Payment UTR Slip
app.post('/api/user/submit-utr', (req, res) => {
  const { email, amount, utr, selectedScanner } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const num = parseFloat(amount);

  if (!utr || utr.trim().length < 8) {
    return res.status(400).json({ error: 'Please enter a valid 12-digit UTR reference number' });
  }

  const newSlip = {
    id: `UTR-${Math.floor(100000 + Math.random() * 900000)}`,
    email: cleanEmail,
    amount: isNaN(num) ? 500 : num,
    utr: utr.trim(),
    scannerUsed: selectedScanner || 'Scanner 1',
    date: new Date().toLocaleString(),
    status: 'Pending'
  };

  pendingUtrSlips.unshift(newSlip);
  console.log(`[PAYMENT] Received UTR ${utr} from ${cleanEmail} for ₹${num}`);
  res.json({ success: true, message: 'UTR submitted for verification!', slip: newSlip });
});

// 8. User Activity Logs
app.get('/api/user/activity', (req, res) => {
  const cleanEmail = (req.query.email || '').trim().toLowerCase();
  res.json({ success: true, logs: activityLogs.filter(l => l.user === cleanEmail) });
});

// 9. Add UPI / Bank Account
app.post('/api/user/add-upi', (req, res) => {
  const cleanEmail = (req.body.email || '').trim().toLowerCase();
  const { upiId, bankName, accNumber } = req.body;

  if (users[cleanEmail]) {
    users[cleanEmail].upiList.push({
      upiId: (upiId || '').trim(),
      bankName: (bankName || 'Standard Bank').trim(),
      accNumber: (accNumber || '').trim(),
      date: new Date().toLocaleDateString()
    });
    return res.json({ success: true, upiList: users[cleanEmail].upiList });
  }
  res.status(404).json({ error: 'User not found' });
});

// 10. Withdrawals (24h lock enforced)
app.post('/api/user/withdraw', (req, res) => {
  const { email, amount, upiId } = req.body;
  const cleanEmail = (email || '').trim().toLowerCase();
  const user = users[cleanEmail];

  if (!user) return res.status(404).json({ error: 'User not found' });

  const num = parseFloat(amount);
  if (isNaN(num) || num <= 0) return res.status(400).json({ error: 'Enter valid amount' });
  if (user.balance < num) return res.status(400).json({ error: 'Insufficient balance' });

  const hasLockedPlan = user.activePlans.some(p => Date.now() < p.unlockTimestamp);
  if (hasLockedPlan) {
    return res.status(400).json({ error: 'Withdrawal locked: Available 24 hours after plan purchase!' });
  }

  user.balance -= num;
  const reqItem = {
    id: `WTH-${Math.floor(10000 + Math.random() * 90000)}`,
    email: cleanEmail,
    amount: num,
    upiId,
    date: new Date().toLocaleString()
  };

  withdrawalRequests.unshift(reqItem);
  res.json({ success: true, message: 'Withdrawal request transmitted to Admin!', user });
});

// 11. Admin Endpoints: Approve UTRs & Modify Points
app.get('/api/admin/all-users', (req, res) => {
  res.json({ success: true, users: Object.values(users) });
});

app.get('/api/admin/utr-slips', (req, res) => {
  res.json({ success: true, slips: pendingUtrSlips });
});

app.post('/api/admin/resolve-utr', (req, res) => {
  const { id, action } = req.body;
  const idx = pendingUtrSlips.findIndex(s => s.id === id);
  if (idx !== -1) {
    const slip = pendingUtrSlips[idx];
    if (action === 'approve') {
      const user = users[slip.email];
      if (user) {
        user.balance += slip.amount;

        const pkg = BUY_PACKAGES.find(p => p.amount === slip.amount) || {
          id: 'CUSTOM',
          amount: slip.amount,
          title: `Investment Plan (₹${slip.amount})`,
          dailyIncome: Math.round(slip.amount * 0.029)
        };

        user.todayEarn += pkg.dailyIncome;
        user.totalEarn += pkg.dailyIncome;
        user.activePlans.push({
          planId: pkg.id,
          amount: pkg.amount,
          title: pkg.title,
          date: new Date().toLocaleString(),
          unlockTimestamp: Date.now() + (24 * 60 * 60 * 1000)
        });

        activityLogs.unshift({
          user: slip.email,
          action: `Plan Activated via Approved UTR ${slip.utr} (₹${slip.amount.toLocaleString()})`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          date: new Date().toLocaleDateString()
        });

        // 30% + ₹800 Referral Reward Rule
        if (user.referredBy && users[user.referredBy]) {
          const referrer = users[user.referredBy];
          const totalIncentive = (pkg.amount * 0.30) + 800;
          referrer.balance += totalIncentive;
          referrer.totalEarn += totalIncentive;

          activityLogs.unshift({
            user: user.referredBy,
            action: `Referral Incentive: ₹${totalIncentive.toFixed(2)} (30% + ₹800 from ${slip.email})`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            date: new Date().toLocaleDateString()
          });
        }
      }
    }
    pendingUtrSlips.splice(idx, 1);
    return res.json({ success: true, message: `UTR ${action}d successfully!` });
  }
  res.status(404).json({ error: 'UTR record not found' });
});

app.get('/api/admin/withdrawals', (req, res) => {
  res.json({ success: true, withdrawals: withdrawalRequests });
});

app.post('/api/admin/approve-withdrawal', (req, res) => {
  const { id, action } = req.body;
  const idx = withdrawalRequests.findIndex(w => w.id === id);
  if (idx !== -1) {
    const item = withdrawalRequests[idx];
    if (action === 'reject' && users[item.email]) {
      users[item.email].balance += item.amount;
    }
    withdrawalRequests.splice(idx, 1);
    return res.json({ success: true, message: `Withdrawal ${action}d` });
  }
  res.status(404).json({ error: 'Request not found' });
});

app.post('/api/admin/update-user-points', (req, res) => {
  const cleanEmail = (req.body.email || '').trim().toLowerCase();
  if (!users[cleanEmail]) return res.status(404).json({ error: 'User not found' });

  const { balance, todayEarn, totalEarn } = req.body;
  if (balance !== undefined) users[cleanEmail].balance = parseFloat(balance);
  if (todayEarn !== undefined) users[cleanEmail].todayEarn = parseFloat(todayEarn);
  if (totalEarn !== undefined) users[cleanEmail].totalEarn = parseFloat(totalEarn);

  res.json({ success: true, message: 'User balances updated', user: users[cleanEmail] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ACPay Server active at http://localhost:${PORT}`));