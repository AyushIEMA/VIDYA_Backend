import nodemailer from 'nodemailer';

/** Gmail app passwords often include spaces in .env — strip them */
function normalizeSmtpPass(pass) {
  if (pass == null) return '';
  return String(pass).replace(/\s+/g, '');
}

export function getEmailEnvStatus() {
  const user = process.env.EMAIL_USER?.trim();
  const pass = normalizeSmtpPass(process.env.EMAIL_PASS);
  const missing = [];
  if (!user) missing.push('EMAIL_USER');
  if (!pass) missing.push('EMAIL_PASS');
  return { ok: missing.length === 0, missing, user };
}

function buildTransportConfig() {
  const { ok, missing, user } = getEmailEnvStatus();
  if (!ok) {
    return { error: `Missing mail env: ${missing.join(', ')}` };
  }

  const pass = normalizeSmtpPass(process.env.EMAIL_PASS);
  const host = process.env.EMAIL_SMTP_HOST?.trim();
  const portRaw = process.env.EMAIL_SMTP_PORT?.trim();
  const port = portRaw ? parseInt(portRaw, 10) : (host ? 587 : undefined);
  const secureEnv = process.env.EMAIL_SMTP_SECURE?.toLowerCase();
  const secure = secureEnv === 'true' || secureEnv === '1' || port === 465;

  if (host) {
    return {
      config: {
        host,
        port: Number.isFinite(port) ? port : 587,
        secure,
        auth: { user, pass }
      }
    };
  }

  return {
    config: {
      service: 'gmail',
      auth: { user, pass }
    }
  };
}

let transporter = null;

export function getMailTransporter() {
  const built = buildTransportConfig();
  if (built.error) {
    const err = new Error(built.error);
    err.code = 'EMAIL_CONFIG';
    throw err;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport(built.config);
    console.log('[email] Transporter created', {
      mode: built.config.service || 'smtp',
      host: built.config.host || '(gmail service)',
      port: built.config.port
    });
  }
  return transporter;
}

/**
 * @param {string} email
 * @param {string} otp
 * @param {{ resetLink?: string }} [opts]
 */
export async function sendOTPEmail(email, otp, opts = {}) {
  const { resetLink } = opts;
  const from = process.env.EMAIL_USER?.trim();

  if (!from) {
    throw new Error('EMAIL_USER is not set');
  }

  const transporter = getMailTransporter();

  const htmlParts = [
    `<p>Your OTP for password reset is: <strong>${otp}</strong></p>`,
    '<p>Valid for 10 minutes.</p>'
  ];
  if (resetLink) {
    htmlParts.push(`<p>Or reset in one step: <a href="${resetLink}">Open reset link</a></p>`);
    htmlParts.push(`<p style="font-size:12px;color:#666">If the button does not work, copy this URL:<br/>${resetLink}</p>`);
  }

  const mailOptions = {
    from: `"Vidya" <${from}>`,
    to: email,
    subject: 'Your password reset — Vidya',
    text: `Your OTP is: ${otp}. Valid 10 minutes.${resetLink ? ` Reset link: ${resetLink}` : ''}`,
    html: htmlParts.join('')
  };

  console.log('[email] sendMail start', { to: email, hasResetLink: !!resetLink });

  const info = await transporter.sendMail(mailOptions);

  console.log('[email] sendMail ok', {
    to: email,
    messageId: info.messageId,
    response: info.response
  });

  return info;
}

export async function sendOrgTeacherCredentials(email, password, credentials = {}) {
  const { loginUrl } = credentials;
  const from = process.env.EMAIL_USER?.trim();
  if (!from) throw new Error('EMAIL_USER is not set');

  const transporter = getMailTransporter();

  const htmlParts = [
    `<p>Your Vidya organization teacher credentials have been created.</p>`,
    `<p><strong>Email:</strong> ${email}</p>`,
    `<p><strong>Password:</strong> ${password}</p>`
  ];

  if (loginUrl) {
    htmlParts.push(`<p>Login: <a href="${loginUrl}">${loginUrl}</a></p>`);
    htmlParts.push(
      `<p style="font-size:12px;color:#666">If the button does not work, copy this URL:<br/>${loginUrl}</p>`
    );
  }

  htmlParts.push(
    `<p style="margin-top:14px;color:#64748b">For security, you must reset your password on first login.</p>`
  );

  const mailOptions = {
    from: `"Vidya" <${from}>`,
    to: email,
    subject: 'Organization Teacher Credentials - Vidya',
    text: `Email: ${email}\nPassword: ${password}\n${loginUrl ? `Login: ${loginUrl}\n` : ''}`,
    html: htmlParts.join('')
  };

  console.log('[email] sendOrgTeacherCredentials start', { to: email, hasLoginUrl: !!loginUrl });
  const info = await transporter.sendMail(mailOptions);
  console.log('[email] sendOrgTeacherCredentials ok', { to: email, messageId: info.messageId });
  return info;
}
