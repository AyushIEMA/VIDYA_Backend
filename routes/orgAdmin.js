import express from 'express';
import crypto from 'crypto';
import { authenticate, authorize } from '../middleware/auth.js';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import OrgTeacherProfile from '../models/OrgTeacherProfile.js';
import OrgTeacherAssignment from '../models/OrgTeacherAssignment.js';
import Batch from '../models/Batch.js';
import Enrollment from '../models/Enrollment.js';
import Attendance from '../models/Attendance.js';
import Fee from '../models/Fee.js';
import Announcement from '../models/Announcement.js';
import ClassLog from '../models/ClassLog.js';
import OrgTeacherSalary from '../models/OrgTeacherSalary.js';
import { sendOrgTeacherCredentials } from '../utils/email.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';
import { uploadSingleFile } from '../utils/cloudinary.js';

const router = express.Router();
router.use(authenticate, authorize('org_admin'));

const getOrgForAdmin = async (req) => {
  const org = await Organization.findOne({ adminUserId: req.user._id });
  return org;
};

router.get('/dashboard/stats', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const totalBatches = await Batch.countDocuments({ organizationId: org._id });
    const totalTeachers = await OrgTeacherProfile.countDocuments({ organizationId: org._id });
    const studentIds = await Enrollment.distinct('studentId', { organizationId: org._id, status: 'active' });
    const totalStudents = studentIds.length;

    const paidFees = await Fee.find({ organizationId: org._id, status: 'paid' });
    const totalEarnings = paidFees.reduce((sum, f) => sum + (f.amount || 0), 0);

    const monthlyEarnings = await Fee.aggregate([
      { $match: { organizationId: org._id, status: 'paid' } },
      {
        $group: {
          _id: { month: '$month', year: '$year' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 24 }
    ]);

    res.json({
      organizationCode: org.organizationCode,
      totalBatches,
      totalTeachers,
      totalStudents,
      totalEarnings,
      monthlyEarnings
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/teachers', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const skip = (page - 1) * limit;

    const profiles = await OrgTeacherProfile.find({ organizationId: org._id })
      .populate('userId', 'email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    const total = await OrgTeacherProfile.countDocuments({ organizationId: org._id });

    const teachers = profiles.map((p) => ({
      id: p.userId?._id || p.userId,
      email: p.userId?.email,
      name: p.name,
      phone: p.phone,
      whatsapp: p.whatsapp,
      profileId: p._id
    }));

    res.json({ teachers, total, pages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const generateSixCharPassword = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(6);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
};

const EMAIL_CONFLICT_MESSAGE =
  'Email already registered as independent teacher or in another organization';

router.post('/teachers', async (req, res) => {
  try {
    const {
      organizationId,
      name,
      email,
      phone,
      whatsapp,
      degree,
      experience
    } = req.body || {};

    const orgFromToken = await getOrgForAdmin(req);
    const orgId = (organizationId || orgFromToken?._id || '').toString().trim();
    const teacherName = (name || '').toString().trim();
    const teacherEmail = (email || '').toString().trim().toLowerCase();
    const teacherWhatsapp = (whatsapp || '').toString().trim();
    const teacherPhone = (phone || '').toString().trim();

    if (!orgId || !teacherName || !teacherEmail) {
      return res.status(400).json({ error: 'organizationId, name, and email are required' });
    }

    const org = await Organization.findById(orgId);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const existing = await User.findOne({ email: teacherEmail });
    if (existing) {
      // Requirement: if email already exists as independent teacher OR in another organization → throw error.
      if (existing.role === 'teacher') {
        return res.status(400).json({ error: EMAIL_CONFLICT_MESSAGE });
      }
      if (existing.role === 'org_teacher') {
        const profile = await OrgTeacherProfile.findOne({ userId: existing._id });
        if (!profile || profile.organizationId.toString() !== orgId) {
          return res.status(400).json({ error: EMAIL_CONFLICT_MESSAGE });
        }
        return res.status(400).json({ error: EMAIL_CONFLICT_MESSAGE });
      }

      // Any other role should still be treated as an email collision for safety.
      return res.status(400).json({ error: EMAIL_CONFLICT_MESSAGE });
    }

    const password = generateSixCharPassword();

    const user = await User.create({
      email: teacherEmail,
      password,
      role: 'org_teacher',
      mustResetPassword: true
    });

    const profile = await OrgTeacherProfile.create({
      userId: user._id,
      organizationId: org._id,
      name: teacherName,
      phone: teacherPhone || undefined,
      whatsapp: teacherWhatsapp || undefined,
      degree: (degree || '').toString().trim() || undefined,
      experience: (experience || '').toString().trim() || undefined
    });

    const clientBase = (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
    const loginUrl = `${clientBase}/login`;

    // Send credentials
    try {
      await sendOrgTeacherCredentials(teacherEmail, password, { loginUrl });
    } catch (emailErr) {
      // Credentials not sent is still a server failure; keep user created but return error for visibility.
      console.error('[orgAdmin/teachers] email send failed:', emailErr.message);
      return res.status(502).json({ error: 'Teacher created but email sending failed' });
    }

    if (teacherWhatsapp) {
      const msg =
        `Vidya Credentials\n` +
        `Email: ${teacherEmail}\n` +
        `Password: ${password}\n` +
        `Login: ${loginUrl}\n` +
        `\n` +
        `You must reset password on first login.\n` +
        `Reply not monitored.`;
      await sendWhatsAppMessage(teacherWhatsapp, msg);
    }

    return res.status(201).json({
      message: 'Organization teacher created',
      orgTeacher: {
        id: user._id,
        email: user.email,
        role: user.role,
        name: profile.name
      }
    });
  } catch (error) {
    console.error('[orgAdmin/teachers] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    res.json(org);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { class: cls, subject, board, page = 1, limit = 10, search } = req.query;
    const query = { organizationId: org._id };
    if (cls) query.class = cls;
    if (board) query.board = board;
    if (search) query.batchName = { $regex: search, $options: 'i' };
    if (subject) query.subjects = { $elemMatch: { $regex: String(subject).trim(), $options: 'i' } };

    const batches = await Batch.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10))
      .sort({ createdAt: -1 });

    const total = await Batch.countDocuments(query);
    res.json({ batches, total, pages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const orgTeacherIds = Array.isArray(req.body?.orgTeacherIds) ? req.body.orgTeacherIds : [];
    if (orgTeacherIds.length === 0) {
      return res.status(400).json({ error: 'At least 1 organization teacher is required' });
    }

    // Validate teachers belong to this organization
    const validProfiles = await OrgTeacherProfile.find({
      organizationId: org._id,
      userId: { $in: orgTeacherIds }
    }).select('userId');
    const validIds = new Set(validProfiles.map((p) => p.userId.toString()));
    for (const tid of orgTeacherIds) {
      if (!validIds.has(tid.toString())) {
        return res.status(400).json({ error: 'Invalid orgTeacherId for this organization' });
      }
    }

    const body = { ...req.body, organizationId: org._id, teachers: orgTeacherIds };
    if (body.schedule?.length) {
      body.days = body.schedule.map((s) => s.day);
      if (!body.startTime && body.schedule[0]?.startTime) body.startTime = body.schedule[0].startTime;
    }

    const batch = await Batch.create(body);

    await OrgTeacherAssignment.insertMany(
      orgTeacherIds.map((orgTeacherId) => ({
        orgTeacherId,
        organizationId: org._id,
        batchId: batch._id
      }))
    );
    res.status(201).json(batch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/batch/:id/teachers', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const batch = await Batch.findById(req.params.id);
    if (!batch || batch.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const teacherIds = Array.isArray(req.body?.teacherIds) ? req.body.teacherIds : null;
    const addTeacherIds = Array.isArray(req.body?.addTeacherIds) ? req.body.addTeacherIds : [];
    const removeTeacherIds = Array.isArray(req.body?.removeTeacherIds) ? req.body.removeTeacherIds : [];

    const normalizedReplace = teacherIds ? teacherIds.map((x) => x.toString()) : null;
    const normalizedAdd = addTeacherIds.map((x) => x.toString());
    const normalizedRemove = removeTeacherIds.map((x) => x.toString());

    const requested = normalizedReplace ?? Array.from(new Set([...(batch.teachers || []).map(String), ...normalizedAdd]));
    const finalTeachers = Array.from(new Set(requested)).filter((x) => !new Set(normalizedRemove).has(x));
    if (finalTeachers.length === 0) return res.status(400).json({ error: 'Batch must have at least 1 teacher' });

    const validProfiles = await OrgTeacherProfile.find({
      organizationId: org._id,
      userId: { $in: finalTeachers }
    }).select('userId');
    const validIds = new Set(validProfiles.map((p) => p.userId.toString()));
    for (const tid of finalTeachers) {
      if (!validIds.has(tid.toString())) return res.status(400).json({ error: 'Invalid teacher for this organization' });
    }

    const before = new Set((batch.teachers || []).map(String));
    const after = new Set(finalTeachers.map(String));
    const added = Array.from(after).filter((x) => !before.has(x));
    const removed = Array.from(before).filter((x) => !after.has(x));

    batch.teachers = Array.from(after);
    await batch.save();

    // keep assignment table in sync for existing org-teacher APIs
    if (added.length) {
      const toInsert = added.map((orgTeacherId) => ({ orgTeacherId, organizationId: org._id, batchId: batch._id }));
      await OrgTeacherAssignment.insertMany(toInsert, { ordered: false }).catch(() => {});
    }
    if (removed.length) {
      await OrgTeacherAssignment.deleteMany({ organizationId: org._id, batchId: batch._id, orgTeacherId: { $in: removed } });
    }

    res.json({ message: 'Teachers assigned', batch });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const batch = await Batch.findById(req.params.id);
    if (!batch || batch.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const teacherProfiles = await OrgTeacherProfile.find({
      organizationId: org._id,
      userId: { $in: batch.teachers || [] }
    }).populate('userId', 'email');

    const enrollments = await Enrollment.find({ batchId: batch._id, status: 'active' }).populate('studentId');
    const students = enrollments.map((e) => ({
      ...e.studentId?.toObject?.(),
      discount: e.discount,
      enrollmentId: e._id
    })).filter(Boolean);

    const logs = await ClassLog.find({ batchId: batch._id }).sort({ date: -1 });
    res.json({
      batch,
      teachers: teacherProfiles.map((p) => ({
        id: p.userId?._id || p.userId,
        name: p.name,
        email: p.userId?.email,
        phone: p.phone,
        degree: p.degree,
        experience: p.experience
      })),
      students,
      logs
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:id/upload', uploadSingleFile('file'), async (req, res) => {
  try {
    // Org Admin is view-only for uploads; only org teachers can upload.
    res.status(403).json({ error: 'Org admin cannot upload notes/syllabus.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/announcement', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { title, message, targetType, batchId, studentIds } = req.body || {};
    if (!title?.trim() || !message?.trim()) return res.status(400).json({ error: 'Title and message are required' });

    let targetStudents = [];
    if (targetType === 'all') {
      const enrollments = await Enrollment.find({ organizationId: org._id, status: 'active' }).populate('studentId');
      targetStudents = enrollments.map((e) => e.studentId).filter(Boolean);
    } else if (targetType === 'batch') {
      if (!batchId) return res.status(400).json({ error: 'batchId is required' });
      const batch = await Batch.findById(batchId);
      if (!batch || batch.organizationId?.toString() !== org._id.toString()) return res.status(404).json({ error: 'Batch not found' });
      const enrollments = await Enrollment.find({ batchId, status: 'active' }).populate('studentId');
      targetStudents = enrollments.map((e) => e.studentId).filter(Boolean);
    } else if (targetType === 'students') {
      const ids = Array.isArray(studentIds) ? studentIds : [];
      if (ids.length === 0) return res.status(400).json({ error: 'Select at least one student' });
      const enrollments = await Enrollment.find({ organizationId: org._id, studentId: { $in: ids }, status: 'active' }).populate('studentId');
      targetStudents = enrollments.map((e) => e.studentId).filter(Boolean);
    } else {
      return res.status(400).json({ error: 'Invalid targetType' });
    }

    const announcement = await Announcement.create({
      organizationId: org._id,
      title: title.trim(),
      message: message.trim(),
      targetType,
      batchId: batchId || undefined,
      studentIds: targetType === 'students' ? studentIds : undefined,
      teacherId: undefined
    });

    res.status(201).json({ announcement, sentTo: targetStudents.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/attendance', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const { batchId, month, year } = req.query;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });
    const batch = await Batch.findById(batchId);
    if (!batch || batch.organizationId?.toString() !== org._id.toString()) return res.status(404).json({ error: 'Batch not found' });

    const query = { batchId };
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      query.date = { $gte: startDate, $lte: endDate };
    }
    const attendance = await Attendance.find(query).populate('studentId').sort({ date: -1 });
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fees/students', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { month, year } = req.query;
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();
    const selectedMonthIndex = month
      ? new Date(`${month} 1, ${selectedYear}`).getMonth()
      : new Date().getMonth();
    const selectedMonthName = new Date(selectedYear, selectedMonthIndex, 1).toLocaleString('en-US', { month: 'long' });

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const query = { organizationId: org._id, month: selectedMonthName, year: selectedYear };
    const total = await Fee.countDocuments(query);
    const fees = await Fee.find(query)
      .populate('studentId', 'name mobile whatsapp parentWhatsapp')
      .populate('batchId', 'batchName class fees')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({ fees, total, page, pages: Math.ceil(total / limit) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fees/summary', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { month, year } = req.query;
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();
    const selectedMonthIndex = month
      ? new Date(`${month} 1, ${selectedYear}`).getMonth()
      : new Date().getMonth();
    const selectedMonthName = new Date(selectedYear, selectedMonthIndex, 1).toLocaleString('en-US', { month: 'long' });

    const match = { organizationId: org._id, month: selectedMonthName, year: selectedYear };

    const summary = await Fee.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    const paid = summary.find((s) => s._id === 'paid') || { total: 0, count: 0 };
    const pending = summary.find((s) => s._id === 'pending') || { total: 0, count: 0 };

    const batchWise = await Fee.aggregate([
      { $match: match },
      {
        $group: {
          _id: { batchId: '$batchId', status: '$status' },
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);

    res.json({
      month: selectedMonthName,
      year: selectedYear,
      paid,
      pending,
      batchWise
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fees/batch', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { batchId, month, year, page = 1, limit = 20 } = req.query;
    if (!batchId) return res.status(400).json({ error: 'batchId is required' });
    if (!month) return res.status(400).json({ error: 'month is required' });
    if (!year) return res.status(400).json({ error: 'year is required' });

    const batch = await Batch.findById(batchId);
    if (!batch || batch.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const selectedYear = parseInt(year, 10);
    const monthName = String(month);

    const enrollments = await Enrollment.find({ batchId: batch._id, organizationId: org._id, status: 'active' })
      .populate('studentId', 'name mobile whatsapp parentWhatsapp');

    const feeQuery = {
      organizationId: org._id,
      batchId: batch._id,
      month: monthName,
      year: selectedYear
    };
    const fees = await Fee.find(feeQuery);
    const feeByStudent = new Map(fees.map((f) => [f.studentId.toString(), f]));

    // Ensure every active enrollment has a fee record for the selected month/year
    for (const enr of enrollments) {
      const sid = enr.studentId?._id?.toString();
      if (!sid) continue;
      if (feeByStudent.has(sid)) continue;

      const original = Number(batch.fees || 0);
      let discountAmount = 0;
      if (enr.discountType === 'percentage') discountAmount = (original * Number(enr.discount || 0)) / 100;
      else discountAmount = Number(enr.discount || 0);
      const finalAmount = Math.max(0, original - discountAmount);

      const created = await Fee.create({
        studentId: sid,
        batchId: batch._id,
        organizationId: org._id,
        originalAmount: original,
        discount: discountAmount,
        amount: finalAmount,
        month: monthName,
        year: selectedYear,
        status: 'pending'
      });
      feeByStudent.set(sid, created);
    }

    const rows = enrollments.map((enr) => {
      const sid = enr.studentId?._id?.toString();
      const fee = sid ? feeByStudent.get(sid) : null;
      const original = Number(batch.fees || 0);
      let discountAmount = 0;
      if (enr.discountType === 'percentage') discountAmount = (original * Number(enr.discount || 0)) / 100;
      else discountAmount = Number(enr.discount || 0);
      const finalAmount = Math.max(0, original - discountAmount);
      return {
        student: enr.studentId,
        enrollmentId: enr._id,
        feeId: fee?._id,
        status: fee?.status || 'pending',
        originalAmount: original,
        discount: discountAmount,
        finalAmount,
        paidAt: fee?.paidAt
      };
    });

    const p = parseInt(page, 10);
    const lim = parseInt(limit, 10);
    const total = rows.length;
    const offset = (p - 1) * lim;
    const paged = rows.slice(offset, offset + lim);

    res.json({ batch: { _id: batch._id, batchName: batch.batchName }, month: monthName, year: selectedYear, students: paged, total, page: p, pages: Math.ceil(total / lim) || 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/fees/:id/mark-paid', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });
    const fee = await Fee.findById(req.params.id);
    if (!fee || fee.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Fee not found' });
    }
    fee.status = 'paid';
    fee.paidAt = new Date();
    await fee.save();
    res.json(fee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/enrollment/:id/discount', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { discount, discountType } = req.body || {};
    const dt = (discountType || 'amount').toString();
    if (dt !== 'amount' && dt !== 'percentage') {
      return res.status(400).json({ error: 'discountType must be amount or percentage' });
    }
    const d = Number(discount);
    if (Number.isNaN(d) || d < 0) return res.status(400).json({ error: 'Invalid discount' });

    const enr = await Enrollment.findById(req.params.id);
    if (!enr || enr.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    enr.discount = d;
    enr.discountType = dt;
    await enr.save();

    res.json({ message: 'Discount updated', enrollment: enr });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/salary', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { month, year, status, page = 1, limit = 20 } = req.query;
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();
    const selectedMonthIndex = month
      ? new Date(`${month} 1, ${selectedYear}`).getMonth()
      : new Date().getMonth();
    const selectedMonthName = new Date(selectedYear, selectedMonthIndex, 1).toLocaleString('en-US', { month: 'long' });

    const query = { organizationId: org._id, month: selectedMonthName, year: selectedYear };
    if (status) query.status = status;

    const total = await OrgTeacherSalary.countDocuments(query);
    const rows = await OrgTeacherSalary.find(query)
      .populate('orgTeacherId', 'email')
      .populate('batchId', 'batchName class')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit, 10));

    const summary = await OrgTeacherSalary.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 }
        }
      }
    ]);
    const paid = summary.find((s) => s._id === 'paid') || { total: 0, count: 0 };
    const pending = summary.find((s) => s._id === 'pending') || { total: 0, count: 0 };

    res.json({ month: selectedMonthName, year: selectedYear, salary: rows, total, pages: Math.ceil(total / limit) || 1, summary: { paid, pending } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/salary', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const { orgTeacherId, batchId, month, year, amount } = req.body || {};
    if (!orgTeacherId || !batchId || !month || !year || amount == null) {
      return res.status(400).json({ error: 'orgTeacherId, batchId, month, year, amount are required' });
    }

    const batch = await Batch.findById(batchId);
    if (!batch || batch.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const assigned = await OrgTeacherAssignment.findOne({ organizationId: org._id, orgTeacherId, batchId });
    if (!assigned) return res.status(400).json({ error: 'Teacher is not assigned to this batch' });

    const row = await OrgTeacherSalary.create({
      organizationId: org._id,
      orgTeacherId,
      batchId,
      month: String(month),
      year: parseInt(year, 10),
      amount: Number(amount),
      status: 'pending'
    });

    res.status(201).json(row);
  } catch (error) {
    if (String(error.message || '').includes('duplicate key')) {
      return res.status(400).json({ error: 'Salary record already exists for this month' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.put('/salary/:id/mark-paid', async (req, res) => {
  try {
    const org = await getOrgForAdmin(req);
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    const row = await OrgTeacherSalary.findById(req.params.id);
    if (!row || row.organizationId?.toString() !== org._id.toString()) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    row.status = 'paid';
    row.paidAt = new Date();
    await row.save();

    res.json({ message: 'Marked as paid', salary: row });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

