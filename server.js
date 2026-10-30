require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'acpay_secret_key_12345';

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// In-Memory Data Storage
const otpStore = {};
const users = {};
const deposits = [];
const withdrawals = [];
const userPlans = [];

// Helper: Dispatch Email via Brevo REST API
async function sendBrevoEmail(toEmail, otpCode) {
  const payload = {
    sender: { name: "ACPay", email: "halthaf261@gmail.com" },
    to: [{ email: toEmail }],
    subject: "Your ACPay Verification Code",
    htmlContent: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2 style="color: #6440fe;">ACPay Terminal Verification</h2>
        <p>Your one-time security code is:</p>
        <h1 style="background: #f1f5f9; padding: 12px 24px; display: inline-block; letter-spacing: 5px; border-radius: 8px; color: #0f172a;">
          ${otpCode}
        </h1>
        <p>This code will expire in 5 minutes. If you did not request this, please ignore this email.</p>
      </div>
    `
  };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || 'Brevo API rejected the dispatch');
  }
  return data;
}

// 1. REGISTRATION: Send OTP
app.post(['/api/auth/register-send-otp', '/send-otp'], async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, error: 'Email is required' });

  const cleanEmail = email.toLowerCase().trim();
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[cleanEmail] = {
    otp: generatedOtp,
    expires: Date.now() + 5 * 60 * 1000
  };

  try {
    await sendBrevoEmail(cleanEmail, generatedOtp);
    console.log(`[ACPay] Register OTP dispatched to ${cleanEmail}`);
    return res.json({ success: true, message: 'OTP sent successfully' });
  } catch (err) {
    console.error('[ACPay] Brevo dispatch error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Failed to dispatch email' });
  }
});

// 2. REGISTRATION: Verify & Create Account
app.post(['/api/auth/register-create-account', '/register'], (req, res) => {
  const { email, password, otp, referralCode } = req.body;
  if (!email || !otp || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const record = otpStore[cleanEmail];
  if (!record) return res.status(400).json({ success: false, error: 'Please request an OTP first' });
  if (Date.now() > record.expires) {
    delete otpStore[cleanEmail];
    return res.status(400).json({ success: false, error: 'OTP has expired' });
  }
  if (record.otp !== otp.trim()) {
    return res.status(400).json({ success: false, error: 'Invalid OTP code' });
  }

  delete otpStore[cleanEmail];

  const cleanRef = referralCode ? referralCode.trim().toUpperCase() : null;
  const uid = Math.floor(100000 + Math.random() * 900000).toString();
  const myReferralCode = 'AC-' + Math.random().toString(36).substring(2, 7).toUpperCase();

  users[cleanEmail] = {
    uid,
    email: cleanEmail,
    password,
    myReferralCode,
    referredBy: cleanRef,
    balance: 0.00,
    todayEarn: 0.00,
    totalEarn: 0.00,
    referralIncentivesEarned: 0,
    upiList: []
  };

  console.log(`[ACPay] Registered user: ${cleanEmail} (Referral Code: ${myReferralCode})`);
  return res.json({ success: true, message: 'Account registered successfully!' });
});

// 3. LOGIN: Send OTP
app.post('/api/auth/login-send-otp', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, error: 'Email and password are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const user = users[cleanEmail];

  if (!user) {
    return res.status(400).json({ success: false, error: 'Account not found. Please click Register Account first.' });
  }
  if (user.password !== password) {
    return res.status(400).json({ success: false, error: 'Incorrect password.' });
  }

  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore[cleanEmail] = {
    otp: generatedOtp,
    expires: Date.now() + 5 * 60 * 1000
  };

  try {
    await sendBrevoEmail(cleanEmail, generatedOtp);
    console.log(`[ACPay] Login OTP dispatched to ${cleanEmail}`);
    return res.json({ success: true, message: 'Security code sent to your Gmail.' });
  } catch (err) {
    console.error('[ACPay] Login OTP dispatch error:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'Error delivering email.' });
  }
});

// 4. LOGIN: Verify & Authenticate
app.post(['/api/auth/login-verify', '/api/auth/login'], (req, res) => {
  const { email, password, otp } = req.body;
  const cleanEmail = email?.toLowerCase().trim();
  const user = users[cleanEmail];

  if (!user || user.password !== password) {
    return res.status(400).json({ success: false, error: 'Invalid email or password' });
  }

  if (otp) {
    const record = otpStore[cleanEmail];
    if (!record || record.otp !== otp.trim()) {
      return res.status(400).json({ success: false, error: 'Invalid or expired OTP' });
    }
    delete otpStore[cleanEmail];
  }

  const token = jwt.sign({ email: user.email, uid: user.uid }, JWT_SECRET, { expiresIn: '7d' });
  return res.json({ success: true, user, token });
});

// 5. USER PROFILE DATA
app.get('/api/user/profile', (req, res) => {
  const cleanEmail = req.query.email?.toLowerCase().trim();
  const user = users[cleanEmail];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const downline = Object.values(users).filter(u => u.referredBy === user.myReferralCode);
  const activeReferrals = downline.filter(u => userPlans.some(p => p.email === u.email));

  return res.json({
    success: true,
    user: {
      ...user,
      downlineCount: downline.length,
      activeDownlineCount: activeReferrals.length
    }
  });
});

// 6. PACKAGES LIST (18500, 36500, 72500, 144500, and +200500)
app.get('/api/packages/list', (req, res) => {
  return res.json({
    success: true,
    packages: [
      { id: 'plan-18500', title: 'Tier 1 Prime', amount: 18500, dailyReturn: 1850 },
      { id: 'plan-36500', title: 'Tier 2 Elite', amount: 36500, dailyReturn: 3800 },
      { id: 'plan-72500', title: 'Tier 3 Master', amount: 72500, dailyReturn: 8000 },
      { id: 'plan-144500', title: 'Tier 4 Apex', amount: 144500, dailyReturn: 16500 },
      { id: 'plan-200500', title: 'Tier 5 Ultra (+200.5K)', amount: 200500, dailyReturn: 24000 }
    ]
  });
});

// 7. USER ACTIVITY & REFERRAL TREE
app.get('/api/user/activity-and-tree', (req, res) => {
  const cleanEmail = req.query.email?.toLowerCase().trim();
  const user = users[cleanEmail];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const myPurchases = userPlans.filter(p => p.email === user.email);
  const myDownline = Object.values(users).filter(u => u.referredBy === user.myReferralCode);

  const tree = myDownline.map(child => {
    const childPurchases = userPlans.filter(p => p.email === child.email);
    return {
      uid: child.uid,
      email: child.email,
      hasActivePlan: childPurchases.length > 0,
      activePlansCount: childPurchases.length
    };
  });

  return res.json({
    success: true,
    purchases: myPurchases,
    tree,
    myReferralCode: user.myReferralCode,
    qualifiesForDiscount: tree.some(node => node.hasActivePlan)
  });
});

// 8. UTR DEPOSIT SUBMISSION (Direct from scanner screen)
app.post(['/api/deposit/submit-utr', '/api/payment/submit-utr', '/submit-utr'], (req, res) => {
  const { email, utr, planId, amount } = req.body;

  if (!utr || utr.toString().trim().length < 12) {
    return res.status(400).json({ success: false, error: 'Enter a valid 12-digit UTR reference number' });
  }

  const cleanUtr = utr.toString().trim();
  const existing = deposits.find(d => d.utr === cleanUtr);
  if (existing) {
    return res.status(400).json({ success: false, error: 'This UTR has already been submitted.' });
  }

  const newDeposit = {
    id: 'DEP-' + Math.floor(100000 + Math.random() * 900000),
    email: email?.toLowerCase().trim() || 'user@acpay.com',
    planId: planId || 'plan-18500',
    amount: parseFloat(amount) || 18500,
    utr: cleanUtr,
    status: 'Pending',
    date: new Date().toISOString()
  };

  deposits.push(newDeposit);
  console.log(`[ACPay] UTR Registered: ${cleanUtr} for plan ₹${newDeposit.amount} by ${newDeposit.email}`);

  return res.json({
    success: true,
    message: 'UTR submitted successfully! Once approved in Admin Panel, plan will activate in Activity.',
    deposit: newDeposit
  });
});

// 9. WITHDRAWAL REQUEST
app.post('/api/user/withdraw', (req, res) => {
  const { email, amount, upiId } = req.body;
  const cleanEmail = email?.toLowerCase().trim();
  const user = users[cleanEmail];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  const withdrawAmount = parseFloat(amount);
  if (!withdrawAmount || withdrawAmount <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid withdrawal amount' });
  }

  if (user.balance < withdrawAmount) {
    return res.status(400).json({ success: false, error: 'Insufficient balance in My Balance' });
  }

  user.balance -= withdrawAmount;

  const request = {
    id: 'WTH-' + Math.floor(100000 + Math.random() * 900000),
    email: user.email,
    amount: withdrawAmount,
    upiId: upiId || (user.upiList[0]?.upiId || 'Not provided'),
    status: 'Pending Approval',
    date: new Date().toISOString()
  };

  withdrawals.push(request);
  return res.json({ success: true, message: 'Withdrawal request submitted to admin.', withdrawal: request });
});

// 10. ADD UPI / BANK DETAILS
app.post('/api/user/add-upi', (req, res) => {
  const { email, upiId, bankName, accountNo, ifsc } = req.body;
  const cleanEmail = email?.toLowerCase().trim();
  const user = users[cleanEmail];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  user.upiList.push({
    upiId: upiId || '',
    bankName: bankName || 'State Bank of India',
    accountNo: accountNo || '',
    ifsc: ifsc || ''
  });

  return res.json({ success: true, upiList: user.upiList });
});

// 11. ADMIN APIS (Review overview)
app.get('/api/admin/overview', (req, res) => {
  return res.json({
    success: true,
    users: Object.values(users),
    deposits,
    withdrawals,
    userPlans
  });
});

// 12. ADMIN APPROVE UTR (Activates plan in Activity + Credits Referrer ₹800)
app.post('/api/admin/approve-deposit', (req, res) => {
  const { depositId } = req.body;
  const dep = deposits.find(d => d.id === depositId);
  if (!dep) return res.status(404).json({ success: false, error: 'Deposit not found' });

  if (dep.status === 'Approved') {
    return res.status(400).json({ success: false, error: 'Already approved' });
  }

  dep.status = 'Approved';
  const cleanEmail = dep.email.toLowerCase();
  const user = users[cleanEmail];

  // Map tier title
  const planNames = {
    'plan-18500': 'Tier 1 Prime',
    'plan-36500': 'Tier 2 Elite',
    'plan-72500': 'Tier 3 Master',
    'plan-144500': 'Tier 4 Apex',
    'plan-200500': 'Tier 5 Ultra (+200.5K)'
  };

  // Register plan under user's active purchases
  const newPurchase = {
    id: 'PUR-' + Math.floor(100000 + Math.random() * 900000),
    email: cleanEmail,
    planId: dep.planId,
    title: planNames[dep.planId] || 'Investment Tier',
    cost: dep.amount,
    dailyReturn: Math.round(dep.amount * 0.10),
    date: new Date().toISOString()
  };
  userPlans.push(newPurchase);

  // If this user was invited by someone, reward that parent referrer ₹800
  if (user && user.referredBy) {
    const parentUser = Object.values(users).find(u => u.myReferralCode === user.referredBy);
    if (parentUser) {
      parentUser.balance += 800;
      parentUser.totalEarn += 800;
      parentUser.referralIncentivesEarned = (parentUser.referralIncentivesEarned || 0) + 800;
      console.log(`[ACPay Referral Incentive] ₹800 bonus credited to ${parentUser.email}`);
    }
  }

  return res.json({ 
    success: true, 
    message: `Approved! Activated ${newPurchase.title} (₹${dep.amount}) for ${dep.email}`, 
    deposits 
  });
});

// 13. ADMIN ADJUST BALANCE DIRECTLY
app.post('/api/admin/adjust-balance', (req, res) => {
  const { email, amount } = req.body;
  const cleanEmail = email?.toLowerCase().trim();
  const user = users[cleanEmail];
  if (!user) return res.status(404).json({ success: false, error: 'User not found' });

  user.balance += parseFloat(amount);
  return res.json({ success: true, message: `Balance updated. New Balance: ₹${user.balance}` });
});

// Default: Serve frontend single page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`ACPay running live on port ${PORT}`);
});