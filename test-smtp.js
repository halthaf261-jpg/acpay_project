require('dotenv').config();
const nodemailer = require('nodemailer');

console.log('Testing with Login:', process.env.BREVO_SMTP_LOGIN);
console.log('Key length:', (process.env.BREVO_SMTP_KEY || '').length);

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: (process.env.BREVO_SMTP_LOGIN || '').trim(),
    pass: (process.env.BREVO_SMTP_KEY || '').trim()
  }
});

transporter.verify((err, success) => {
  if (err) {
    console.error('Connection Failed:', err.message);
  } else {
    console.log('SUCCESS: Brevo SMTP credentials are valid and ready!');
  }
});