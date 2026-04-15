import axios from 'axios';

const API_BASE = 'http://localhost:8080/api';
const api = axios.create({ baseURL: API_BASE });

let teacherToken, studentToken, teacherId, studentId, batchId;

const log = (msg, data) => console.log(`\n✓ ${msg}`, data ? JSON.stringify(data, null, 2) : '');
const error = (msg, err) => console.error(`\n✗ ${msg}:`, err.response?.data || err.message);

async function runSmokeTest() {
  console.log('🔥 Starting Smoke Test...\n');

  try {
    console.log('=== HEALTH CHECK ===');
    const health = await axios.get('http://localhost:8080/health');
    log('Health check', health.data);

    console.log('\n=== TEACHER REGISTRATION ===');
    const teacherData = {
      email: `teacher${Date.now()}@test.com`,
      password: 'Test123!',
      firstName: 'John',
      lastName: 'Doe',
      address: '123 Main St',
      location: { lat: 28.6139, lng: 77.2090 },
      profession: 'Teacher',
      experience: '5 years',
      education: 'M.Ed',
      schoolCollege: 'ABC School',
      subjects: ['Math', 'Science'],
      avgFees: 5000,
      mobile: '+919876543210',
      whatsapp: '+919876543210',
      gender: 'male'
    };
    const teacherReg = await api.post('/auth/register/teacher', teacherData);
    teacherToken = teacherReg.data.token;
    teacherId = teacherReg.data.teacher._id;
    log('Teacher registered', { teacherCode: teacherReg.data.teacher.teacherCode });

    console.log('\n=== STUDENT REGISTRATION ===');
    const studentData = {
      email: `student${Date.now()}@test.com`,
      password: 'Test123!',
      name: 'Jane Smith',
      address: '456 Park Ave',
      mobile: '+919876543211',
      whatsapp: '+919876543211',
      parentWhatsapp: '+919876543212',
      parentCall: '+919876543212',
      class: 'Class 10',
      board: 'CBSE'
    };
    const studentReg = await api.post('/auth/register/student', studentData);
    studentToken = studentReg.data.token;
    studentId = studentReg.data.student._id;
    log('Student registered', { studentId });

    console.log('\n=== LOGIN TEST ===');
    const login = await api.post('/auth/login', { email: teacherData.email, password: teacherData.password });
    log('Login successful', { role: login.data.user.role });

    console.log('\n=== TEACHER DASHBOARD ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${teacherToken}`;
    const stats = await api.get('/teacher/dashboard/stats');
    log('Dashboard stats', stats.data);

    console.log('\n=== CREATE BATCH ===');
    const batchData = {
      batchName: 'Math Advanced',
      class: 'Class 10',
      board: 'CBSE',
      location: { lat: 28.6139, lng: 77.2090 },
      subjects: ['Math', 'Physics'],
      days: ['Monday', 'Wednesday', 'Friday'],
      startTime: '10:00',
      fees: 3000
    };
    const batch = await api.post('/teacher/batch', batchData);
    batchId = batch.data._id;
    log('Batch created', { batchId, batchName: batch.data.batchName });

    console.log('\n=== GET BATCHES ===');
    const batches = await api.get('/teacher/batch?page=1&limit=10');
    log('Fetched batches', { count: batches.data.batches.length });

    console.log('\n=== STUDENT ENROLL ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${studentToken}`;
    const enroll = await api.post('/student/enroll', { batchId });
    log('Student enrolled', { discount: enroll.data.discount });

    console.log('\n=== STUDENT BATCHES ===');
    const studentBatches = await api.get('/student/batches');
    log('Student batches', { count: studentBatches.data.length });

    console.log('\n=== ANNOUNCEMENTS ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${teacherToken}`;
    const announcement = await api.post('/teacher/announcement', {
      title: 'Test Announcement',
      message: 'This is a test',
      targetType: 'all'
    });
    log('Announcement sent', { id: announcement.data._id });

    console.log('\n=== STUDENT NOTICES ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${studentToken}`;
    const notices = await api.get('/student/announcements');
    log('Student notices', { count: notices.data.length });

    console.log('\n=== CLASS LOG ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${teacherToken}`;
    const classLog = await api.post(`/teacher/batch/${batchId}/classlog`, {
      title: 'Chapter 1 Complete',
      description: 'Covered algebra basics'
    });
    log('Class log added', { id: classLog.data._id });

    console.log('\n=== REVIEWS ===');
    api.defaults.headers.common['Authorization'] = `Bearer ${studentToken}`;
    const review = await api.post('/student/review', {
      batchId,
      rating: 5,
      comment: 'Excellent teaching!'
    });
    log('Review submitted', { id: review.data._id });

    console.log('\n=== BATCH REVIEWS ===');
    const reviews = await api.get(`/batch/${batchId}/reviews`);
    log('Batch reviews', { avgRating: reviews.data.avgRating });

    console.log('\n✅ ALL SMOKE TESTS PASSED!\n');
  } catch (err) {
    error('SMOKE TEST FAILED', err);
    process.exit(1);
  }
}

runSmokeTest();
