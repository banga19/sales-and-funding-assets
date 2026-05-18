import nodemailer, { SentMessageInfo } from 'nodemailer';

const SMTP_HOST     = process.env.SMTP_HOST     || 'smtp.gmail.com';
const SMTP_PORT     = Number(process.env.SMTP_PORT) || 587;
const SMTP_SECURE   = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
const SMTP_USER     = process.env.SMTP_USER     || '';
const SMTP_PASS     = process.env.SMTP_PASS     || '';
const EMAIL_FROM    = process.env.EMAIL_FROM    || 'sales@yourcompany.com';

/** Singleton transporter — reused across sends */
let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[email] SMTP_USER / SMTP_PASS not configured — using ethereal test transport');
    return nodemailer.createTransport({ jsonTransport: true } as any);
  }
  transporter = nodemailer.createTransport({
    host:     SMTP_HOST,
    port:     SMTP_PORT,
    secure:   SMTP_SECURE,
    auth:     { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

export interface SendEmailOptions {
  to:      string;
  subject: string;
  html:    string;
}

export async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<SentMessageInfo> {
  const tx = getTransporter();
  const info = await tx.sendMail({
    from:    EMAIL_FROM,
    to,
    subject,
    html,
  });
  return info;
}

/** Quick-connect test to verify SMTP credentials at startup. */
export async function verifyConnection(): Promise<boolean> {
  try {
    await getTransporter().verify();
    return true;
  } catch {
    return false;
  }
}
