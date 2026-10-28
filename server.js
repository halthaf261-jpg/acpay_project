require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const SibApiV3Sdk = require('@getbrevo/brevo');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallbacksecretkey12345';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Initialize Brevo Transactional Email Client
const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
apiInstance.setApiKey(
  SibApiV3Sdk.TransactionalEmailsApiApiKeys.apiKey,
  process.env.BREVO_API_KEY
);

// In-memory OTP storage: { "user@email.com": { otp: "123456", expires: 1712345678 } }
const otpStore = {};

// 1. Send OTP Route
app.post('/send-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: 'Email is required' });
  }

  // Generate 6-digit random code
  const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
  
  // Save OTP with 5-minute expiry
  otpStore[email.toLowerCase()] = {
    otp: generatedOtp,
    expires: Date.now() + 5 * 60 * 1000
  };

  // Configure Brevo Email
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  sendSmtpEmail.subject = "Your ACPay Verification Code";
  sendSmtpEmail.htmlContent = `
    <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
      <h2 style="color: #4f46e5;">ACPay Verification</h2>
      <p>Your one-time verification code is:</p>
      <h1 style="background: #f3f4f6; padding: 10px 20px; display: inline-block; letter-spacing: 4px; border-radius: 8px;">
        ${generatedOtp}
      </h1>
      <p>This code will expire in 5 minutes. If you did not request this, please ignore this email.</p>
    </div>
  `;
  sendSmtpEmail.sender = { name: "ACPay", email: "halthaf261@gmail.com" };
  sendSmtpEmail.to = [{ email: email }];

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`[ACPay] OTP successfully dispatched to ${email}`);
    return res.json({ success: true, message: 'OTP sent successfully to your email' });
  } catch (error) {
    console.error('[ACPay] Brevo dispatch error:', error.response ? error.response.body : error);
    return res.status(500).json({ success: false, message: 'Failed to send OTP email' });
  }
});

// 2. Verify OTP & Register Route
app.post('/register', (req, res) => {
  const { email, password, otp, referralCode } = req.body;

  if (!email || !otp || !password) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  const record = otpStore[email.toLowerCase()];

  if (!record) {
    return res.status(400).json({ success: false, message: 'Please request an OTP first' });
  }

  if (Date.now() > record.expires) {
    delete otpStore[email.toLowerCase()];
    return res.status(400).json({ success: false, message: 'OTP has expired. Request a new one.' });
  }

  if (record.otp !== otp.trim()) {
    return res.status(400).json({ success: false, message: 'Invalid OTP code' });
  }

  // Clear OTP after successful use
  delete otpStore[email.toLowerCase()];

  // Issue JWT Token
  const token = jwt.sign({ email, referralCode: referralCode || null }, JWT_SECRET, { expiresIn: '7d' });

  return res.json({
    success: true,
    message: 'Account created successfully',
    token
  });
});

// Serve frontend default page
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`ACPay running live on port ${PORT}`);
});