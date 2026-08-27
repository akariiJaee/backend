/* =========================================================
   JAE PORTFOLIO — BACKEND SERVER (v2)
   Express + Resend (HTTPS email API) contact form handler.

   Why this version is different:
   Render's free tier blocks outbound SMTP connections, so
   direct Gmail SMTP (via Nodemailer) times out. Resend sends
   mail over a normal HTTPS API call instead, which always
   works on free hosting tiers.

   What this does:
   - Exposes POST /api/contact
   - Validates the submitted fields
   - Emails YOU (manalojesz@gmail.com) the inquiry via Resend
   - Rate-limits requests so the endpoint can't be spammed
========================================================= */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Render sits behind a reverse proxy — this tells Express to trust
// the X-Forwarded-For header so express-rate-limit can correctly
// identify each visitor's IP instead of erroring out.
app.set('trust proxy', 1);

// -----------------------------------------------------------
// 1. BASIC MIDDLEWARE
// -----------------------------------------------------------
app.use(express.json({ limit: '100kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  }
}));

// -----------------------------------------------------------
// 2. RATE LIMITING
// -----------------------------------------------------------
const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Too many messages sent. Please try again later.' }
});

// -----------------------------------------------------------
// 3. VALIDATION
// -----------------------------------------------------------
const PROJECT_TYPES = ['video', 'graphic', 'uiux', 'encoding', 'social', 'other'];
const BUDGETS = ['starter', 'standard', 'premium', 'advanced', 'retainer', ''];
const ENGAGEMENT_TYPES = ['project', 'regular', ''];
const CONTRACT_DURATIONS = ['one_time', '1_4_weeks', '1_month', '3_months', '6_months', 'ongoing', ''];

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
  const { fullName = '', email = '', company = '', projectType = '', budget = '', engagementType = '', contractDuration = '', message = '' } = body;

  if (!fullName.trim()) errors.fullName = 'Please enter your full name.';
  else if (fullName.trim().length < 2) errors.fullName = 'Name looks too short.';

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.trim()) errors.email = 'Please enter your email.';
  else if (!emailRegex.test(email)) errors.email = 'Please enter a valid email.';

  if (!projectType) errors.projectType = 'Please select a project type.';
  else if (!PROJECT_TYPES.includes(projectType)) errors.projectType = 'Invalid project type.';

  if (budget && !BUDGETS.includes(budget)) errors.budget = 'Invalid budget option.';
  if (engagementType && !ENGAGEMENT_TYPES.includes(engagementType)) errors.engagementType = 'Invalid engagement type.';
  if (contractDuration && !CONTRACT_DURATIONS.includes(contractDuration)) errors.contractDuration = 'Invalid contract duration.';

  if (!message.trim()) errors.message = 'Please add a short message.';
  else if (message.trim().length < 10) errors.message = 'Please add a bit more detail.';

  if (body.website) errors.website = 'Spam detected.';

  return { errors, isValid: Object.keys(errors).length === 0, clean: {
    fullName: fullName.trim(),
    email: email.trim(),
    company: company.trim(),
    projectType,
    budget,
    engagementType,
    contractDuration,
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
  starter: '₱1,500 – ₱3,000 (Quick edits / short-form)',
  standard: '₱3,000 – ₱8,000 (Standard project)',
  premium: '₱8,000 – ₱15,000 (Larger / multi-video project)',
  advanced: '₱15,000 – ₱20,000 (Premium / branded / narrative)',
  retainer: '₱20,000+ per month (Regular / retainer)',
  '': 'Not specified'
};

const ENGAGEMENT_LABELS = {
  project: 'Project-based (one-off)',
  regular: 'Regular / ongoing hire',
  '': 'Not specified'
};

const DURATION_LABELS = {
  one_time: 'One-time delivery',
  '1_4_weeks': '1–4 weeks',
  '1_month': '1 month retainer',
  '3_months': '3 months retainer',
  '6_months': '6 months retainer',
  ongoing: 'Ongoing / full-time regular',
  '': 'Not specified'
};

// -----------------------------------------------------------
// 4. SEND EMAIL VIA RESEND (HTTPS API — no SMTP, no blocking)
// -----------------------------------------------------------
async function sendViaResend({ to, subject, html, replyTo, fromName }) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: `${fromName} <onboarding@resend.dev>`,
      to: [to],
      subject,
      html,
      reply_to: replyTo
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Resend API error (${response.status}): ${errText}`);
  }

  return response.json();
}

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
  const engagementLabel = ENGAGEMENT_LABELS[clean.engagementType] || clean.engagementType;
  const durationLabel = DURATION_LABELS[clean.contractDuration] || clean.contractDuration;

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
        <tr><td style="padding:6px 0; font-weight:bold;">Engagement</td><td>${escapeHtml(engagementLabel)}</td></tr>
        <tr><td style="padding:6px 0; font-weight:bold;">Duration</td><td>${escapeHtml(durationLabel)}</td></tr>
      </table>
      <p style="font-weight:bold; margin-bottom:4px;">Message</p>
      <p style="white-space:pre-wrap; background:#f6f6f6; padding:12px; border-radius:8px;">${escapeHtml(clean.message)}</p>
    </div>
  `;

  try {
    await sendViaResend({
      to: process.env.NOTIFY_EMAIL || 'manalojesz@gmail.com',
      subject: `New inquiry from ${clean.fullName} — ${projectLabel}`,
      html: notifyHtml,
      replyTo: clean.email,
      fromName: `${clean.fullName} (Portfolio Inquiry)`
    });

    return res.json({ ok: true, message: 'Message sent — thank you! I\'ll get back to you shortly.' });
  } catch (err) {
    console.error('✗ Failed to send contact email:', err.message);
    return res.status(500).json({ ok: false, error: 'Something went wrong sending your message. Please try again or email me directly.' });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Server running on port ${PORT}`);
});
