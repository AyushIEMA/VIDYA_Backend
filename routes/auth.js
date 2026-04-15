import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';
import Student from '../models/Student.js';
import Organization from '../models/Organization.js';
import { generateTeacherCode, generateOTP } from '../utils/generateCode.js';
import { sendOTPEmail, getEmailEnvStatus } from '../utils/email.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';

const router = express.Router();

router.post('/register/teacher', async (req, res) => {
  try {
    const { email, password, firstName, lastName, address, location, profession, experience, education, schoolCollege, subjects, avgFees, mobile, whatsapp, gender } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const user = await User.create({ email, password, role: 'teacher' });
    
    let teacherCode;
    let isUnique = false;
    while (!isUnique) {
      teacherCode = generateTeacherCode();
      const existing = await Teacher.findOne({ teacherCode });
      if (!existing) isUnique = true;
    }

    const teacher = await Teacher.create({
      userId: user._id,
      firstName,
      lastName,
      teacherCode,
      address,
      location,
      profession,
      experience,
      education,
      schoolCollege,
      subjects,
      avgFees,
      mobile,
      whatsapp,
      gender
    });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role }, teacher });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/register/student', async (req, res) => {
  try {
    const { email, password, name, address, mobile, whatsapp, parentWhatsapp, parentCall, class: studentClass, board } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const user = await User.create({ email, password, role: 'student' });
    const student = await Student.create({
      userId: user._id,
      name,
      address,
      mobile,
      whatsapp,
      parentWhatsapp,
      whatsapp_enabled: false,
      parentCall,
      class: studentClass,
      board
    });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role }, student });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/register/organization', async (req, res) => {
  try {
    const {
      name,
      address,
      location,
      subjects,
      gstin,
      contact,
      whatsapp,
      adminName,
      avgFees,
      nearbyLocation,
      email,
      password
    } = req.body || {};

    const orgName = String(name || '').trim();
    const orgEmail = String(email || '').trim().toLowerCase();

    if (!orgName || !orgEmail || !password) {
      return res.status(400).json({ error: 'name, email, and password are required' });
    }

    const existingUser = await User.findOne({ email: orgEmail });
    if (existingUser) return res.status(400).json({ error: 'Email already exists' });

    const user = await User.create({ email: orgEmail, password, role: 'org_admin' });

    // Unique org code (same generator shape as teacher code: 6 chars)
    let organizationCode;
    let isUnique = false;
    while (!isUnique) {
      organizationCode = generateTeacherCode();
      const existing = await Organization.findOne({ organizationCode });
      if (!existing) isUnique = true;
    }

    const org = await Organization.create({
      adminUserId: user._id,
      name: orgName,
      address,
      location,
      subjects: Array.isArray(subjects) ? subjects : String(subjects || '').split(',').map((s) => s.trim()).filter(Boolean),
      gstin: gstin || undefined,
      contact,
      whatsapp,
      adminName,
      avgFees,
      nearbyLocation,
      organizationCode
    });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user._id, email: user.email, role: user.role }, organization: org });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    let profile;
    if (user.role === 'teacher') {
      profile = await Teacher.findOne({ userId: user._id });
    } else if (user.role === 'student') {
      profile = await Student.findOne({ userId: user._id });
    } else if (user.role === 'org_admin') {
      // Org profile fetched by organizationCode lookup later; keep profile lightweight.
      profile = null;
    } else if (user.role === 'org_teacher') {
      profile = null;
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role },
      profile,
      forceReset: Boolean(user.mustResetPassword && user.role === 'org_teacher')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const mailStatus = getEmailEnvStatus();
    if (!mailStatus.ok) {
      console.error('[auth/forgot-password] Mail not configured:', mailStatus.missing.join(', '));
      return res.status(503).json({
        error: 'Password reset email is not configured on the server. Contact support.'
      });
    }

    const otp = generateOTP();
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 10 * 60 * 1000;

    const clientBase = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
    const resetLink = `${clientBase}/forgot-password?resetToken=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`;

    try {
      await sendOTPEmail(email, otp, { resetLink });
    } catch (mailErr) {
      console.error('[auth/forgot-password] sendMail failed:', mailErr.message, mailErr.response || '');
      return res.status(502).json({
        error: 'Could not send reset email. Check EMAIL_USER / EMAIL_PASS (Gmail app password) or SMTP settings.'
      });
    }

    user.otp = otp;
    user.otpExpiry = new Date(expires);
    user.passwordResetToken = resetToken;
    user.passwordResetExpires = new Date(expires);
    await user.save();

    res.json({ message: 'OTP sent to email' });
  } catch (error) {
    console.error('[auth/forgot-password]', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.otp !== otp || user.otpExpiry < Date.now()) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }
    res.json({ message: 'OTP verified', email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    const { password, resetToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    let user;

    if (resetToken && String(resetToken).trim()) {
      const token = String(resetToken).trim();
      user = await User.findOne({
        email,
        passwordResetToken: token,
        passwordResetExpires: { $gt: new Date() }
      });
      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset link. Request a new reset.' });
      }
    } else {
      user = await User.findOne({ email });
      if (!user) return res.status(404).json({ error: 'User not found' });
    }

    user.password = password;
    user.otp = undefined;
    user.otpExpiry = undefined;
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.mustResetPassword = false;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('[auth/reset-password]', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/check-email/:email', async (req, res) => {
  try {
    const user = await User.findOne({ email: req.params.email });
    res.json({ exists: !!user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
