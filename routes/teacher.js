import express from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import Teacher from '../models/Teacher.js';
import Batch from '../models/Batch.js';
import Enrollment from '../models/Enrollment.js';
import Fee from '../models/Fee.js';
import Attendance from '../models/Attendance.js';
import Announcement from '../models/Announcement.js';
import ClassLog from '../models/ClassLog.js';
import Student from '../models/Student.js';
import { uploadSingleFile, uploadToCloudinary, getCloudinaryAssetUrl, verifyCloudinaryUrl } from '../utils/cloudinary.js';
import { sendWhatsAppMessage } from '../utils/whatsapp.js';

const router = express.Router();

const TEACHER_PROFILE_FIELDS = [
  'firstName', 'lastName', 'address', 'location', 'profession', 'experience',
  'education', 'schoolCollege', 'subjects', 'avgFees', 'mobile', 'whatsapp', 'gender'
];

router.use(authenticate, authorize('teacher'));

router.get('/profile', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    res.json(teacher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/profile', async (req, res) => {
  try {
    const payload = {};
    for (const k of TEACHER_PROFILE_FIELDS) {
      if (req.body[k] !== undefined) payload[k] = req.body[k];
    }
    const teacher = await Teacher.findOneAndUpdate(
      { userId: req.user._id },
      payload,
      { new: true, runValidators: true }
    );
    res.json(teacher);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/dashboard/stats', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const batches = await Batch.find({ teacherId: teacher._id });
    
    const distinctIds = await Enrollment.distinct('studentId', { teacherId: teacher._id, status: 'active' });
    const totalStudents = distinctIds.length;
    
    const { month, year } = req.query;
    const feeQuery = { teacherId: teacher._id };
    if (month) {
      const mi = parseInt(month, 10) - 1;
      if (!Number.isNaN(mi) && mi >= 0 && mi <= 11) {
        feeQuery.month = new Date(2000, mi, 1).toLocaleString('en-US', { month: 'long' });
      }
    }
    if (year) feeQuery.year = parseInt(year, 10);
    
    const fees = await Fee.find(feeQuery);
    const earnings = fees.filter(f => f.status === 'paid').reduce((sum, f) => sum + f.amount, 0);
    const receivedFees = fees.filter(f => f.status === 'paid').length;

    const monthlyBreakdown = await Fee.aggregate([
      { $match: { teacherId: teacher._id, status: 'paid' } },
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
      totalBatches: batches.length,
      totalStudents,
      earnings,
      receivedFees,
      teacherCode: teacher.teacherCode,
      monthlyBreakdown: monthlyBreakdown.map((m) => ({
        month: m._id.month,
        year: m._id.year,
        total: m.total,
        count: m.count
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const body = { ...req.body };
    if (body.schedule?.length) {
      body.days = body.schedule.map((s) => s.day);
      if (!body.startTime && body.schedule[0]?.startTime) {
        body.startTime = body.schedule[0].startTime;
      }
    }
    const batch = await Batch.create({ ...body, teacherId: teacher._id });
    res.status(201).json(batch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const { class: cls, subject, board, page = 1, limit = 10, search } = req.query;
    
    const query = { teacherId: teacher._id };
    if (cls) query.class = cls;
    if (subject) query.subjects = { $in: [subject] };
    if (board) query.board = board;
    if (search) query.batchName = { $regex: search, $options: 'i' };

    const batches = await Batch.find(query)
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ createdAt: -1 });
    
    const total = await Batch.countDocuments(query);
    res.json({ batches, total, pages: Math.ceil(total / limit) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const batch = await Batch.findById(req.params.id);
    if (!batch || batch.teacherId.toString() !== teacher._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const page = parseInt(req.query.page, 10);
    const limit = parseInt(req.query.limit, 10);
    const usePaging = Number.isFinite(page) && Number.isFinite(limit) && page > 0 && limit > 0;

    const baseQuery = { batchId: req.params.id, status: 'active' };
    let enrollments = await Enrollment.find(baseQuery)
      .populate('studentId')
      .sort({ createdAt: -1 });

    const totalStudents = enrollments.length;
    if (usePaging) {
      enrollments = enrollments.slice((page - 1) * limit, (page - 1) * limit + limit);
    }

    const studentsWithInfo = await Promise.all(enrollments.map(async (e) => {
      if (!e.studentId) return null;
      const enrollmentCount = await Enrollment.countDocuments({
        studentId: e.studentId._id,
        teacherId: teacher._id,
        status: 'active'
      });

      return {
        ...e.studentId.toObject(),
        discount: e.discount,
        enrollmentCount,
        enrollmentId: e._id
      };
    }));

    const students = studentsWithInfo.filter(Boolean);
    const payload = { batch, students };
    if (usePaging) {
      payload.studentsTotal = totalStudents;
      payload.studentsPage = page;
      payload.studentsPages = Math.ceil(totalStudents / limit);
    }
    res.json(payload);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/batch/:id', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const existing = await Batch.findById(req.params.id);
    if (!existing || existing.teacherId.toString() !== teacher._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    const body = { ...req.body };
    if (body.schedule?.length) {
      body.days = body.schedule.map((s) => s.day);
      if (!body.startTime && body.schedule[0]?.startTime) {
        body.startTime = body.schedule[0].startTime;
      }
    }
    const batch = await Batch.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
    res.json(batch);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/batch/:id', async (req, res) => {
  try {
    await Batch.findByIdAndDelete(req.params.id);
    await Enrollment.deleteMany({ batchId: req.params.id });
    res.json({ message: 'Batch deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:id/upload', uploadSingleFile('file'), async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const batch = await Batch.findById(req.params.id);
    if (!batch || batch.teacherId.toString() !== teacher._id.toString()) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: 'No file uploaded. Use field name "file".' });
    }

    console.log('[upload] file meta', {
      fieldname: req.file.fieldname,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

    const { type } = req.body;
    if (type !== 'notes' && type !== 'syllabus') {
      return res.status(400).json({ error: 'Invalid document type (use notes or syllabus).' });
    }

    let result;
    try {
      result = await uploadToCloudinary(req.file.buffer, 'vidya', {
        mimetype: req.file.mimetype,
        originalname: req.file.originalname
      });
    } catch (upErr) {
      if (upErr.code === 'CLOUDINARY_CONFIG') {
        console.error('[upload]', upErr.message);
        return res.status(503).json({ error: upErr.message });
      }
      const http = upErr.http_code || upErr.statusCode;
      const msg = upErr.message || 'Upload to storage failed';
      console.error('[upload] Cloudinary error', { http, msg });
      if (http === 401 || http === 403) {
        return res.status(502).json({ error: 'File storage rejected credentials. Check CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET.' });
      }
      return res.status(502).json({ error: `File storage error: ${msg}` });
    }

    const url = getCloudinaryAssetUrl(result);
    if (!url) {
      console.error('[upload] Cloudinary missing URL', { public_id: result?.public_id });
      return res.status(502).json({ error: 'Upload succeeded but storage did not return a usable URL. Please retry.' });
    }
    const check = await verifyCloudinaryUrl(url);
    if (!check.ok) {
      console.error('[upload] URL verification failed', { url, check });
      return res.status(502).json({ error: 'Upload succeeded but file URL is not accessible yet. Please retry in a few seconds.' });
    }

    const fileData = { url, name: req.file.originalname, uploadedAt: new Date() };

    if (type === 'notes') batch.notes.push(fileData);
    else if (type === 'syllabus') batch.syllabus.push(fileData);

    await batch.save();
    res.json(batch);
  } catch (error) {
    console.error('[upload] unexpected', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/batch/:id/classlog', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const classLog = await ClassLog.create({
      batchId: req.params.id,
      teacherId: teacher._id,
      ...req.body
    });
    res.status(201).json(classLog);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/batch/:id/classlog', async (req, res) => {
  try {
    const logs = await ClassLog.find({ batchId: req.params.id }).sort({ date: -1 });
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/announcement', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const { title, message, targetType, batchId, studentIds } = req.body;

    if (!title?.trim() || !message?.trim()) {
      return res.status(400).json({ error: 'Title and message are required' });
    }

    let students = [];
    if (targetType === 'all') {
      const enrollments = await Enrollment.find({ teacherId: teacher._id, status: 'active' }).populate('studentId');
      students = enrollments.map((e) => e.studentId).filter(Boolean);
    } else if (targetType === 'batch') {
      if (!batchId) return res.status(400).json({ error: 'batchId is required' });
      const batch = await Batch.findById(batchId);
      if (!batch || batch.teacherId.toString() !== teacher._id.toString()) {
        return res.status(404).json({ error: 'Batch not found' });
      }
      const enrollments = await Enrollment.find({ batchId, status: 'active' }).populate('studentId');
      students = enrollments.map((e) => e.studentId).filter(Boolean);
    } else if (targetType === 'students') {
      const ids = Array.isArray(studentIds) ? studentIds : [];
      if (ids.length === 0) return res.status(400).json({ error: 'Select at least one student' });
      students = await Student.find({ _id: { $in: ids } });
    } else {
      return res.status(400).json({ error: 'Invalid targetType' });
    }

    const announcement = await Announcement.create({
      title: title.trim(),
      message: message.trim(),
      targetType,
      batchId: batchId || undefined,
      studentIds: targetType === 'students' ? studentIds : undefined,
      teacherId: teacher._id
    });

    let batchLabel = '';
    if (targetType === 'batch' && batchId) {
      const b = await Batch.findById(batchId).select('batchName class');
      if (b) batchLabel = `${b.batchName}${b.class ? ` • ${b.class}` : ''}`;
    }
    const teacherName = `${teacher?.firstName || ''} ${teacher?.lastName || ''}`.trim() || 'Teacher';

    const text =
      `📢 ${teacherName}${batchLabel ? ` • ${batchLabel}` : ''}\n` +
      `Announcement\n` +
      `Title: ${title.trim()}\n` +
      `Message: ${message.trim()}\n` +
      `\n` +
      `Reply not monitored.`;
    for (const student of students) {
      const phone = student?.parentWhatsapp;
      if (!phone) continue;
      try {
        await sendWhatsAppMessage(phone, text);
      } catch (waErr) {
        console.error('WhatsApp notify error:', waErr.message);
      }
    }

    res.status(201).json(announcement);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fees', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const { month, year, status } = req.query;

    const query = { teacherId: teacher._id };
    if (month) {
      const mNum = parseInt(month, 10);
      if (!Number.isNaN(mNum) && mNum >= 1 && mNum <= 12) {
        query.month = new Date(2000, mNum - 1, 1).toLocaleString('en-US', { month: 'long' });
      } else {
        query.month = month;
      }
    }
    if (year) query.year = parseInt(year, 10);
    if (status) query.status = status;

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 30;
    const skip = (page - 1) * limit;

    const total = await Fee.countDocuments(query);
    const fees = await Fee.find(query)
      .populate('studentId', 'name mobile whatsapp parentWhatsapp')
      .populate('batchId', 'batchName class fees')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const feesWithEnrollments = await Promise.all(fees.map(async (fee) => {
      const enrollmentCount = await Enrollment.countDocuments({
        studentId: fee.studentId._id,
        teacherId: teacher._id,
        status: 'active'
      });
      
      const enrollment = await Enrollment.findOne({
        studentId: fee.studentId._id,
        batchId: fee.batchId._id
      });
      
      return {
        ...fee.toObject(),
        enrollmentCount,
        enrollmentDiscount: enrollment?.discount || 0,
        enrollmentId: enrollment?._id
      };
    }));

    res.json({
      fees: feesWithEnrollments,
      total,
      page,
      pages: Math.ceil(total / limit) || 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/fees/students', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const { month, year, status } = req.query;
    const selectedYear = parseInt(year) || new Date().getFullYear();
    const selectedMonthIndex = month
      ? new Date(`${month} 1, ${selectedYear}`).getMonth()
      : new Date().getMonth();
    const selectedMonthName = new Date(selectedYear, selectedMonthIndex, 1).toLocaleString('en-US', { month: 'long' });
    const selectedMonthEnd = new Date(selectedYear, selectedMonthIndex + 1, 0, 23, 59, 59, 999);
    
    const enrollments = await Enrollment.find({ 
      teacherId: teacher._id, 
      status: 'active' 
    })
      .populate('studentId', 'name mobile whatsapp parentWhatsapp')
      .populate('batchId', 'batchName class fees');
    
    const studentMap = new Map();
    
    for (const enrollment of enrollments) {
      const studentId = enrollment.studentId._id.toString();
      
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          student: enrollment.studentId,
          batches: [],
          totalAmount: 0,
          paidAmount: 0,
          pendingAmount: 0,
          paidCount: 0,
          pendingCount: 0
        });
      }
      
      const entry = studentMap.get(studentId);
      
      const selectedFeeQuery = {
        studentId: enrollment.studentId._id,
        batchId: enrollment.batchId._id,
        teacherId: teacher._id,
        month: selectedMonthName,
        year: selectedYear
      };
      
      const joinedAt = enrollment.createdAt;
      const joinedInSelectedMonth = joinedAt <= selectedMonthEnd;

      let selectedFee = await Fee.findOne(selectedFeeQuery);

      // Ensure fee row exists for joined students so mark-paid action is always visible.
      if (!selectedFee && joinedInSelectedMonth) {
        const finalAmount = Math.max(0, enrollment.batchId.fees - (enrollment.discount || 0));
        selectedFee = await Fee.create({
          studentId: enrollment.studentId._id,
          batchId: enrollment.batchId._id,
          teacherId: teacher._id,
          originalAmount: enrollment.batchId.fees,
          discount: enrollment.discount || 0,
          amount: finalAmount,
          month: selectedMonthName,
          year: selectedYear,
          status: 'pending'
        });
      }

      if (status === 'paid' && (!selectedFee || selectedFee.status !== 'paid')) {
        continue;
      }
      if (status === 'pending' && (!selectedFee || selectedFee.status !== 'pending' || !joinedInSelectedMonth)) {
        continue;
      }
      
      const finalAmount = enrollment.batchId.fees - enrollment.discount;
      
      if (!entry.joiningDate || new Date(entry.joiningDate) > new Date(joinedAt)) {
        entry.joiningDate = joinedAt;
      }
      entry.notJoinedInSelectedMonth = entry.notJoinedInSelectedMonth ?? false;
      if (!joinedInSelectedMonth) {
        entry.notJoinedInSelectedMonth = true;
      }

      entry.batches.push({
        batchId: enrollment.batchId._id,
        batchName: enrollment.batchId.batchName,
        class: enrollment.batchId.class,
        originalFees: enrollment.batchId.fees,
        discount: enrollment.discount,
        finalAmount: finalAmount,
        enrollmentId: enrollment._id,
        selectedFee: selectedFee || null
      });
      
      if (selectedFee) {
        entry.totalAmount += selectedFee.amount;
        if (selectedFee.status === 'paid') {
          entry.paidAmount += selectedFee.amount;
          entry.paidCount++;
        } else {
          entry.pendingAmount += selectedFee.amount;
          entry.pendingCount++;
        }
      }
    }
    
    const students = Array.from(studentMap.values())
      .map((entry) => ({
        ...entry,
        batches: entry.batches || []
      }))
      .filter((entry) => entry.batches.length > 0);
    
    students.sort((a, b) => b.pendingCount - a.pendingCount);

    const summary = {
      totalStudents: students.length,
      totalAmount: students.reduce((s, x) => s + (x.totalAmount || 0), 0),
      paidAmount: students.reduce((s, x) => s + (x.paidAmount || 0), 0),
      pendingAmount: students.reduce((s, x) => s + (x.pendingAmount || 0), 0),
      paidCount: students.reduce((s, x) => s + (x.paidCount || 0), 0),
      pendingCount: students.reduce((s, x) => s + (x.pendingCount || 0), 0),
      unpaidStudentNames: students
        .filter((x) => x.pendingCount > 0)
        .map((x) => x.student?.name)
        .filter(Boolean)
    };

    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const total = students.length;
    const offset = (page - 1) * limit;
    const paged = students.slice(offset, offset + limit);

    res.json({
      students: paged,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
      summary
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/fees/:id/mark-paid', async (req, res) => {
  try {
    const fee = await Fee.findByIdAndUpdate(
      req.params.id,
      { status: 'paid', paidAt: new Date() },
      { new: true }
    );
    res.json(fee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/fees/remind', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id }).select('firstName lastName');
    const { feeId } = req.body;
    const fee = await Fee.findById(feeId).populate('studentId').populate('batchId');
    const student = fee.studentId;
    
    const to = student.parentWhatsapp;
    if (!to) return res.status(400).json({ error: 'Parent WhatsApp number is missing for this student' });

    const teacherName = `${teacher?.firstName || ''} ${teacher?.lastName || ''}`.trim() || 'Teacher';
    const batchLabel = `${fee.batchId?.batchName || 'Batch'}${fee.batchId?.class ? ` • ${fee.batchId.class}` : ''}`;

    await sendWhatsAppMessage(
      to,
      `💰 ${teacherName} • ${batchLabel}\nFees Reminder\nYour student ${student.name}\nPending fees: ₹${Number(fee.amount || 0)}\nFor: ${fee.month} ${fee.year}\n\nReply not monitored.`
    );
    
    res.json({ message: 'Reminder sent' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/fees/:id/discount', async (req, res) => {
  try {
    const { discount } = req.body;
    const fee = await Fee.findById(req.params.id).populate('batchId');
    
    if (!fee) return res.status(404).json({ error: 'Fee not found' });
    
    const originalAmount = fee.originalAmount;
    const newAmount = originalAmount - discount;
    
    if (newAmount < 0) {
      return res.status(400).json({ error: 'Discount cannot exceed original amount' });
    }
    
    fee.discount = discount;
    fee.amount = newAmount;
    await fee.save();
    
    const enrollment = await Enrollment.findOne({
      studentId: fee.studentId,
      batchId: fee.batchId
    });
    
    if (enrollment) {
      enrollment.discount = discount;
      enrollment.discountType = 'amount';
      await enrollment.save();
    }
    
    res.json(fee);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/students', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    
    const enrollments = await Enrollment.find({ 
      teacherId: teacher._id, 
      status: 'active' 
    })
      .populate('studentId')
      .populate('batchId', 'batchName fees');
    
    const studentMap = new Map();
    
    enrollments.forEach(enrollment => {
      const studentId = enrollment.studentId._id.toString();
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          student: enrollment.studentId,
          batches: [],
          totalEnrollments: 0
        });
      }
      
      const entry = studentMap.get(studentId);
      entry.batches.push({
        batchId: enrollment.batchId._id,
        batchName: enrollment.batchId.batchName,
        fees: enrollment.batchId.fees,
        discount: enrollment.discount,
        enrollmentId: enrollment._id
      });
      entry.totalEnrollments++;
    });
    
    const students = Array.from(studentMap.values());
    res.json(students);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/enrollment/:id/discount', async (req, res) => {
  try {
    const { discount } = req.body;
    const enrollment = await Enrollment.findById(req.params.id).populate('batchId');
    
    if (!enrollment) return res.status(404).json({ error: 'Enrollment not found' });
    
    if (discount > enrollment.batchId.fees) {
      return res.status(400).json({ error: 'Discount cannot exceed batch fees' });
    }
    
    enrollment.discount = discount;
    enrollment.discountType = 'amount';
    await enrollment.save();
    
    const currentDate = new Date();
    const month = currentDate.toLocaleString('en-US', { month: 'long' });
    const year = currentDate.getFullYear();
    
    const fee = await Fee.findOne({
      studentId: enrollment.studentId,
      batchId: enrollment.batchId,
      month,
      year
    });
    
    if (fee) {
      fee.discount = discount;
      fee.amount = fee.originalAmount - discount;
      await fee.save();
    }
    
    res.json(enrollment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/attendance', async (req, res) => {
  try {
    const { batchId, month, year } = req.query;
    const query = { batchId };
    
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0);
      query.date = { $gte: startDate, $lte: endDate };
    }

    const attendance = await Attendance.find(query)
      .populate('studentId')
      .sort({ date: -1 });
    
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/attendance/:id/review', async (req, res) => {
  try {
    const attendance = await Attendance.findByIdAndUpdate(
      req.params.id,
      { review: req.body.review },
      { new: true }
    );
    res.json(attendance);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/promote', async (req, res) => {
  try {
    const teacher = await Teacher.findOne({ userId: req.user._id });
    const { studentId, batchId, action, newBatchId } = req.body;

    const enrollment = await Enrollment.findOne({
      studentId,
      batchId,
      teacherId: teacher._id
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'Enrollment not found' });
    }

    if (action === 'promote') {
      if (!newBatchId) {
        return res.status(400).json({ error: 'newBatchId is required to promote to another batch' });
      }
      const newBatch = await Batch.findOne({ _id: newBatchId, teacherId: teacher._id });
      if (!newBatch) {
        return res.status(404).json({ error: 'Target batch not found' });
      }

      const dup = await Enrollment.findOne({
        studentId,
        batchId: newBatchId,
        status: 'active'
      });
      if (dup) {
        return res.status(400).json({ error: 'Student is already enrolled in the target batch' });
      }

      const oldBatchId = enrollment.batchId;

      await Fee.updateMany(
        { studentId, batchId: oldBatchId, teacherId: teacher._id },
        { $set: { batchId: newBatchId } }
      );

      enrollment.batchId = newBatchId;
      enrollment.status = 'active';
      await enrollment.save();

      const student = await Student.findById(studentId);
      if (student && newBatch.class) {
        student.class = newBatch.class;
        await student.save();
      }
    } else if (action === 'fail') {
      enrollment.status = 'failed';
      await enrollment.save();
    } else if (action === 'left') {
      enrollment.status = 'left';
      await enrollment.save();
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    res.json({ message: 'Updated', enrollment });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
