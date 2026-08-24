/* =========================================================
   JAE PORTFOLIO — BACKEND SERVER
   Express + Nodemailer contact form handler.

   What this does:
   - Exposes POST /api/contact
   - Validates the submitted fields (mirrors the frontend rules)
   - Sends YOU (manalojesz@gmail.com) an email with the inquiry
   - Sends the CLIENT an automatic "I received your message" reply
   - Rate-limits requests so the endpoint can't be spammed
========================================================= */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// -----------------------------------------------------------
// 1. BASIC MIDDLEWARE
// -----------------------------------------------------------
app.use(express.json({ limit: '100kb' }));

// Only allow requests from your own site(s). Add every domain
// your portfolio is (or will be) served from.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    // Allow tools like curl/Postman (no origin header) and any
    // origin explicitly whitelisted in .env
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  }
}));

// -----------------------------------------------------------
// 2. RATE LIMITING (protects your inbox + your Gmail quota)
// -----------------------------------------------------------
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,                   // 5 submissions per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many messages sent. Please try again later.' }
});

// -----------------------------------------------------------
// 3. MAIL TRANSPORTER (Gmail via App Password)
// -----------------------------------------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,   // manalojesz@gmail.com
    pass: process.env.GMAIL_APP_PASSWORD // 16-char Gmail App Password
  }
});

// Fail loudly on boot if mail credentials are missing/broken,
// instead of silently failing on every real submission.
transporter.verify((err) => {
  if (err) {
    console.error('✗ Mail transporter failed to verify:', err.message);
  } else {
    console.log('✓ Mail transporter ready');
  }
});

// -----------------------------------------------------------
// 4. VALIDATION (mirrors script.js validateField logic)
// -----------------------------------------------------------
const PROJECT_TYPES = ['video', 'graphic', 'uiux', 'encoding', 'social', 'other'];
const BUDGETS = ['small', 'medium', 'large', 'enterprise', ''];

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function validate(body) {
  const errors = {};
  const { fullName = '', email = '', company = '', projectType = '', budget = '', message = '' } = body;

  if (!fullName.trim()) errors.fullName = 'Please enter your full name.';
  else if (fullName.trim().length < 2) errors.fullName = 'Name looks too short.';

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.trim()) errors.email = 'Please enter your email.';
  else if (!emailRegex.test(email)) errors.email = 'Please enter a valid email.';

  if (!projectType) errors.projectType = 'Please select a project type.';
  else if (!PROJECT_TYPES.includes(projectType)) errors.projectType = 'Invalid project type.';

  if (budget && !BUDGETS.includes(budget)) errors.budget = 'Invalid budget option.';

  if (!message.trim()) errors.message = 'Please add a short message.';
  else if (message.trim().length < 10) errors.message = 'Please add a bit more detail.';

  // Honeypot field — real users never fill this in.
  if (body.website) errors.website = 'Spam detected.';

  return { errors, isValid: Object.keys(errors).length === 0, clean: {
    fullName: fullName.trim(),
    email: email.trim(),
    company: company.trim(),
    projectType,
    budget,
    message: message.trim()
  } };
}

const PROJECT_LABELS = {
  video: 'Strategic Video Editing',
  graphic: 'Graphic Design',
  uiux: 'UI/UX Design',
  encoding: 'Encoding',
  social: 'Social Media Management',
  other: 'Other'
};

const BUDGET_LABELS = {
  small: 'Under $500',
  medium: '$500 – $1,500',
  large: '$1,500 – $5,000',
  enterprise: '$5,000+',
  '': 'Not specified'
};

// -----------------------------------------------------------
// 5. ROUTES
// -----------------------------------------------------------
app.get('/health', (req, res) => res.json({ ok: true }));

app.post('/api/contact', contactLimiter, async (req, res) => {
  const { errors, isValid, clean } = validate(req.body || {});

  if (!isValid) {
    return res.status(400).json({ ok: false, errors });
  }

  const projectLabel = PROJECT_LABELS[clean.projectType] || clean.projectType;
  const budgetLabel = BUDGET_LABELS[clean.budget] || clean.budget;

  const notifyHtml = `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#222;">
      <h2 style="margin-bottom:4px;">New portfolio inquiry</h2>
      <p style="color:#666; margin-top:0;">Sent from the contact form on jaemanalo.com</p>
      <table style="border-collapse:collapse; width:100%; max-width:520px;">
        <tr><td style="padding:6px 0; font-weight:bold; width:140px;">Name</td><td>${escapeHtml(clean.fullName)}</td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Email</td><td><a href="mailto:${escapeHtml(clean.email)}">${escapeHtml(clean.email)}</a></td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Company</td><td>${escapeHtml(clean.company) || '—'}</td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Project Type</td><td>${escapeHtml(projectLabel)}</td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Budget</td><td>${escapeHtml(budgetLabel)}</td></tr>
      </table>
      <p style="font-weight:bold; margin-bottom:4px;">Message</p>
      <p style="white-space:pre-wrap; background:#f6f6f6; padding:12px; border-radius:8px;">${escapeHtml(clean.message)}</p>
    </div>
  `;

  const autoReplyHtml = `
    <div style="font-family: Arial, sans-serif; line-height:1.6; color:#222;">
      <p>Hi ${escapeHtml(clean.fullName)},</p>
      <p>Thanks for reaching out! I've received your inquiry about <strong>${escapeHtml(projectLabel)}</strong> and will get back to you shortly, usually within 24–48 hours.</p>
      <p>Here's a copy of what you sent:</p>
      <p style="white-space:pre-wrap; background:#f6f6f6; padding:12px; border-radius:8px;">${escapeHtml(clean.message)}</p>
      <p>Talk soon,<br>Jae</p>
    </div>
  `;

  try {
    // Email to you
    await transporter.sendMail({
      from: `"Portfolio Contact Form" <${process.env.GMAIL_USER}>`,
      to: process.env.NOTIFY_EMAIL || 'manalojesz@gmail.com',
      replyTo: clean.email,
      subject: `New inquiry from ${clean.fullName} — ${projectLabel}`,
      html: notifyHtml
    });

    // Auto-reply to the client (best-effort — don't fail the request if this errors)
    try {
      await transporter.sendMail({
        from: `"Jae Manalo" <${process.env.GMAIL_USER}>`,
        to: clean.email,
        subject: `Got your message, ${clean.fullName}!`,
        html: autoReplyHtml
      });
    } catch (autoReplyErr) {
      console.error('Auto-reply failed (non-fatal):', autoReplyErr.message);
    }

    return res.json({ ok: true, message: 'Message sent — thank you! I\'ll get back to you shortly.' });
  } catch (err) {
    console.error('✗ Failed to send contact email:', err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please try again or email me directly.' });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
