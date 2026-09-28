require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
if (String(process.env.TRUST_PROXY || 'false').toLowerCase() === 'true') app.set('trust proxy', 1);
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const APP_NAME = process.env.APP_NAME || 'ARU IT Ticketing';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const INTERNAL_DOMAIN = String(process.env.INTERNAL_EMAIL_DOMAIN || 'aruraharja.co.id').toLowerCase();
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const TICKET_UPLOAD_DIR = path.join(UPLOAD_DIR, 'tickets');
const RESOLUTION_UPLOAD_DIR = path.join(UPLOAD_DIR, 'resolutions');

// Business data is persisted in MySQL. These are logical collection keys
// retained so the V4 application flow can stay simple and compact.
const USERS_FILE = 'users';
const TICKETS_FILE = 'tickets';
const TOKENS_FILE = 'tokens';
const PICS_FILE = 'pics';

const DB_CONFIG = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'aru_ticketing',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 5),
  queueLimit: 0,
  timezone: 'Z'
};

const TABLES = { users:'aru_users', tickets:'aru_tickets', tokens:'aru_email_tokens', pics:'aru_pics' };
const memoryStore = { users:[], tickets:[], tokens:[], pics:[] };
let dbPool = null;
let dbWriteQueue = Promise.resolve();

const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || 10);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const OTP_EXPIRE_MINUTES = Number(process.env.OTP_EXPIRE_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const IMAGE_MAX_WIDTH = Number(process.env.IMAGE_MAX_WIDTH || 1920);
const IMAGE_MAX_HEIGHT = Number(process.env.IMAGE_MAX_HEIGHT || 1920);
const IMAGE_WEBP_QUALITY = Number(process.env.IMAGE_WEBP_QUALITY || 72);

for (const dir of [UPLOAD_DIR, TICKET_UPLOAD_DIR, RESOLUTION_UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

function readJson(collection) { return memoryStore[collection] || []; }

function sqlDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function rowValues(collection, item) {
  const payload = JSON.stringify(item);
  if (collection === USERS_FILE) return [item.id,item.username||'',item.email||'',item.name||'',item.role||'user',item.status||'active',item.isDemo?1:0,sqlDate(item.createdAt),sqlDate(item.updatedAt||item.createdAt),payload];
  if (collection === TICKETS_FILE) return [item.id,item.status||'Open',item.priority||'Unassigned',item.category||'Other',item.requester?.userId||null,item.createdBy?.userId||null,picKey(item.assignedTo)||null,item.resolvedBy?.userId||null,item.isDemo?1:0,sqlDate(item.createdAt),sqlDate(item.updatedAt||item.createdAt),sqlDate(item.resolvedAt),payload];
  if (collection === PICS_FILE) return [item.id,item.name||'',item.contact||'',item.isDemo?1:0,sqlDate(item.createdAt),sqlDate(item.updatedAt||item.createdAt),payload];
  if (collection === TOKENS_FILE) return [item.id,item.userId||null,item.purpose||'',sqlDate(item.expiresAt),sqlDate(item.consumedAt),sqlDate(item.invalidatedAt),payload];
  throw new Error(`Unknown collection: ${collection}`);
}

async function persistCollection(collection, data) {
  if (!dbPool) throw new Error('MySQL belum siap.');
  const table = TABLES[collection];
  const conn = await dbPool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM \`${table}\``);
    if (data.length) {
      let sql='';
      if (collection===USERS_FILE) sql=`INSERT INTO \`${table}\` (id,username,email,name,role,status,is_demo,created_at,updated_at,payload) VALUES ?`;
      if (collection===TICKETS_FILE) sql=`INSERT INTO \`${table}\` (id,status,priority,category,requester_user_id,creator_user_id,pic_key,solver_user_id,is_demo,created_at,updated_at,resolved_at,payload) VALUES ?`;
      if (collection===PICS_FILE) sql=`INSERT INTO \`${table}\` (id,name,contact,is_demo,created_at,updated_at,payload) VALUES ?`;
      if (collection===TOKENS_FILE) sql=`INSERT INTO \`${table}\` (id,user_id,purpose,expires_at,consumed_at,invalidated_at,payload) VALUES ?`;
      await conn.query(sql,[data.map(item=>rowValues(collection,item))]);
    }
    await conn.commit();
  } catch(err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally { conn.release(); }
}

let lastDbWriteError = null;
function writeJson(collection, data) {
  // Fast single-process cache + serialized MySQL write-through. No JSON business files.
  memoryStore[collection] = data;
  const snapshot = JSON.parse(JSON.stringify(data));
  dbWriteQueue = dbWriteQueue.catch(()=>{}).then(async()=>{
    try {
      await persistCollection(collection,snapshot);
      lastDbWriteError = null;
    } catch (err) {
      lastDbWriteError = err;
      console.error(`MySQL write failed for ${collection}:`,err.message);
    }
  });
  return dbWriteQueue;
}
async function flushDbWrites(){
  await dbWriteQueue;
  if (lastDbWriteError) throw lastDbWriteError;
}

async function ensureSchema(){
  dbPool=mysql.createPool(DB_CONFIG);
  const statements=[
    `CREATE TABLE IF NOT EXISTS aru_users (id VARCHAR(64) PRIMARY KEY, username VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL, name VARCHAR(190) NOT NULL, role VARCHAR(32) NOT NULL, status VARCHAR(40) NOT NULL, is_demo TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME(3) NULL, updated_at DATETIME(3) NULL, payload LONGTEXT NOT NULL, UNIQUE KEY uq_aru_users_username (username), UNIQUE KEY uq_aru_users_email (email), KEY idx_aru_users_role_status (role,status), KEY idx_aru_users_demo (is_demo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS aru_pics (id VARCHAR(64) PRIMARY KEY, name VARCHAR(190) NOT NULL, contact VARCHAR(255) NOT NULL, is_demo TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME(3) NULL, updated_at DATETIME(3) NULL, payload LONGTEXT NOT NULL, KEY idx_aru_pics_name (name), KEY idx_aru_pics_demo (is_demo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS aru_tickets (id VARCHAR(64) PRIMARY KEY, status VARCHAR(48) NOT NULL, priority VARCHAR(24) NOT NULL, category VARCHAR(80) NOT NULL, requester_user_id VARCHAR(64) NULL, creator_user_id VARCHAR(64) NULL, pic_key VARCHAR(160) NULL, solver_user_id VARCHAR(64) NULL, is_demo TINYINT(1) NOT NULL DEFAULT 0, created_at DATETIME(3) NULL, updated_at DATETIME(3) NULL, resolved_at DATETIME(3) NULL, payload LONGTEXT NOT NULL, KEY idx_aru_tickets_status (status), KEY idx_aru_tickets_priority (priority), KEY idx_aru_tickets_category (category), KEY idx_aru_tickets_created (created_at), KEY idx_aru_tickets_pic (pic_key), KEY idx_aru_tickets_creator (creator_user_id), KEY idx_aru_tickets_solver (solver_user_id), KEY idx_aru_tickets_demo (is_demo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS aru_email_tokens (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NULL, purpose VARCHAR(40) NOT NULL, expires_at DATETIME(3) NULL, consumed_at DATETIME(3) NULL, invalidated_at DATETIME(3) NULL, payload LONGTEXT NOT NULL, KEY idx_aru_tokens_user_purpose (user_id,purpose), KEY idx_aru_tokens_expiry (expires_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS aru_sessions (session_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, expires INT UNSIGNED NOT NULL, data MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin, PRIMARY KEY (session_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
  for(const sql of statements) await dbPool.query(sql);
}

async function loadCollectionsFromMySQL(){
  for(const collection of [USERS_FILE,TICKETS_FILE,TOKENS_FILE,PICS_FILE]){
    const [rows]=await dbPool.query(`SELECT payload FROM \`${TABLES[collection]}\``);
    memoryStore[collection]=rows.map(row=>{
      try{return typeof row.payload==='string'?JSON.parse(row.payload):row.payload;}
      catch(err){console.error(`Invalid payload in ${TABLES[collection]}:`,err.message);return null;}
    }).filter(Boolean);
  }
}

function nowIso() { return new Date().toISOString(); }
function uid(prefix='ID') { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function isAdminRole(role) { return role === 'admin' || role === 'root_admin'; }
function isSupervisorRole(role) { return role === 'supervisor'; }
function isStaffViewRole(role) { return isAdminRole(role) || isSupervisorRole(role); }
function normalizeSupportType(value='Both') {
  const v=String(value||'Both').trim().toLowerCase();
  if(v==='network')return 'Network';
  if(v==='it')return 'IT';
  return 'Both';
}
function supportMatches(personOrType, issueType) {
  const supportType=normalizeSupportType(typeof personOrType==='string'?personOrType:personOrType?.supportType);
  const issue=String(issueType||'IT')==='Network'?'Network':'IT';
  return supportType==='Both'||supportType===issue;
}
function isInternalEmail(email='') { return String(email).trim().toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`); }
function normalizeEmail(email='') { return String(email).trim().toLowerCase(); }
function picKey(pic) {
  if (!pic) return '';
  if (pic.key) return String(pic.key);
  if (pic.type === 'external' && pic.picId) return `external:${pic.picId}`;
  if (pic.userId) return `admin:${pic.userId}`;
  return pic.name ? `name:${String(pic.name).trim().toLowerCase()}` : '';
}
function externalPicDirectory() {
  return readJson(PICS_FILE).filter(p=>p && p.id && p.name).sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
}
function adminPicDirectory() {
  return readJson(USERS_FILE)
    .filter(u=>isAdminRole(u.role) && u.status==='active')
    .map(u=>({
      key:`admin:${u.id}`, type:'admin', userId:u.id, name:u.name,
      contact:u.phone && u.phone!=='-' ? u.phone : (u.email||'-'),
      email:u.email||'', department:u.department||'', label:u.label||roleLabelForServer(u.role),
      supportType:normalizeSupportType(u.supportType||'Both')
    }))
    .sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
}
function roleLabelForServer(role) { return role==='root_admin'?'Root Administrator':role==='admin'?'Administrator':role==='supervisor'?'Admin Supervisor':'User'; }
function combinedPicDirectory() {
  return [
    ...adminPicDirectory(),
    ...externalPicDirectory().map(p=>({key:`external:${p.id}`,type:'external',picId:p.id,name:p.name,contact:p.contact||'-',email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.contact||''))?String(p.contact).trim():'',department:'PIC Non-Admin',label:'External / Support PIC',supportType:normalizeSupportType(p.supportType||'Both')}))
  ];
}
function resolvePicSelection(value) {
  const key=String(value||'').trim();
  if(!key)return null;
  return combinedPicDirectory().find(p=>p.key===key)||null;
}
function sanitizeFilename(name='file') { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-110) || 'file'; }
function maskedEmail(email='') {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length-visible.length))}@${domain}`;
}
function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}
function otpHash(code) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aru-dev-secret').update(String(code)).digest('hex');
}
function randomOtp() { return String(crypto.randomInt(100000, 1000000)); }
function formatDateId(v) {
  if (!v) return '-';
  try { return new Intl.DateTimeFormat('id-ID', { dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Jakarta' }).format(new Date(v)); }
  catch { return String(v); }
}
function jakartaDateKey(v) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(v));
    const get=t=>parts.find(p=>p.type===t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch { return ''; }
}

// Normalize data created by previous versions.
async function migrateUsers(){
  const users = readJson(USERS_FILE);
  let changed = false;
  for (const u of users) {
    if (u.emailVerified === undefined) { u.emailVerified = u.status === 'active'; changed = true; }
    if (u.emailVerified && !u.emailVerifiedAt) { u.emailVerifiedAt = u.approvedAt || u.createdAt || nowIso(); changed = true; }
    if (u.status === 'pending') { u.status = u.emailVerified ? 'pending_approval' : 'pending_verification'; changed = true; }
    if (u.status === 'pending_verification' && !isInternalEmail(u.email)) { u.status = 'pending_approval'; u.registrationMethod = 'external_admin_approval'; changed = true; }
    if ((u.role==='admin'||u.role==='root_admin') && !u.supportType) { u.supportType='Both'; changed = true; }
    if (u.role==='supervisor' && !u.supportType) { u.supportType='Both'; changed = true; }
  }
  if (changed) await writeJson(USERS_FILE, users);
}

function inferIssueType(ticket){
  const explicit=String(ticket?.issueType||'').trim();
  if(explicit==='Network'||explicit==='IT')return explicit;
  return /network|wi-?fi|internet|lan|router|switch|isp/i.test(`${ticket?.category||''} ${ticket?.title||''}`)?'Network':'IT';
}
function inferRequestKind(ticket){
  const explicit=String(ticket?.requestKind||ticket?.ticketType||'').trim().toLowerCase();
  if(['request','permintaan','service request'].includes(explicit))return 'Request';
  if(['issue','incident','kendala','problem'].includes(explicit))return 'Issue';
  const hay=`${ticket?.category||''} ${ticket?.title||''} ${ticket?.description||''}`.toLowerCase();
  return /permintaan|request|pengajuan|instal(?:l|asi)?|setup|set up|pembuatan|buat akun|akses baru|penambahan|upgrade|pengadaan|aktivasi|registrasi|konfigurasi|provision|onboarding/i.test(hay)?'Request':'Issue';
}
function requestKindLabel(value){
  return inferRequestKind({requestKind:value})==='Request'?'Permintaan':'Kendala';
}
function estimateToMinutes(text=''){
  const v=String(text||'').toLowerCase().trim();
  if(!v||v==='tba')return null;
  if(/hari ini|secepatnya/.test(v))return 8*60;
  const nums=(v.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>Number(x.replace(',','.'))).filter(Number.isFinite);
  const n=nums.length?Math.max(...nums):null;
  if(n==null)return null;
  if(/menit/.test(v))return Math.round(n);
  if(/jam/.test(v))return Math.round(n*60);
  if(/hari/.test(v))return Math.round(n*8*60);
  return null;
}
function targetDueAtFrom(baseIso, minutes){
  if(!baseIso||!Number.isFinite(Number(minutes)))return null;
  return new Date(new Date(baseIso).getTime()+Number(minutes)*60000).toISOString();
}
function targetDueAtFromEstimate(baseIso,text,minutes){
  const v=String(text||'').toLowerCase();
  const nums=(v.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>Number(x.replace(',','.'))).filter(Number.isFinite);
  if(/hari/.test(v)&&nums.length){
    let remaining=Math.max(...nums);
    const d=new Date(baseIso);
    while(remaining>0){
      d.setUTCDate(d.getUTCDate()+1);
      const day=d.getUTCDay();
      if(day!==0&&day!==6)remaining--;
    }
    return d.toISOString();
  }
  return targetDueAtFrom(baseIso,minutes);
}
async function migrateTickets(){
  const tickets=readJson(TICKETS_FILE);let changed=false;
  for(const t of tickets){
    if(!t.issueType){t.issueType=inferIssueType(t);changed=true;}
    if(!t.requestKind){t.requestKind=inferRequestKind(t);changed=true;}
    if(t.isPublic===undefined){t.isPublic=false;changed=true;}
    if(!t.estimateSetAt){t.estimateSetAt=t.createdAt||nowIso();changed=true;}
    if(!t.processingEstimate){t.processingEstimate=normalizeEstimateParts(null,t.estimatedProcessing);changed=true;}
    if(!t.completionEstimate){t.completionEstimate=normalizeEstimateParts(null,t.estimatedCompletion);changed=true;}
    const normalizedProcessing=estimatePartsLabel(t.processingEstimate);
    const normalizedCompletion=estimatePartsLabel(t.completionEstimate);
    if(t.estimatedProcessing!==normalizedProcessing){t.estimatedProcessing=normalizedProcessing;changed=true;}
    if(t.estimatedCompletion!==normalizedCompletion){t.estimatedCompletion=normalizedCompletion;changed=true;}
    const processEstimate=estimatePartsToMinutes(t.processingEstimate);
    const totalEstimate=estimatePartsToMinutes(t.completionEstimate);
    if(t.estimatedProcessingMinutes!==processEstimate){t.estimatedProcessingMinutes=processEstimate;changed=true;}
    if(t.estimatedCompletionMinutes!==totalEstimate){t.estimatedCompletionMinutes=totalEstimate;changed=true;}
    if(!t.processTargetAt && processEstimate){
      t.processTargetAt=targetDueAtFromParts(t.estimateSetAt||t.createdAt,t.processingEstimate);changed=true;
    }
    if(!t.targetDueAt && totalEstimate){
      t.targetDueAt=targetDueAtFromParts(t.estimateSetAt||t.createdAt,t.completionEstimate);changed=true;
    }
    if(!t.resolutionMode && t.status==='Finished'){
      t.resolutionMode=t.userConfirmation?.confirmed?'user_confirm':'self_confirm';changed=true;
    }
    if(t.status==='Reopened'&&t.resolvedAt){
      t.resolutionHistory=t.resolutionHistory||[];
      t.resolutionHistory.push({resolvedAt:t.resolvedAt,resolvedBy:t.resolvedBy||null,resolutionMode:t.resolutionMode||'user_confirm',resolutionNote:t.resolutionNote||'',migratedFromReopened:true});
      t.resolvedAt=null;t.resolvedBy=null;t.resolutionMode=null;t.resolutionNote='';changed=true;
    }
  }
  if(changed)await writeJson(TICKETS_FILE,tickets);
}

// Seed root admin only when no root exists.
async function seedRoot(){
  const users = readJson(USERS_FILE);
  if (!users.some(u => u.role === 'root_admin')) {
    const rootEmail=normalizeEmail(process.env.ROOT_ADMIN_EMAIL||'');
    const rootPassword=String(process.env.ROOT_ADMIN_PASSWORD||'');
    if(!rootEmail||!rootPassword){
      throw new Error('Belum ada Root Admin. Isi ROOT_ADMIN_EMAIL dan ROOT_ADMIN_PASSWORD di .env untuk seed pertama.');
    }
    const createdAt = nowIso();
    users.push({
      id: uid('USR'),
      username: process.env.ROOT_ADMIN_USERNAME || 'admin',
      name: process.env.ROOT_ADMIN_NAME || 'Root Admin',
      email: rootEmail,
      phone: '-',
      department: process.env.ROOT_ADMIN_DEPARTMENT || 'IT Web Development & Operations',
      label: 'Root Administrator',
      role: 'root_admin',
      supportType:'Both',
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: createdAt,
      passwordHash: bcrypt.hashSync(rootPassword, 12),
      createdAt,
      approvedAt: createdAt,
      approvedBy: 'SYSTEM'
    });
    await writeJson(USERS_FILE, users);
    console.log('Root administrator seeded. Credentials are loaded from environment variables.');
  }
}

const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const mailer = smtpConfigured ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
  requireTLS: String(process.env.SMTP_REQUIRE_TLS || 'true').toLowerCase() === 'true',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  tls: { minVersion: 'TLSv1.2' },
  pool: true,
  maxConnections: 3,
  maxMessages: 100
}) : null;

if (mailer) {
  mailer.verify().then(() => console.log(`SMTP ready: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`))
    .catch(err => console.warn('SMTP verification warning:', err.message));
} else {
  console.warn('SMTP is not configured. Email verification and password reset will not work until .env is configured.');
}

function mailShell(title, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#13223d"><div style="max-width:640px;margin:0 auto;padding:32px 16px"><div style="background:#0c3978;color:white;border-radius:18px 18px 0 0;padding:24px 28px"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7edcff;font-weight:700">PT ARU RAHARJA · IT SERVICE DESK</div><h1 style="font-size:24px;margin:8px 0 0">${title}</h1></div><div style="background:white;border:1px solid #dce5ef;border-top:0;border-radius:0 0 18px 18px;padding:28px;line-height:1.6">${bodyHtml}<div style="border-top:1px solid #e8eef5;margin-top:28px;padding-top:18px;color:#6b7890;font-size:12px">Pesan otomatis dari ${APP_NAME}. Mohon tidak membalas email ini.</div></div></div></body></html>`;
}
async function sendEmail(to, subject, bodyHtml, required=false) {
  if (!to) return false;
  if (!mailer) {
    if (required) throw new Error('SMTP belum dikonfigurasi.');
    return false;
  }
  try {
    await mailer.sendMail({
      from: `"${process.env.MAIL_FROM_NAME || APP_NAME}" <${process.env.MAIL_FROM_ADDRESS || process.env.SMTP_USER}>`,
      to,
      subject,
      html: mailShell(subject, bodyHtml)
    });
    return true;
  } catch (err) {
    console.error('Email failed:', to, subject, err.message);
    if (required) throw new Error('Email gagal dikirim. Periksa konfigurasi SMTP atau coba lagi beberapa saat.');
    return false;
  }
}
function otpEmailBody(name, code, purpose) {
  const action = purpose === 'registration' ? 'verifikasi alamat email untuk registrasi akun' : 'reset password akun';
  return `<p>Halo <strong>${escapeHtml(name || 'Pengguna')}</strong>,</p><p>Gunakan kode berikut untuk ${action}:</p><div style="font-size:34px;letter-spacing:8px;font-weight:800;color:#0b3b82;background:#f2f7fc;border-radius:14px;padding:18px;text-align:center;margin:22px 0">${code}</div><p>Kode berlaku selama <strong>${OTP_EXPIRE_MINUTES} menit</strong> dan hanya dapat digunakan satu kali.</p><p style="color:#6b7890">Jika Anda tidak melakukan permintaan ini, abaikan email ini.</p>`;
}
function escapeHtml(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function invalidateTokens(tokens, userId, purpose) {
  const at = nowIso();
  for (const t of tokens) if (t.userId === userId && t.purpose === purpose && !t.consumedAt && !t.invalidatedAt) t.invalidatedAt = at;
}
async function issueOtp(user, purpose, { ignoreCooldown=false }={}) {
  const tokens = readJson(TOKENS_FILE);
  const latest = tokens.filter(t => t.userId === user.id && t.purpose === purpose).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  if (!ignoreCooldown && latest && (Date.now() - new Date(latest.createdAt).getTime()) < OTP_RESEND_SECONDS * 1000) {
    const wait = Math.ceil((OTP_RESEND_SECONDS*1000 - (Date.now()-new Date(latest.createdAt).getTime()))/1000);
    const err = new Error(`Tunggu ${wait} detik sebelum mengirim ulang kode.`); err.status = 429; throw err;
  }
  invalidateTokens(tokens, user.id, purpose);
  const code = randomOtp();
  const record = {
    id: uid('OTP'), userId:user.id, email:user.email, purpose,
    codeHash: otpHash(code), attempts:0, maxAttempts:OTP_MAX_ATTEMPTS,
    createdAt:nowIso(), expiresAt:new Date(Date.now()+OTP_EXPIRE_MINUTES*60*1000).toISOString(), consumedAt:null, invalidatedAt:null
  };
  tokens.push(record);
  writeJson(TOKENS_FILE, tokens);
  try {
    await sendEmail(user.email, purpose === 'registration' ? 'Kode Verifikasi Akun IT Ticketing' : 'Kode Reset Password IT Ticketing', otpEmailBody(user.name, code, purpose), true);
  } catch (err) {
    const fresh = readJson(TOKENS_FILE); const r = fresh.find(t=>t.id===record.id); if(r) r.invalidatedAt=nowIso(); writeJson(TOKENS_FILE,fresh); throw err;
  }
  return record;
}
function consumeOtp(userId, purpose, code) {
  const tokens = readJson(TOKENS_FILE);
  const active = tokens.filter(t => t.userId===userId && t.purpose===purpose && !t.consumedAt && !t.invalidatedAt).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  if (!active) return { ok:false, error:'Kode tidak ditemukan atau sudah tidak berlaku.' };
  if (new Date(active.expiresAt).getTime() < Date.now()) { active.invalidatedAt=nowIso(); writeJson(TOKENS_FILE,tokens); return {ok:false,error:'Kode sudah kedaluwarsa. Silakan kirim ulang kode.'}; }
  if (active.attempts >= OTP_MAX_ATTEMPTS) { active.invalidatedAt=nowIso(); writeJson(TOKENS_FILE,tokens); return {ok:false,error:'Batas percobaan kode tercapai. Silakan kirim kode baru.'}; }
  if (otpHash(code) !== active.codeHash) {
    active.attempts += 1;
    if (active.attempts >= OTP_MAX_ATTEMPTS) active.invalidatedAt=nowIso();
    writeJson(TOKENS_FILE,tokens);
    return {ok:false,error:`Kode tidak sesuai. Sisa percobaan ${Math.max(0,OTP_MAX_ATTEMPTS-active.attempts)}.`};
  }
  active.consumedAt=nowIso(); writeJson(TOKENS_FILE,tokens); return {ok:true};
}

app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
const mysqlSessionStore = new MySQLSessionStore({
  ...DB_CONFIG,
  clearExpired:true,
  checkExpirationInterval:15*60*1000,
  expiration:SESSION_HOURS*60*60*1000,
  createDatabaseTable:true,
  schema:{tableName:'aru_sessions',columnNames:{session_id:'session_id',expires:'expires',data:'data'}}
});
app.use(session({
  store:mysqlSessionStore,
  secret:process.env.SESSION_SECRET || 'aru-ticketing-dev-secret-change-me',
  resave:false,
  saveUninitialized:false,
  rolling:true,
  cookie:{httpOnly:true,sameSite:'lax',secure:String(process.env.SESSION_COOKIE_SECURE||'false').toLowerCase()==='true',maxAge:1000*60*60*SESSION_HOURS}
}));

// Security headers ringan tanpa mengganggu logo/font eksternal yang dipakai UI.
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});

const rateBuckets = new Map();
function rateLimit(name, windowMs, max){
  return (req,res,next)=>{
    const now=Date.now();const key=`${name}:${req.ip}`;let row=rateBuckets.get(key);
    if(!row||row.resetAt<=now)row={count:0,resetAt:now+windowMs};row.count++;rateBuckets.set(key,row);
    if(row.count>max)return res.status(429).json({error:'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'});
    next();
  };
}
const authLimiter=rateLimit('auth',15*60*1000,30);
const mailLimiter=rateLimit('mail',15*60*1000,15);
const guestLimiter=rateLimit('guest',15*60*1000,12);
app.use('/uploads', express.static(UPLOAD_DIR, { fallthrough:false, maxAge:'7d' }));
app.use(express.static(path.join(ROOT,'public')));

const allowedExt = new Set(['.jpg','.jpeg','.png','.webp','.gif','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt']);
const imageExt = new Set(['.jpg','.jpeg','.png','.webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: MAX_UPLOAD_FILES },
  fileFilter: (_, file, cb) => {
    const ext=path.extname(file.originalname).toLowerCase();
    const ok=allowedExt.has(ext);
    cb(ok?null:new Error('Tipe file tidak didukung.'), ok);
  }
});

async function saveUploadedFile(file, folderName) {
  const ext = path.extname(file.originalname).toLowerCase();
  const folder = folderName === 'resolutions' ? RESOLUTION_UPLOAD_DIR : TICKET_UPLOAD_DIR;
  const token = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const originalSize = file.size;

  // Evidence image diproses langsung dari memory, jadi file original tidak pernah
  // ditulis ke disk. Metadata juga dibuang oleh Sharp secara default.
  if (imageExt.has(ext)) {
    try {
      const compressed = await sharp(file.buffer)
        .rotate()
        .resize({ width:IMAGE_MAX_WIDTH, height:IMAGE_MAX_HEIGHT, fit:'inside', withoutEnlargement:true })
        .webp({ quality:IMAGE_WEBP_QUALITY, effort:5, smartSubsample:true })
        .toBuffer();

      // Untuk file yang sudah sangat optimal, simpan versi paling kecil agar benar-benar hemat storage.
      if (compressed.length < file.buffer.length) {
        const filename = `${token}.webp`;
        fs.writeFileSync(path.join(folder, filename), compressed);
        return {
          name:file.originalname, filename, size:compressed.length, originalSize,
          savedBytes:Math.max(0,originalSize-compressed.length), mimetype:'image/webp',
          compressed:true, url:`/uploads/${folderName}/${filename}`, uploadedAt:nowIso()
        };
      }
    } catch (err) {
      console.warn('Image compression fallback:', file.originalname, err.message);
    }
  }

  const filename = `${token}-${sanitizeFilename(file.originalname)}`;
  fs.writeFileSync(path.join(folder, filename), file.buffer);
  return {
    name:file.originalname, filename, size:file.size, originalSize,
    savedBytes:0, mimetype:file.mimetype, compressed:false,
    url:`/uploads/${folderName}/${filename}`, uploadedAt:nowIso()
  };
}
async function saveUploadedFiles(files, folderName) { return Promise.all((files||[]).map(f=>saveUploadedFile(f,folderName))); }

function removeStoredEvidenceFile(file){
  const url=String(file?.url||'').trim();
  let folder=null;
  if(url.startsWith('/uploads/tickets/')) folder=TICKET_UPLOAD_DIR;
  else if(url.startsWith('/uploads/resolutions/')) folder=RESOLUTION_UPLOAD_DIR;
  if(!folder)return false;

  const filename=path.basename(url);
  if(!filename)return false;
  const fullPath=path.join(folder,filename);

  try{
    if(fs.existsSync(fullPath)){
      fs.unlinkSync(fullPath);
      return true;
    }
  }catch(err){
    console.warn('Evidence cleanup warning:',fullPath,err.message);
  }
  return false;
}
function removeTicketEvidenceFiles(ticket){
  let removedFiles=0;
  for(const file of [...(ticket?.evidence||[]),...(ticket?.resolutionEvidence||[])]){
    if(removeStoredEvidenceFile(file))removedFiles++;
  }
  return removedFiles;
}

function auth(req,res,next){ if(!req.session.user) return res.status(401).json({error:'Silakan login.'}); next(); }
function adminOnly(req,res,next){ if(!req.session.user || !isAdminRole(req.session.user.role)) return res.status(403).json({error:'Akses admin diperlukan.'}); next(); }
function staffViewOnly(req,res,next){ if(!req.session.user || !isStaffViewRole(req.session.user.role)) return res.status(403).json({error:'Akses staff/supervisor diperlukan.'}); next(); }
function rootOnly(req,res,next){ if(!req.session.user || req.session.user.role!=='root_admin') return res.status(403).json({error:'Akses root admin diperlukan.'}); next(); }
function findSessionUser(req){ if(!req.session.user)return null; return readJson(USERS_FILE).find(u=>u.id===req.session.user.id)||null; }
function updateSession(req,u){ req.session.user={id:u.id,username:u.username,name:u.name,role:u.role,department:u.department,label:u.label,email:u.email,phone:u.phone||'',supportType:u.supportType||'Both'}; }
function findUserByIdentity(identity) { const key=String(identity||'').trim().toLowerCase(); return readJson(USERS_FILE).find(u=>String(u.username).toLowerCase()===key || String(u.email).toLowerCase()===key); }

const priorityDefaults={
  Critical:{processing:{days:0,hours:2,minutes:0},completion:{days:0,hours:8,minutes:0}},
  High:{processing:{days:0,hours:4,minutes:0},completion:{days:1,hours:0,minutes:0}},
  Medium:{processing:{days:1,hours:0,minutes:0},completion:{days:2,hours:0,minutes:0}},
  Low:{processing:{days:2,hours:0,minutes:0},completion:{days:5,hours:0,minutes:0}}
};

function normalizeEstimateParts(value, legacyText=''){
  let src=value;
  if(typeof src==='string'){
    try{src=JSON.parse(src);}catch{src=null;}
  }
  if(src && typeof src==='object'){
    const days=Math.max(0,Math.min(365,Math.floor(Number(src.days)||0)));
    const hours=Math.max(0,Math.min(23,Math.floor(Number(src.hours)||0)));
    const minutes=Math.max(0,Math.min(59,Math.floor(Number(src.minutes)||0)));
    return {days,hours,minutes};
  }
  const v=String(legacyText||'').toLowerCase().trim();
  if(!v||v==='tba')return {days:0,hours:0,minutes:0};
  const nums=(v.match(/\d+(?:[.,]\d+)?/g)||[]).map(x=>Number(x.replace(',','.'))).filter(Number.isFinite);
  const n=nums.length?Math.max(...nums):0;
  if(/hari ini|secepatnya/.test(v))return {days:0,hours:8,minutes:0};
  if(/hari/.test(v))return {days:Math.max(0,Math.floor(n)),hours:0,minutes:0};
  if(/jam/.test(v))return {days:0,hours:Math.max(0,Math.min(23,Math.floor(n))),minutes:Math.round((n-Math.floor(n))*60)};
  if(/menit/.test(v))return {days:0,hours:0,minutes:Math.max(0,Math.min(59,Math.round(n)))};
  return {days:0,hours:0,minutes:0};
}
function estimatePartsToMinutes(parts){
  const p=normalizeEstimateParts(parts);
  const total=p.days*8*60+p.hours*60+p.minutes;
  return total>0?total:null;
}
function estimatePartsLabel(parts){
  const p=normalizeEstimateParts(parts);
  const chunks=[];
  if(p.days)chunks.push(`${p.days} hari kerja`);
  if(p.hours)chunks.push(`${p.hours} jam`);
  if(p.minutes)chunks.push(`${p.minutes} menit`);
  return chunks.join(' ')||'TBA';
}
function defaultEstimateParts(priority,kind){
  const source=priorityDefaults[priority]?.[kind]||{days:0,hours:0,minutes:0};
  return {...source};
}
function targetDueAtFromParts(baseIso,parts){
  if(!baseIso)return null;
  const p=normalizeEstimateParts(parts);
  if(!estimatePartsToMinutes(p))return null;
  const d=new Date(baseIso);
  let remaining=p.days;
  while(remaining>0){
    d.setUTCDate(d.getUTCDate()+1);
    const day=d.getUTCDay();
    if(day!==0&&day!==6)remaining--;
  }
  d.setTime(d.getTime()+(p.hours*60+p.minutes)*60000);
  return d.toISOString();
}
function refreshEstimateTarget(ticket, baseIso=nowIso()){
  ticket.estimateSetAt=baseIso;
  ticket.processingEstimate=normalizeEstimateParts(ticket.processingEstimate,ticket.estimatedProcessing);
  ticket.completionEstimate=normalizeEstimateParts(ticket.completionEstimate,ticket.estimatedCompletion);
  ticket.estimatedProcessing=estimatePartsLabel(ticket.processingEstimate);
  ticket.estimatedCompletion=estimatePartsLabel(ticket.completionEstimate);
  ticket.estimatedProcessingMinutes=estimatePartsToMinutes(ticket.processingEstimate);
  ticket.estimatedCompletionMinutes=estimatePartsToMinutes(ticket.completionEstimate);
  ticket.processTargetAt=ticket.estimatedProcessingMinutes?targetDueAtFromParts(baseIso,ticket.processingEstimate):null;
  ticket.targetDueAt=ticket.estimatedCompletionMinutes?targetDueAtFromParts(baseIso,ticket.completionEstimate):null;
}
function ticketElapsedMinutes(ticket){
  const end=ticket.resolvedAt||ticket.userConfirmation?.at||ticket.updatedAt||nowIso();
  return Math.max(0,Math.round((new Date(end)-new Date(ticket.createdAt))/60000));
}
function remainingMinutes(ticket){
  if(!ticket.targetDueAt || ['Finished','Resolved - Awaiting Confirmation'].includes(ticket.status))return null;
  return Math.round((new Date(ticket.targetDueAt)-Date.now())/60000);
}
function canInterveneTicket(me,ticket){
  if(!me)return false;
  if(me.role==='root_admin')return true;
  if(me.role!=='admin')return false;
  if(!supportMatches(me,ticket.issueType))return false;
  if(ticket.assignedTo?.type==='admin' && ticket.assignedTo?.userId && ticket.assignedTo.userId!==me.id)return false;
  return true;
}
function canAssignPic(me,ticket,pic){
  if(!pic)return true;
  if(me?.role==='root_admin')return true;
  return supportMatches(me,ticket.issueType) && supportMatches(pic,ticket.issueType);
}
function makeTicketId(tickets){
  const d=new Date(); const y=d.getFullYear(); const m=String(d.getMonth()+1).padStart(2,'0'); const day=String(d.getDate()).padStart(2,'0');
  const prefix=`ARU-${y}${m}${day}-`; const nums=tickets.filter(t=>String(t.id||'').startsWith(prefix)).map(t=>Number(String(t.id).slice(-4))).filter(Number.isFinite);
  return prefix+String((nums.length?Math.max(...nums):0)+1).padStart(4,'0');
}
function ticketLink(ticket){ return `${APP_BASE_URL}/?ticket=${encodeURIComponent(ticket.id)}`; }
function ticketSummaryHtml(ticket, heading, extra='') {
  return `<p>${heading}</p><table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:12px"><tr><td style="padding:12px;color:#68758b">Ticket</td><td style="padding:12px;font-weight:700">${escapeHtml(ticket.id)}</td></tr><tr><td style="padding:12px;color:#68758b">Judul</td><td style="padding:12px;font-weight:700">${escapeHtml(ticket.title)}</td></tr><tr><td style="padding:12px;color:#68758b">Jenis</td><td style="padding:12px">${escapeHtml(requestKindLabel(inferRequestKind(ticket)))}</td></tr><tr><td style="padding:12px;color:#68758b">Area Penanganan</td><td style="padding:12px">${escapeHtml(inferIssueType(ticket))}</td></tr><tr><td style="padding:12px;color:#68758b">Status</td><td style="padding:12px">${escapeHtml(ticket.status)}</td></tr><tr><td style="padding:12px;color:#68758b">Priority</td><td style="padding:12px">${escapeHtml(ticket.priority)}</td></tr><tr><td style="padding:12px;color:#68758b">PIC</td><td style="padding:12px">${escapeHtml(ticket.assignedTo?.name||'Belum ditentukan')}</td></tr><tr><td style="padding:12px;color:#68758b">Estimasi</td><td style="padding:12px">${escapeHtml(ticket.estimatedCompletion||'TBA')}</td></tr></table>${extra}<p style="margin-top:20px"><a href="${ticketLink(ticket)}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Buka IT Ticketing</a></p>`;
}
async function notifyRequester(ticket, subject, intro, extra='') { return sendEmail(ticket.requester?.email, `${ticket.id} · ${subject}`, ticketSummaryHtml(ticket,intro,extra), false); }
async function notifyAdminsNewTicket(ticket){
  const admins=readJson(USERS_FILE).filter(u=>isAdminRole(u.role)&&u.status==='active'&&u.email).map(u=>u.email);
  if(!admins.length)return;
  await sendEmail(admins.join(','), `${ticket.id} · Ticket baru masuk`, ticketSummaryHtml(ticket,`Ticket baru dibuat oleh <strong>${escapeHtml(ticket.createdBy?.name||'-')}</strong>.`), false);
}
async function notifyTicketTeam(ticket, subject, intro){
  const users=readJson(USERS_FILE); const ids=new Set([ticket.assignedTo?.userId,ticket.resolvedBy?.userId].filter(Boolean));
  const emails=users.filter(u=>ids.has(u.id)&&u.email).map(u=>u.email);
  const externalContact=String(ticket.assignedTo?.contact||'').trim();
  if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(externalContact))emails.push(externalContact);
  const unique=[...new Set(emails.filter(Boolean))];
  if(unique.length) await sendEmail(unique.join(','), `${ticket.id} · ${subject}`, ticketSummaryHtml(ticket,intro), false);
}

async function notifyRootPendingUser(user) {
  const roots=readJson(USERS_FILE).filter(u=>u.role==='root_admin'&&u.status==='active'&&u.email).map(u=>u.email);
  if(!roots.length)return;
  await sendEmail([...new Set(roots)].join(','), 'Registrasi Eksternal Menunggu Approval',
    `<p>Registrasi akun eksternal baru masuk dan menunggu persetujuan administrator.</p>
     <table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:12px">
       <tr><td style="padding:10px;color:#68758b">Nama</td><td style="padding:10px;font-weight:700">${escapeHtml(user.name)}</td></tr>
       <tr><td style="padding:10px;color:#68758b">Email</td><td style="padding:10px">${escapeHtml(user.email)}</td></tr>
       <tr><td style="padding:10px;color:#68758b">Bagian</td><td style="padding:10px">${escapeHtml(user.department)}</td></tr>
     </table>
     <p style="margin-top:20px"><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Buka Account Management</a></p>`, false);
}
async function notifyPicAssignment(ticket, pic) {
  const email = pic?.email || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(pic?.contact||'')) ? String(pic.contact).trim() : '');
  if(!email)return;
  await sendEmail(email, `${ticket.id} · Ticket Ditugaskan Kepada Anda`,
    ticketSummaryHtml(ticket, `Anda ditetapkan sebagai PIC untuk ticket <strong>${escapeHtml(ticket.id)}</strong>.`), false);
}

// ---------------- AUTH & EMAIL VERIFICATION ----------------
app.post('/api/register',mailLimiter, async (req,res,next)=>{
  try {
    const {username,password,name,email,phone,department}=req.body;
    if(![username,password,name,email,phone,department].every(v=>String(v||'').trim())) return res.status(400).json({error:'Semua field registrasi wajib diisi.'});
    if(String(password).length<8) return res.status(400).json({error:'Password minimal 8 karakter.'});
    const cleanEmail=normalizeEmail(email); const users=readJson(USERS_FILE); const internal=isInternalEmail(cleanEmail);
    if(users.some(u=>String(u.username).toLowerCase()===String(username).trim().toLowerCase())) return res.status(409).json({error:'Username sudah digunakan.'});
    if(users.some(u=>normalizeEmail(u.email)===cleanEmail)) return res.status(409).json({error:'Email sudah digunakan.'});
    const user={id:uid('USR'),username:String(username).trim(),name:String(name).trim(),email:cleanEmail,phone:String(phone).trim(),department:String(department).trim(),label:'User',role:'user',status:internal?'pending_verification':'pending_approval',emailVerified:false,passwordHash:await bcrypt.hash(password,12),createdAt:nowIso(),registrationMethod:internal?'internal_email_otp':'external_admin_approval'};
    users.push(user); writeJson(USERS_FILE,users);
    if(internal){
      try { await issueOtp(user,'registration',{ignoreCooldown:true}); }
      catch(err){
        const rollback=readJson(USERS_FILE).filter(u=>u.id!==user.id); writeJson(USERS_FILE,rollback);
        return res.status(503).json({error:err.message});
      }
      return res.json({ok:true,needsVerification:true,needsApproval:false,identity:user.email,maskedEmail:maskedEmail(user.email),message:'Kode verifikasi telah dikirim ke email internal Anda.'});
    }
    await Promise.allSettled([
      sendEmail(user.email,'Registrasi IT Ticketing Diterima',`<p>Halo <strong>${escapeHtml(user.name)}</strong>,</p><p>Registrasi akun Anda sudah diterima dan sedang menunggu persetujuan administrator IT.</p><p>Notifikasi akan dikirim setelah akun disetujui.</p>`,false),
      notifyRootPendingUser(user)
    ]);
    res.json({ok:true,needsVerification:false,needsApproval:true,identity:user.email,message:'Registrasi berhasil diajukan. Akun akan dapat digunakan setelah disetujui admin IT.'});
  } catch(err){next(err)}
});
app.post('/api/register/resend',mailLimiter, async (req,res,next)=>{
  try{
    const user=findUserByIdentity(req.body.identity);
    if(!user||user.emailVerified||!isInternalEmail(user.email)||user.status!=='pending_verification') return res.status(400).json({error:'Kode verifikasi hanya berlaku untuk registrasi email internal yang belum terverifikasi.'});
    await issueOtp(user,'registration');
    res.json({ok:true,maskedEmail:maskedEmail(user.email),message:'Kode baru telah dikirim.'});
  }catch(err){next(err)}
});
app.post('/api/register/verify',authLimiter, async (req,res,next)=>{
  try{
    const user=findUserByIdentity(req.body.identity); if(!user) return res.status(400).json({error:'Akun tidak ditemukan.'});
    if(!isInternalEmail(user.email)) return res.status(400).json({error:'Registrasi eksternal tidak menggunakan OTP dan harus menunggu approval admin.'});
    if(user.emailVerified) return res.status(400).json({error:'Email sudah terverifikasi. Silakan login menggunakan akun Anda.'});
    const check=consumeOtp(user.id,'registration',String(req.body.code||'')); if(!check.ok)return res.status(400).json({error:check.error});
    const users=readJson(USERS_FILE); const idx=users.findIndex(u=>u.id===user.id);
    users[idx].emailVerified=true; users[idx].emailVerifiedAt=nowIso();users[idx].status='active';users[idx].approvedAt=nowIso();users[idx].approvedBy='AUTO_INTERNAL_DOMAIN';
    writeJson(USERS_FILE,users);
    updateSession(req,users[idx]);
    await sendEmail(users[idx].email,'Akun IT Ticketing Aktif',`<p>Halo <strong>${escapeHtml(users[idx].name)}</strong>,</p><p>Email internal Anda berhasil diverifikasi dan akun <strong>langsung aktif</strong>. Anda sudah masuk ke ${APP_NAME}.</p>`,false);
    res.json({ok:true,status:'active',autoActivated:true,user:publicUser(users[idx]),message:'Email berhasil diverifikasi. Akun aktif dan Anda langsung masuk ke dashboard.'});
  }catch(err){next(err)}
});
app.post('/api/login',authLimiter, async (req,res)=>{
  const user=findUserByIdentity(req.body.login); if(!user||!(await bcrypt.compare(String(req.body.password||''),user.passwordHash))) return res.status(401).json({error:'Username/email atau password salah.'});
  if(user.status!=='active'){
    const msg=user.status==='pending_verification'?'Email belum diverifikasi.':user.status==='pending_approval'?'Akun masih menunggu approval admin.':user.status==='rejected'?'Registrasi akun ditolak.':'Akun tidak aktif.';
    return res.status(403).json({error:msg,status:user.status,identity:user.email});
  }
  updateSession(req,user); res.json({ok:true,user:publicUser(user)});
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,(req,res)=>{const u=findSessionUser(req);if(!u||u.status!=='active')return res.status(401).json({error:'Session tidak valid.'});updateSession(req,u);res.json({user:publicUser(u)});});
app.patch('/api/me/profile',auth,async(req,res,next)=>{
  try{
    const users=readJson(USERS_FILE);
    const idx=users.findIndex(u=>u.id===req.session.user.id);
    if(idx<0)return res.status(404).json({error:'User tidak ditemukan.'});
    const name=String(req.body.name||'').trim();
    const phone=String(req.body.phone||'').trim();
    const department=String(req.body.department||'').trim();
    if(!name)return res.status(400).json({error:'Nama wajib diisi.'});
    if(!department)return res.status(400).json({error:'Bagian wajib diisi.'});
    if(name.length>190)return res.status(400).json({error:'Nama terlalu panjang.'});
    if(phone.length>80)return res.status(400).json({error:'Nomor/kontak terlalu panjang.'});
    if(department.length>190)return res.status(400).json({error:'Nama bagian terlalu panjang.'});
    users[idx].name=name;
    users[idx].phone=phone;
    users[idx].department=department;
    users[idx].updatedAt=nowIso();
    writeJson(USERS_FILE,users);
    updateSession(req,users[idx]);
    res.json({ok:true,user:publicUser(users[idx]),message:'Profil berhasil diperbarui.'});
  }catch(err){next(err)}
});
app.post('/api/change-password',auth,async(req,res,next)=>{
  try{const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.session.user.id);if(idx<0)return res.status(404).json({error:'User tidak ditemukan.'});if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password baru minimal 8 karakter.'});if(!(await bcrypt.compare(String(req.body.currentPassword||''),users[idx].passwordHash)))return res.status(400).json({error:'Password saat ini salah.'});users[idx].passwordHash=await bcrypt.hash(req.body.newPassword,12);users[idx].passwordChangedAt=nowIso();writeJson(USERS_FILE,users);await sendEmail(users[idx].email,'Password IT Ticketing Diubah',`<p>Password akun <strong>${escapeHtml(users[idx].username)}</strong> baru saja diubah pada ${escapeHtml(formatDateId(nowIso()))}.</p><p>Jika bukan Anda yang melakukan perubahan ini, segera hubungi tim IT.</p>`,false);res.json({ok:true,message:'Password berhasil diubah.'});}catch(err){next(err)}
});
app.post('/api/forgot-password',mailLimiter,async(req,res,next)=>{
  try{const user=findUserByIdentity(req.body.identity);if(!user)return res.json({ok:true,message:'Jika akun ditemukan, kode reset akan dikirim ke email terdaftar.'});if(!user.email)return res.status(400).json({error:'Akun tidak memiliki email.'});await issueOtp(user,'password_reset');res.json({ok:true,identity:user.email,maskedEmail:maskedEmail(user.email),message:'Kode reset password telah dikirim ke email terdaftar.'});}catch(err){next(err)}
});
app.post('/api/forgot-password/resend',mailLimiter,async(req,res,next)=>{try{const user=findUserByIdentity(req.body.identity);if(!user)return res.json({ok:true,message:'Jika akun ditemukan, kode akan dikirim.'});await issueOtp(user,'password_reset');res.json({ok:true,maskedEmail:maskedEmail(user.email),message:'Kode reset baru telah dikirim.'});}catch(err){next(err)}});
app.post('/api/reset-password',authLimiter,async(req,res,next)=>{
  try{const user=findUserByIdentity(req.body.identity);if(!user)return res.status(400).json({error:'Kode atau akun tidak valid.'});if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password baru minimal 8 karakter.'});const check=consumeOtp(user.id,'password_reset',String(req.body.code||''));if(!check.ok)return res.status(400).json({error:check.error});const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===user.id);users[idx].passwordHash=await bcrypt.hash(req.body.newPassword,12);users[idx].passwordChangedAt=nowIso();writeJson(USERS_FILE,users);await sendEmail(users[idx].email,'Password IT Ticketing Berhasil Direset',`<p>Password akun Anda berhasil direset pada ${escapeHtml(formatDateId(nowIso()))}.</p><p>Jika bukan Anda yang melakukan reset ini, segera hubungi tim IT.</p>`,false);res.json({ok:true,message:'Password berhasil direset. Silakan login menggunakan password baru.'});}catch(err){next(err)}
});

// ---------------- USERS & ADMINS ----------------
// Admin biasa hanya mendapat directory minimum untuk kebutuhan ticket/PIC.
app.get('/api/admin/directory',adminOnly,(req,res)=>{
  const users=readJson(USERS_FILE).filter(u=>u.status==='active').map(u=>({
    id:u.id,username:u.username,name:u.name,email:u.email,phone:u.phone,department:u.department,
    label:u.label,role:u.role,status:u.status
  }));
  res.json({users});
});

// Seluruh account management, approval, CRUD, dan password reset paksa hanya root admin.
app.get('/api/root/accounts',rootOnly,(req,res)=>{
  const users=readJson(USERS_FILE).map(publicUser).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({users});
});
// Approval queue dapat ditangani admin biasa maupun root. CRUD akun tetap khusus root.
app.get('/api/admin/users',adminOnly,(req,res)=>{
  const users=readJson(USERS_FILE)
    .filter(u=>u.role==='user' && ['pending_approval','rejected'].includes(u.status))
    .map(publicUser)
    .sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  res.json({users});
});

app.post('/api/admin/users/:id/approve',adminOnly,async(req,res,next)=>{
  try{
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id&&u.role==='user');
    if(idx<0)return res.status(404).json({error:'User tidak ditemukan.'});
    if(users[idx].status!=='pending_approval')return res.status(400).json({error:'Hanya registrasi eksternal berstatus pending approval yang dapat disetujui dari antrean ini.'});
    users[idx].status='active';users[idx].approvedAt=nowIso();users[idx].approvedBy=req.session.user.id;
    delete users[idx].rejectionReason;delete users[idx].rejectedAt;delete users[idx].rejectedBy;
    writeJson(USERS_FILE,users);
    await sendEmail(users[idx].email,'Akun IT Ticketing Disetujui',`<p>Halo <strong>${escapeHtml(users[idx].name)}</strong>,</p><p>Registrasi Anda telah disetujui oleh administrator IT. Akun sekarang aktif dan dapat digunakan.</p><p><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Login</a></p>`,false);
    res.json({ok:true,user:publicUser(users[idx])});
  }catch(err){next(err)}
});
app.post('/api/admin/users/:id/reject',adminOnly,async(req,res,next)=>{
  try{
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id&&u.role==='user');
    if(idx<0)return res.status(404).json({error:'User tidak ditemukan.'});
    users[idx].status='rejected';users[idx].rejectionReason=String(req.body.reason||'Tidak memenuhi ketentuan akses.').trim();
    users[idx].rejectedAt=nowIso();users[idx].rejectedBy=req.session.user.id;writeJson(USERS_FILE,users);
    await sendEmail(users[idx].email,'Registrasi IT Ticketing Tidak Disetujui',`<p>Registrasi akun Anda belum dapat disetujui.</p><p><strong>Catatan:</strong> ${escapeHtml(users[idx].rejectionReason)}</p><p>Silakan hubungi tim IT jika membutuhkan klarifikasi.</p>`,false);
    res.json({ok:true});
  }catch(err){next(err)}
});

app.post('/api/root/accounts',rootOnly,async(req,res,next)=>{
  try{
    const {role='user',username,password,name,email,phone,department,label,supportType}=req.body;
    if(!['user','admin','supervisor'].includes(role))return res.status(400).json({error:'Role hanya dapat user, admin, atau supervisor.'});
    if(![username,password,name,email,department].every(v=>String(v||'').trim()))return res.status(400).json({error:'Username, password, nama, email, dan bagian wajib diisi.'});
    if(String(password).length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const users=readJson(USERS_FILE);const cleanEmail=normalizeEmail(email);const cleanUsername=String(username).trim();
    if(users.some(u=>String(u.username).toLowerCase()===cleanUsername.toLowerCase()))return res.status(409).json({error:'Username sudah digunakan.'});
    if(users.some(u=>normalizeEmail(u.email)===cleanEmail))return res.status(409).json({error:'Email sudah digunakan.'});
    const at=nowIso();
    const defaultLabel=role==='admin'?'Administrator':role==='supervisor'?'Admin Supervisor':'User';
    const u={id:uid('USR'),username:cleanUsername,name:String(name).trim(),email:cleanEmail,phone:String(phone||'-').trim()||'-',department:String(department).trim(),label:String(label||defaultLabel).trim(),role,supportType:role==='admin'?normalizeSupportType(supportType||'Both'):'Both',status:'active',emailVerified:true,emailVerifiedAt:at,passwordHash:await bcrypt.hash(password,12),createdAt:at,approvedAt:at,approvedBy:req.session.user.id,createdByRoot:req.session.user.id};
    users.push(u);writeJson(USERS_FILE,users);
    await sendEmail(u.email,role==='admin'?'Akun Administrator IT Ticketing Dibuat':role==='supervisor'?'Akun Supervisor IT Ticketing Dibuat':'Akun IT Ticketing Dibuat',`<p>Halo <strong>${escapeHtml(u.name)}</strong>,</p><p>Akun ${APP_NAME} Anda dibuat oleh root administrator.</p><p>Username: <strong>${escapeHtml(u.username)}</strong></p><p>Gunakan password awal yang diberikan oleh root administrator dan segera ganti password setelah login.</p><p><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Login</a></p>`,false);
    res.json({ok:true,user:publicUser(u)});
  }catch(err){next(err)}
});
// Endpoint lama create-admin diarahkan ke implementasi yang sama untuk kompatibilitas.
app.post('/api/admin/create-admin',rootOnly,async(req,res,next)=>{
  try{
    req.body.role='admin';
    const {username,password,name,email,phone,department,label}=req.body;
    if(![username,password,name,email,department].every(v=>String(v||'').trim()))return res.status(400).json({error:'Username, password, nama, email, dan bagian wajib diisi.'});
    if(String(password).length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const users=readJson(USERS_FILE);const cleanEmail=normalizeEmail(email);
    if(users.some(u=>String(u.username).toLowerCase()===String(username).trim().toLowerCase()||normalizeEmail(u.email)===cleanEmail))return res.status(409).json({error:'Username/email sudah digunakan.'});
    const at=nowIso();const u={id:uid('USR'),username:String(username).trim(),name:String(name).trim(),email:cleanEmail,phone:String(phone||'-').trim()||'-',department:String(department).trim(),label:String(label||'Administrator').trim(),role:'admin',status:'active',emailVerified:true,emailVerifiedAt:at,passwordHash:await bcrypt.hash(password,12),createdAt:at,approvedAt:at,approvedBy:req.session.user.id,createdByRoot:req.session.user.id};
    users.push(u);writeJson(USERS_FILE,users);await sendEmail(u.email,'Akun Administrator IT Ticketing Dibuat',`<p>Halo <strong>${escapeHtml(u.name)}</strong>,</p><p>Akun administrator ${APP_NAME} telah dibuat oleh root administrator.</p><p>Username: <strong>${escapeHtml(u.username)}</strong></p><p>Gunakan password awal yang diberikan oleh root administrator, lalu ganti password setelah login.</p>`,false);res.json({ok:true,user:publicUser(u)});
  }catch(err){next(err)}
});

app.patch('/api/root/accounts/:id',rootOnly,async(req,res,next)=>{
  try{
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Akun tidak ditemukan.'});
    if(users[idx].role==='root_admin'&&users[idx].id!==req.session.user.id)return res.status(403).json({error:'Root administrator lain tidak dapat diedit.'});
    const current=users[idx];const nextRole=current.role==='root_admin'?'root_admin':(['user','admin','supervisor'].includes(req.body.role)?req.body.role:current.role);
    const nextUsername=String(req.body.username??current.username).trim();const nextEmail=normalizeEmail(req.body.email??current.email);
    if(!nextUsername||!nextEmail)return res.status(400).json({error:'Username dan email wajib diisi.'});
    if(users.some((u,i)=>i!==idx&&String(u.username).toLowerCase()===nextUsername.toLowerCase()))return res.status(409).json({error:'Username sudah digunakan akun lain.'});
    if(users.some((u,i)=>i!==idx&&normalizeEmail(u.email)===nextEmail))return res.status(409).json({error:'Email sudah digunakan akun lain.'});
    const oldEmail=current.email;
    current.username=nextUsername;current.email=nextEmail;current.name=String(req.body.name??current.name).trim()||current.name;
    current.phone=String(req.body.phone??current.phone??'-').trim()||'-';current.department=String(req.body.department??current.department).trim()||current.department;
    const roleDefaultLabel=nextRole==='admin'?'Administrator':nextRole==='supervisor'?'Admin Supervisor':'User';
    current.label=String(req.body.label??current.label??roleDefaultLabel).trim();current.role=nextRole;
    current.supportType=nextRole==='admin'?normalizeSupportType(req.body.supportType??current.supportType??'Both'):'Both';
    if(current.role!=='root_admin'&&req.body.status&&['active','pending_approval','rejected','disabled'].includes(req.body.status))current.status=req.body.status;
    if(current.role==='admin'||current.role==='supervisor'){current.status='active';current.emailVerified=true;current.emailVerifiedAt=current.emailVerifiedAt||nowIso();}
    if(nextEmail!==oldEmail){current.emailVerified=true;current.emailVerifiedAt=nowIso();current.emailChangedBy=req.session.user.id;}
    current.updatedAt=nowIso();current.updatedBy=req.session.user.id;writeJson(USERS_FILE,users);
    if(current.id===req.session.user.id)updateSession(req,current);
    await sendEmail(current.email,'Profil Akun IT Ticketing Diperbarui',`<p>Data akun <strong>${escapeHtml(current.username)}</strong> baru saja diperbarui oleh root administrator.</p><p>Jika ada data yang tidak sesuai, hubungi tim IT.</p>`,false);
    res.json({ok:true,user:publicUser(current)});
  }catch(err){next(err)}
});

app.delete('/api/root/accounts/:id',rootOnly,async(req,res,next)=>{
  try{
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Akun tidak ditemukan.'});
    const target=users[idx];if(target.role==='root_admin')return res.status(403).json({error:'Root administrator tidak dapat dihapus.'});
    users.splice(idx,1);writeJson(USERS_FILE,users);
    // Bersihkan token aktif dan lepaskan keterkaitan akun dari ticket tanpa menghapus histori snapshot.
    const tokens=readJson(TOKENS_FILE).filter(t=>t.userId!==target.id);writeJson(TOKENS_FILE,tokens);
    const tickets=readJson(TICKETS_FILE);let changed=false;
    for(const t of tickets){
      if(t.requester?.userId===target.id){t.requester.userId=null;t.requester.accountDeleted=true;changed=true;}
      if(t.assignedTo?.userId===target.id){t.assignedTo.accountDeleted=true;t.assignedTo.key=t.assignedTo.key||`admin:${target.id}`;t.updatedAt=nowIso();t.timeline=t.timeline||[];t.timeline.push({at:nowIso(),type:'account_deleted',by:req.session.user.name,note:`Akun PIC ${target.name} dihapus, tetapi snapshot PIC pada histori ticket tetap dipertahankan.`});changed=true;}
    }
    if(changed)writeJson(TICKETS_FILE,tickets);
    await sendEmail(target.email,'Akun IT Ticketing Dinonaktifkan',`<p>Akun <strong>${escapeHtml(target.username)}</strong> telah dihapus oleh root administrator.</p><p>Jika Anda merasa ini tidak sesuai, hubungi tim IT.</p>`,false);
    res.json({ok:true});
  }catch(err){next(err)}
});

app.post('/api/root/accounts/:id/reset-password',rootOnly,async(req,res,next)=>{
  try{
    if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id&&u.role!=='root_admin');
    if(idx<0)return res.status(404).json({error:'Akun tidak ditemukan atau tidak dapat direset dari sini.'});
    users[idx].passwordHash=await bcrypt.hash(req.body.newPassword,12);users[idx].passwordChangedAt=nowIso();users[idx].passwordChangedBy=req.session.user.id;writeJson(USERS_FILE,users);
    await sendEmail(users[idx].email,'Password Akun IT Ticketing Direset',`<p>Password akun Anda telah direset oleh root administrator.</p><p>Silakan login menggunakan password baru yang diberikan dan segera lakukan penggantian password.</p>`,false);res.json({ok:true});
  }catch(err){next(err)}
});
// Alias endpoint versi sebelumnya.
app.post('/api/admin/accounts/:id/reset-password',rootOnly,async(req,res,next)=>{
  try{
    if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const users=readJson(USERS_FILE);const idx=users.findIndex(u=>u.id===req.params.id&&u.role!=='root_admin');if(idx<0)return res.status(404).json({error:'Akun tidak ditemukan.'});
    users[idx].passwordHash=await bcrypt.hash(req.body.newPassword,12);users[idx].passwordChangedAt=nowIso();users[idx].passwordChangedBy=req.session.user.id;writeJson(USERS_FILE,users);await sendEmail(users[idx].email,'Password Akun IT Ticketing Direset',`<p>Password akun Anda telah direset oleh root administrator.</p>`,false);res.json({ok:true});
  }catch(err){next(err)}
});

// ---------------- PIC DIRECTORY ----------------
// Admin dan root sama-sama merupakan PIC internal. Keduanya juga dapat
// mengelola daftar PIC non-admin (nama + kontak) untuk vendor/teknisi/support lain.
app.get('/api/admin/pics',staffViewOnly,(req,res)=>{
  res.json({pics:combinedPicDirectory(), external:externalPicDirectory()});
});
app.post('/api/admin/pics',adminOnly,(req,res)=>{
  const name=String(req.body.name||'').trim();
  const contact=String(req.body.contact||'').trim();
  const supportType=normalizeSupportType(req.body.supportType||'Both');
  if(!name||!contact)return res.status(400).json({error:'Nama dan kontak PIC wajib diisi.'});
  const pics=readJson(PICS_FILE);
  const duplicate=pics.find(p=>String(p.name).trim().toLowerCase()===name.toLowerCase() && String(p.contact).trim().toLowerCase()===contact.toLowerCase());
  if(duplicate)return res.status(409).json({error:'PIC dengan nama dan kontak tersebut sudah ada.'});
  const pic={id:uid('PIC'),name,contact,supportType,createdAt:nowIso(),createdBy:{userId:req.session.user.id,name:req.session.user.name}};
  pics.push(pic);writeJson(PICS_FILE,pics);res.status(201).json({ok:true,pic});
});
app.patch('/api/admin/pics/:id',adminOnly,(req,res)=>{
  const pics=readJson(PICS_FILE);const idx=pics.findIndex(p=>p.id===req.params.id);
  if(idx<0)return res.status(404).json({error:'PIC non-admin tidak ditemukan.'});
  const name=String(req.body.name||pics[idx].name||'').trim();
  const contact=String(req.body.contact||pics[idx].contact||'').trim();
  const supportType=normalizeSupportType(req.body.supportType||pics[idx].supportType||'Both');
  if(!name||!contact)return res.status(400).json({error:'Nama dan kontak PIC wajib diisi.'});
  pics[idx]={...pics[idx],name,contact,supportType,updatedAt:nowIso(),updatedBy:{userId:req.session.user.id,name:req.session.user.name}};
  writeJson(PICS_FILE,pics);res.json({ok:true,pic:pics[idx]});
});
app.delete('/api/admin/pics/:id',adminOnly,(req,res)=>{
  const pics=readJson(PICS_FILE);const idx=pics.findIndex(p=>p.id===req.params.id);
  if(idx<0)return res.status(404).json({error:'PIC non-admin tidak ditemukan.'});
  const removed=pics.splice(idx,1)[0];writeJson(PICS_FILE,pics);
  // Snapshot PIC pada ticket historis sengaja tidak dihapus agar audit trail tetap utuh.
  res.json({ok:true,pic:removed});
});

// ---------------- TICKETS ----------------
// Public guest mode: no account/session required. Priority and estimates are intentionally left unassigned for IT triage.
app.post('/api/guest/tickets',guestLimiter,upload.array('evidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  try{
    const name=String(req.body.name||'').trim();
    const title=String(req.body.title||'').trim();
    const description=String(req.body.description||'').trim();
    if(!name||!title||!description)return res.status(400).json({error:'Nama, judul, dan detail permintaan wajib diisi.'});
    const email=normalizeEmail(req.body.email||'');
    if(email && !/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Format email guest tidak valid.'});
    const tickets=readJson(TICKETS_FILE);
    const evidence=await saveUploadedFiles(req.files,'tickets');
    const at=nowIso();
    const department=String(req.body.department||'').trim()||'Guest / Tidak ditentukan';
    const ticket={
      id:makeTicketId(tickets),title,category:String(req.body.category||'Other').trim(),priority:'Unassigned',description,
      requestKind:['Issue','Request'].includes(String(req.body.requestKind))?String(req.body.requestKind):inferRequestKind({category:req.body.category,title,description}),
      issueType:['IT','Network'].includes(String(req.body.issueType))?String(req.body.issueType):inferIssueType({category:req.body.category,title}),
      isPublic:false,
      location:String(req.body.location||'').trim(),asset:'',impact:'',
      requester:{userId:null,name,email,phone:String(req.body.phone||'').trim(),department,guest:true},
      createdBy:{userId:null,name,role:'guest',department},createdAt:at,updatedAt:at,status:'Open',
      processingEstimate:{days:0,hours:0,minutes:0},completionEstimate:{days:0,hours:0,minutes:0},estimatedProcessing:'TBA',estimatedCompletion:'TBA',estimatedProcessingMinutes:null,estimatedCompletionMinutes:null,estimateSetAt:at,processTargetAt:null,targetDueAt:null,assignedTo:null,resolvedBy:null,resolvedAt:null,
      resolutionMode:null,resolutionNote:'',resolutionEvidence:[],evidence,userConfirmation:null,feedback:null,
      timeline:[{at,type:'created',by:name,note:`Ticket guest dibuat oleh ${name}. Jenis: ${requestKindLabel(['Issue','Request'].includes(String(req.body.requestKind))?String(req.body.requestKind):inferRequestKind({category:req.body.category,title,description}))}. Priority menunggu triage IT.`}]
    };
    tickets.push(ticket);writeJson(TICKETS_FILE,tickets);
    const jobs=[notifyAdminsNewTicket(ticket)];
    if(email)jobs.push(notifyRequester(ticket,'Ticket Guest Berhasil Dibuat','Permintaan Anda sudah diterima oleh IT. Priority dan estimasi akan ditentukan setelah proses triage.'));
    await Promise.allSettled(jobs);
    res.json({ok:true,ticket:{id:ticket.id,title:ticket.title,status:ticket.status,priority:ticket.priority,estimatedProcessing:ticket.estimatedProcessing,estimatedCompletion:ticket.estimatedCompletion}});
  }catch(err){next(err)}
});

app.post('/api/tickets',auth,upload.array('evidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  try{
    const me=findSessionUser(req);if(!me)return res.status(401).json({error:'Session tidak valid.'});
    if(me.role==='supervisor')return res.status(403).json({error:'Admin Supervisor bersifat read-only dan tidak dapat membuat ticket.'});
    const title=String(req.body.title||'').trim(),description=String(req.body.description||'').trim();if(!title||!description)return res.status(400).json({error:'Judul dan deskripsi wajib diisi.'});
    const category=String(req.body.category||'Other').trim();
    const requestKind=['Issue','Request'].includes(String(req.body.requestKind))?String(req.body.requestKind):inferRequestKind({category,title,description});
    const issueType=['IT','Network'].includes(String(req.body.issueType))?String(req.body.issueType):inferIssueType({category,title});
    const tickets=readJson(TICKETS_FILE);const priority=['Critical','High','Medium','Low'].includes(req.body.priority)?req.body.priority:'Medium';const defaults=priorityDefaults[priority];
    let requester={userId:me.id,name:me.name,email:me.email,phone:me.phone,department:me.department};
    if(isAdminRole(me.role)){
      if(req.body.requesterUserId==='__self__') requester={userId:me.id,name:me.name,email:me.email,phone:me.phone,department:me.department};
      else if(req.body.requesterUserId){
        const target=readJson(USERS_FILE).find(u=>u.id===req.body.requesterUserId&&u.role==='user'&&u.status==='active');
        if(!target)return res.status(400).json({error:'Requester terdaftar tidak ditemukan atau tidak aktif.'});
        requester={userId:target.id,name:target.name,email:target.email,phone:target.phone,department:target.department};
      } else {
        const manualName=String(req.body.manualName||'').trim();
        if(!manualName)return res.status(400).json({error:'Nama requester walk-in wajib diisi, atau pilih user terdaftar.'});
        requester={userId:null,name:manualName,email:normalizeEmail(req.body.manualEmail||''),phone:String(req.body.manualPhone||'').trim(),department:String(req.body.manualDepartment||'').trim()||'Walk-in / Tidak ditentukan'};
      }
    }
    const evidence=await saveUploadedFiles(req.files,'tickets');
    let initialPic=null;
    if(isAdminRole(me.role) && req.body.assignedPicKey){
      initialPic=resolvePicSelection(req.body.assignedPicKey);
      if(!initialPic)return res.status(400).json({error:'PIC awal yang dipilih tidak ditemukan atau sudah tidak aktif.'});
      const draftTicket={issueType};
      if(!canAssignPic(me,draftTicket,initialPic))return res.status(403).json({error:`PIC ${initialPic.name} tidak sesuai tim ${issueType}. Root Admin dapat melakukan override lintas tim.`});
    }
    const at=nowIso();
    const ticket={id:makeTicketId(tickets),title,category,requestKind,issueType,isPublic:isAdminRole(me.role)&&(String(req.body.isPublic)==='true'||req.body.isPublic===true),priority,description,location:String(req.body.location||'').trim(),asset:String(req.body.asset||'').trim(),impact:String(req.body.impact||'').trim(),requester,createdBy:{userId:me.id,name:me.name,role:me.role,department:me.department,email:me.email||'',phone:me.phone||''},createdAt:at,updatedAt:at,status:'Open',processingEstimate:defaultEstimateParts(priority,'processing'),completionEstimate:defaultEstimateParts(priority,'completion'),estimatedProcessing:estimatePartsLabel(defaultEstimateParts(priority,'processing')),estimatedCompletion:estimatePartsLabel(defaultEstimateParts(priority,'completion')),assignedTo:initialPic?{...initialPic,key:initialPic.key}:null,resolvedBy:null,resolvedAt:null,resolutionMode:null,resolutionNote:'',resolutionEvidence:[],evidence,userConfirmation:null,feedback:null,timeline:[{at,type:'created',by:me.name,note:`Ticket dibuat oleh ${me.name} (${me.role}). Jenis: ${requestKindLabel(requestKind)}. Area penanganan: ${issueType}. Visibilitas: ${isAdminRole(me.role)&&(String(req.body.isPublic)==='true'||req.body.isPublic===true)?'Public':'Private'}.`}]};
    refreshEstimateTarget(ticket,at);
    if(initialPic)ticket.timeline.push({at,type:'assigned',by:me.name,note:`PIC awal ditetapkan ke ${initialPic.name}.`});
    tickets.push(ticket);writeJson(TICKETS_FILE,tickets);
    const createJobs=[notifyRequester(ticket,'Ticket Berhasil Dibuat','Ticket Anda berhasil dibuat dan sudah masuk ke antrean IT.'),notifyAdminsNewTicket(ticket)];
    if(initialPic)createJobs.push(notifyPicAssignment(ticket,initialPic));
    await Promise.allSettled(createJobs);
    res.json({ok:true,ticket});
  }catch(err){next(err)}
});

function filterTickets(req,tickets){
  const me=findSessionUser(req);let list=[...tickets];if(me?.role==='user')list=list.filter(t=>t.requester?.userId===me.id||t.isPublic===true);
  const q=String(req.query.q||'').trim().toLowerCase();
  if(q)list=list.filter(t=>{
    const safeFields=[t.id,t.title,t.category,requestKindLabel(inferRequestKind(t)),inferIssueType(t),t.priority,t.status,t.description,t.requester?.name,t.requester?.department,t.createdBy?.name,t.createdBy?.department,t.assignedTo?.name,t.resolvedBy?.name];
    const maySearchContact=me?.role!=='user'||t.requester?.userId===me.id;
    const fields=maySearchContact?[...safeFields,t.requester?.email,t.requester?.phone,t.assignedTo?.contact]:safeFields;
    return fields.some(v=>String(v||'').toLowerCase().includes(q));
  });
  if(req.query.category&&req.query.category!=='All')list=list.filter(t=>t.category===req.query.category);
  if(req.query.priority&&req.query.priority!=='All')list=list.filter(t=>t.priority===req.query.priority);
  if(req.query.status&&req.query.status!=='All')list=list.filter(t=>t.status===req.query.status);
  if(req.query.requestKind&&req.query.requestKind!=='All')list=list.filter(t=>inferRequestKind(t)===req.query.requestKind);
  if(req.query.issueType&&req.query.issueType!=='All')list=list.filter(t=>inferIssueType(t)===req.query.issueType);
  if(req.query.visibility&&req.query.visibility!=='All')list=list.filter(t=>req.query.visibility==='Public'?t.isPublic===true:t.isPublic!==true);
  if(req.query.pic&&req.query.pic!=='All')list=list.filter(t=>picKey(t.assignedTo)===String(req.query.pic));
  if(req.query.solver&&req.query.solver!=='All')list=list.filter(t=>`admin:${t.resolvedBy?.userId||''}`===String(req.query.solver));
  if(req.query.creator&&req.query.creator!=='All')list=list.filter(t=>`creator:${t.createdBy?.userId||'guest'}`===String(req.query.creator));

  const from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateFrom||''))?String(req.query.dateFrom):'';
  const to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo||''))?String(req.query.dateTo):'';
  if(from)list=list.filter(t=>jakartaDateKey(t.createdAt)>=from);
  if(to)list=list.filter(t=>jakartaDateKey(t.createdAt)<=to);
  if(!from&&!to){
    const tf=req.query.timeframe||'all';const now=new Date();
    if(tf==='daily'){const start=new Date(now.getFullYear(),now.getMonth(),now.getDate());list=list.filter(t=>new Date(t.createdAt)>=start);}
    if(tf==='weekly'){const start=new Date(now);start.setDate(now.getDate()-6);start.setHours(0,0,0,0);list=list.filter(t=>new Date(t.createdAt)>=start);}
    if(tf==='monthly'){const start=new Date(now);start.setDate(now.getDate()-29);start.setHours(0,0,0,0);list=list.filter(t=>new Date(t.createdAt)>=start);}
  }
  const sort=req.query.sort||'updated_desc';const pRank={Critical:4,High:3,Medium:2,Low:1,Unassigned:0};
  list.sort((a,b)=>sort==='created_asc'?new Date(a.createdAt)-new Date(b.createdAt):sort==='priority_desc'?(pRank[b.priority]||0)-(pRank[a.priority]||0):sort==='created_desc'?new Date(b.createdAt)-new Date(a.createdAt):new Date(b.updatedAt||b.createdAt)-new Date(a.updatedAt||a.createdAt));
  return list;
}
function reportOptionsFromTickets(tickets){
  const uniq=(arr,keyFn)=>{const m=new Map();for(const x of arr){const k=keyFn(x);if(k&&!m.has(k))m.set(k,x);}return [...m.values()];};
  const currentPics=combinedPicDirectory();
  const historicPics=uniq(tickets.filter(t=>t.assignedTo).map(t=>({key:picKey(t.assignedTo),name:t.assignedTo.name||'-',contact:t.assignedTo.contact||t.assignedTo.email||'',type:t.assignedTo.type||'admin'})),x=>x.key);
  const pics=uniq([...currentPics.map(p=>({key:p.key,name:p.name,contact:p.contact||p.email||'',type:p.type})),...historicPics],x=>x.key).sort((a,b)=>a.name.localeCompare(b.name,'id'));
  const solvers=uniq(tickets.filter(t=>t.resolvedBy?.userId).map(t=>({key:`admin:${t.resolvedBy.userId}`,name:t.resolvedBy.name||'-'})),x=>x.key).sort((a,b)=>a.name.localeCompare(b.name,'id'));
  const creators=uniq(tickets.filter(t=>t.createdBy).map(t=>({key:`creator:${t.createdBy?.userId||'guest'}`,name:t.createdBy?.name||'-',role:t.createdBy?.role||'guest'})),x=>x.key).sort((a,b)=>a.name.localeCompare(b.name,'id'));
  return {pics,solvers,creators};
}
app.get('/api/tickets',auth,(req,res)=>{
  const me=findSessionUser(req);
  let tickets=filterTickets(req,readJson(TICKETS_FILE));

  // Ticket public boleh dilihat user lain, tetapi data kontak personal tetap disembunyikan.
  if(me?.role==='user'){
    const stripContact=p=>p?{...p,email:'',phone:'',contact:''}:p;
    tickets=tickets.map(t=>{
      if(t.requester?.userId===me.id)return t;
      const c=JSON.parse(JSON.stringify(t));
      c.requester=stripContact(c.requester);
      c.createdBy=stripContact(c.createdBy);
      c.assignedTo=stripContact(c.assignedTo);
      c.resolvedBy=stripContact(c.resolvedBy);
      return c;
    });
  }

  res.json({tickets});
});
app.get('/api/admin/report-options',staffViewOnly,(req,res)=>res.json(reportOptionsFromTickets(readJson(TICKETS_FILE))));
app.get('/api/tickets/:id',auth,(req,res)=>{
  const me=findSessionUser(req),t=readJson(TICKETS_FILE).find(x=>x.id===req.params.id);
  if(!t)return res.status(404).json({error:'Ticket tidak ditemukan.'});
  const isOwner=t.requester?.userId===me.id;
  if(me.role==='user'&&!isOwner&&t.isPublic!==true)return res.status(403).json({error:'Tidak memiliki akses ke ticket ini.'});
  const users=readJson(USERS_FILE);
  const enrich=(person)=>{
    if(!person)return person;
    const u=person.userId?users.find(x=>x.id===person.userId):null;
    return {...person,email:u?.email||person.email||'',phone:u?.phone||person.phone||'',department:u?.department||person.department||'',label:u?.label||person.label||''};
  };
  const ticket=JSON.parse(JSON.stringify(t));
  ticket.requester=enrich(ticket.requester);
  ticket.createdBy=enrich(ticket.createdBy);
  ticket.assignedTo=enrich(ticket.assignedTo);
  ticket.resolvedBy=enrich(ticket.resolvedBy);
  ticket.requestKind=inferRequestKind(ticket);
  ticket.issueType=inferIssueType(ticket);
  ticket.estimateMeta={processTargetAt:ticket.processTargetAt||null,targetDueAt:ticket.targetDueAt||null,remainingMinutes:remainingMinutes(ticket),estimatedProcessingMinutes:ticket.estimatedProcessingMinutes??estimateToMinutes(ticket.estimatedProcessing),estimatedCompletionMinutes:ticket.estimatedCompletionMinutes??estimateToMinutes(ticket.estimatedCompletion),elapsedMinutes:ticketElapsedMinutes(ticket)};
  ticket.permissions={isOwner,canManage:canInterveneTicket(me,ticket),canChangeVisibility:isAdminRole(me?.role),canDelete:me.role==='root_admin',canConfirm:isOwner&&ticket.status==='Resolved - Awaiting Confirmation'&&ticket.resolutionMode==='user_confirm'};
  if(me.role==='user'&&!isOwner){
    const strip=p=>p?{...p,email:'',phone:'',contact:''}:p;
    ticket.requester=strip(ticket.requester);ticket.createdBy=strip(ticket.createdBy);ticket.assignedTo=strip(ticket.assignedTo);ticket.resolvedBy=strip(ticket.resolvedBy);
  }
  res.json({ticket});
});

app.delete('/api/root/tickets/:id',rootOnly,async(req,res,next)=>{
  try{
    const tickets=readJson(TICKETS_FILE);
    const idx=tickets.findIndex(t=>t.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Ticket tidak ditemukan.'});

    const removedTicket=tickets[idx];
    tickets.splice(idx,1);

    // Persist deletion first. Evidence files are cleaned only after the DB write succeeds.
    await writeJson(TICKETS_FILE,tickets);
    const removedFiles=removeTicketEvidenceFiles(removedTicket);

    res.json({
      ok:true,
      id:removedTicket.id,
      removedFiles,
      message:`Ticket ${removedTicket.id} berhasil dihapus permanen.`
    });
  }catch(err){next(err)}
});

app.patch('/api/admin/tickets/:id',adminOnly,async(req,res,next)=>{
  try{
    const tickets=readJson(TICKETS_FILE);const idx=tickets.findIndex(t=>t.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Ticket tidak ditemukan.'});
    const t=tickets[idx];const me=findSessionUser(req);
    const canManage=canInterveneTicket(me,t);
    const requestKeys=Object.keys(req.body||{}).filter(k=>req.body[k]!==undefined);
    const visibilityOnly=requestKeys.length>0&&requestKeys.every(k=>k==='isPublic');
    if(!canManage){
      if(isAdminRole(me?.role)&&visibilityOnly){
        const beforeVisibility=t.isPublic===true;
        t.isPublic=req.body.isPublic===true||String(req.body.isPublic)==='true';
        if(beforeVisibility!==(t.isPublic===true)){
          t.updatedAt=nowIso();
          t.timeline=t.timeline||[];
          t.timeline.push({at:nowIso(),type:'visibility',by:me.name,note:`Visibilitas ticket diubah menjadi ${t.isPublic?'Public':'Private'} oleh ${me.name}.`});
          writeJson(TICKETS_FILE,tickets);
          await notifyRequester(t,'Update Visibility Ticket',`Visibilitas ticket diubah menjadi <strong>${t.isPublic?'Public':'Private'}</strong>.`);
        }
        return res.json({ok:true,ticket:t});
      }
      return res.status(403).json({error:`Ticket ini sedang ditangani PIC ${t.assignedTo?.name||'-'} atau berada di area ${inferIssueType(t)}. Hanya PIC terkait atau Root Admin yang dapat mengubah pekerjaan. Admin lain tetap dapat mengubah visibility Public/Private.`});
    }
    const before=JSON.parse(JSON.stringify({
      status:t.status,priority:t.priority,estimatedProcessing:t.estimatedProcessing,
      estimatedCompletion:t.estimatedCompletion,processingEstimate:t.processingEstimate,completionEstimate:t.completionEstimate,assignedTo:t.assignedTo,
      isPublic:t.isPublic===true,requestKind:inferRequestKind(t),issueType:inferIssueType(t)
    }));
    const previousPicKey=picKey(t.assignedTo);

    if(req.body.requestKind!==undefined){
      t.requestKind=['Issue','Request'].includes(String(req.body.requestKind))?String(req.body.requestKind):inferRequestKind(t);
    }else t.requestKind=inferRequestKind(t);

    if(req.body.issueType!==undefined){
      const requestedType=['IT','Network'].includes(String(req.body.issueType))?String(req.body.issueType):inferIssueType(t);
      if(requestedType!==inferIssueType(t) && me.role!=='root_admin')return res.status(403).json({error:'Perubahan area penanganan IT/Network hanya dapat dioverride oleh Root Admin.'});
      t.issueType=requestedType;
    }else t.issueType=inferIssueType(t);

    if(req.body.isPublic!==undefined)t.isPublic=req.body.isPublic===true||String(req.body.isPublic)==='true';
    if(req.body.priority!==undefined && ['Unassigned','Critical','High','Medium','Low'].includes(String(req.body.priority)))t.priority=String(req.body.priority);
    if(req.body.processingEstimate!==undefined){
      t.processingEstimate=normalizeEstimateParts(req.body.processingEstimate,t.estimatedProcessing);
      t.estimatedProcessing=estimatePartsLabel(t.processingEstimate);
    }else if(req.body.estimatedProcessing!==undefined){
      t.processingEstimate=normalizeEstimateParts(null,String(req.body.estimatedProcessing).trim());
      t.estimatedProcessing=estimatePartsLabel(t.processingEstimate);
    }
    if(req.body.completionEstimate!==undefined){
      t.completionEstimate=normalizeEstimateParts(req.body.completionEstimate,t.estimatedCompletion);
      t.estimatedCompletion=estimatePartsLabel(t.completionEstimate);
    }else if(req.body.estimatedCompletion!==undefined){
      t.completionEstimate=normalizeEstimateParts(null,String(req.body.estimatedCompletion).trim());
      t.estimatedCompletion=estimatePartsLabel(t.completionEstimate);
    }
    if(req.body.applyPriorityDefaults===true || req.body.applyPriorityDefaults==='true'){
      t.processingEstimate=defaultEstimateParts(t.priority,'processing');
      t.completionEstimate=defaultEstimateParts(t.priority,'completion');
      t.estimatedProcessing=estimatePartsLabel(t.processingEstimate);
      t.estimatedCompletion=estimatePartsLabel(t.completionEstimate);
    }
    if(req.body.status!==undefined && ['Open','In Progress','Waiting User','Reopened'].includes(String(req.body.status)))t.status=String(req.body.status);

    let assignedPic=null;
    if(req.body.assignedPicKey!==undefined || req.body.assignedToUserId!==undefined){
      const requestedKey=req.body.assignedPicKey!==undefined?String(req.body.assignedPicKey||''):(req.body.assignedToUserId?`admin:${req.body.assignedToUserId}`:'');
      assignedPic=resolvePicSelection(requestedKey);
      if(requestedKey && !assignedPic)return res.status(400).json({error:'PIC yang dipilih tidak ditemukan atau sudah tidak aktif.'});
      if(assignedPic && !canAssignPic(me,t,assignedPic))return res.status(403).json({error:`PIC ${assignedPic.name} bukan PIC tim ${inferIssueType(t)}. Root Admin dapat melakukan override lintas tim.`});
      t.assignedTo=assignedPic?{...assignedPic,key:assignedPic.key}:null;
    }

    const estimateChanged=before.priority!==t.priority||before.estimatedProcessing!==t.estimatedProcessing||before.estimatedCompletion!==t.estimatedCompletion||JSON.stringify(before.processingEstimate||null)!==JSON.stringify(t.processingEstimate||null)||JSON.stringify(before.completionEstimate||null)!==JSON.stringify(t.completionEstimate||null);
    if(estimateChanged)refreshEstimateTarget(t,nowIso());
    t.updatedAt=nowIso();const changes=[];
    if(before.requestKind!==inferRequestKind(t))changes.push(`jenis ticket ${requestKindLabel(before.requestKind)} → ${requestKindLabel(inferRequestKind(t))}`);
    if(before.issueType!==inferIssueType(t))changes.push(`area penanganan ${before.issueType} → ${inferIssueType(t)}`);
    if(before.isPublic!==(t.isPublic===true))changes.push(`visibilitas → ${t.isPublic?'Public':'Private'}`);
    if(before.status!==t.status)changes.push(`status ${before.status} → ${t.status}`);
    if(before.priority!==t.priority)changes.push(`priority ${before.priority} → ${t.priority}`);
    if(before.estimatedProcessing!==t.estimatedProcessing)changes.push(`estimasi proses → ${t.estimatedProcessing||'TBA'}`);
    if(before.estimatedCompletion!==t.estimatedCompletion)changes.push(`target estimasi selesai → ${t.estimatedCompletion||'TBA'}`);
    if(JSON.stringify(before.assignedTo)!==JSON.stringify(t.assignedTo))changes.push(`PIC → ${t.assignedTo?.name||'belum ditentukan'}`);
    if(changes.length){t.timeline=t.timeline||[];t.timeline.push({at:nowIso(),type:'updated',by:me.name,note:changes.join(', ')});}
    writeJson(TICKETS_FILE,tickets);

    const jobs=[];
    if(changes.length)jobs.push(notifyRequester(t,'Update Ticket',`Ada pembaruan pada ticket Anda: <strong>${escapeHtml(changes.join(', '))}</strong>.`));
    if(t.assignedTo && picKey(t.assignedTo)!==previousPicKey){
      const pic=assignedPic||t.assignedTo;jobs.push(notifyPicAssignment(t,pic));
    }
    await Promise.allSettled(jobs);
    res.json({ok:true,ticket:t});
  }catch(err){next(err)}
});

app.post('/api/admin/tickets/:id/resolve',adminOnly,upload.array('resolutionEvidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  try{
    const tickets=readJson(TICKETS_FILE);const idx=tickets.findIndex(t=>t.id===req.params.id);
    if(idx<0)return res.status(404).json({error:'Ticket tidak ditemukan.'});
    const t=tickets[idx];const me=findSessionUser(req);
    if(!canInterveneTicket(me,t))return res.status(403).json({error:`Ticket ini sedang ditangani PIC ${t.assignedTo?.name||'-'} atau bukan area ${normalizeSupportType(me?.supportType)} Anda. Hanya PIC terkait atau Root Admin yang dapat menyelesaikannya.`});

    if(!t.assignedTo){
      t.assignedTo={key:`admin:${me.id}`,type:'admin',userId:me.id,name:me.name,contact:me.phone&&me.phone!=='-'?me.phone:(me.email||'-'),email:me.email||'',department:me.department||'',label:me.label||roleLabelForServer(me.role),supportType:normalizeSupportType(me.supportType||'Both')};
      t.timeline=t.timeline||[];
      t.timeline.push({at:nowIso(),type:'assigned',by:me.name,note:`PIC otomatis ditetapkan ke ${me.name} karena ticket diselesaikan dalam kondisi belum memiliki PIC.`});
    }

    const existing=t.resolutionEvidence||[];
    if(existing.length+(req.files||[]).length>MAX_UPLOAD_FILES)return res.status(400).json({error:`Total evidence penyelesaian maksimal ${MAX_UPLOAD_FILES} file.`});
    const files=await saveUploadedFiles(req.files,'resolutions');
    const requestedMode=String(req.body.resolutionMode||'user_confirm');
    const resolutionMode=requestedMode==='self_confirm'?'self_confirm':'user_confirm';
    if(resolutionMode==='user_confirm'&&!t.requester?.userId)return res.status(400).json({error:'Mode menunggu konfirmasi user memerlukan requester yang memiliki akun. Gunakan Self Confirm untuk walk-in/guest.'});

    t.resolutionMode=resolutionMode;
    t.resolutionNote=String(req.body.resolutionNote||'').trim();
    t.resolutionEvidence=[...existing,...files];
    t.resolvedBy={userId:me.id,name:me.name,department:me.department,label:me.label,email:me.email||'',phone:me.phone||''};
    t.resolvedAt=nowIso();t.updatedAt=nowIso();t.feedback=null;
    t.status=resolutionMode==='user_confirm'?'Resolved - Awaiting Confirmation':'Finished';
    t.userConfirmation=resolutionMode==='self_confirm'?{confirmed:true,selfConfirmed:true,at:nowIso(),by:me.name,note:'Diselesaikan dengan Self Confirm oleh admin/PIC.'}:null;
    t.timeline=t.timeline||[];
    t.timeline.push({at:nowIso(),type:'resolved',by:me.name,note:`${t.resolutionNote||'Pekerjaan ditandai selesai oleh admin.'} Mode: ${resolutionMode==='self_confirm'?'Self Confirm':'Menunggu Konfirmasi User'}.`});
    writeJson(TICKETS_FILE,tickets);

    if(resolutionMode==='user_confirm'){
      await notifyRequester(t,'Pekerjaan Selesai · Mohon Konfirmasi & Rating','Tim IT telah menyelesaikan pekerjaan pada ticket ini. Silakan konfirmasi hasil dan berikan rating 1–5 bintang.',t.resolutionNote?`<p><strong>Catatan penyelesaian:</strong><br>${escapeHtml(t.resolutionNote)}</p>`:'');
    }else{
      await Promise.allSettled([
        notifyRequester(t,'Ticket Selesai','Ticket telah ditutup menggunakan mode Self Confirm oleh tim IT.',t.resolutionNote?`<p><strong>Catatan penyelesaian:</strong><br>${escapeHtml(t.resolutionNote)}</p>`:''),
        notifyTicketTeam(t,'Ticket Selesai · Self Confirm',`Ticket ditutup oleh <strong>${escapeHtml(me.name)}</strong> menggunakan mode Self Confirm.`)
      ]);
    }
    res.json({ok:true,ticket:t});
  }catch(err){next(err)}
});

app.post('/api/tickets/:id/confirm',auth,async(req,res,next)=>{
  try{
    const me=findSessionUser(req);
    if(me.role!=='user')return res.status(403).json({error:'Konfirmasi hanya untuk user pemilik ticket.'});
    const tickets=readJson(TICKETS_FILE);const idx=tickets.findIndex(t=>t.id===req.params.id&&t.requester?.userId===me.id);
    if(idx<0)return res.status(404).json({error:'Ticket tidak ditemukan.'});
    const t=tickets[idx];
    if(t.status!=='Resolved - Awaiting Confirmation'||t.resolutionMode!=='user_confirm')return res.status(400).json({error:'Ticket belum menunggu konfirmasi user.'});
    const rating=Number(req.body.rating);
    if(!Number.isInteger(rating)||rating<1||rating>5)return res.status(400).json({error:'Rating 1 sampai 5 bintang wajib diisi.'});
    const note=String(req.body.note||'').trim();
    const feedback=String(req.body.feedback||'').trim();
    t.status='Finished';
    t.userConfirmation={confirmed:true,at:nowIso(),by:me.name,note};
    t.feedback={rating,comment:feedback,at:nowIso(),by:{userId:me.id,name:me.name}};
    t.updatedAt=nowIso();
    t.timeline=t.timeline||[];
    t.timeline.push({at:nowIso(),type:'confirmed',by:me.name,note:`User mengonfirmasi pekerjaan selesai dengan rating ${rating}/5.${feedback?' Feedback: '+feedback:''}`});
    writeJson(TICKETS_FILE,tickets);
    await notifyTicketTeam(t,'Ticket Dikonfirmasi Selesai',`User <strong>${escapeHtml(me.name)}</strong> mengonfirmasi pekerjaan selesai dengan rating <strong>${rating}/5</strong>.${feedback?`<p><strong>Feedback:</strong> ${escapeHtml(feedback)}</p>`:''}`);
    res.json({ok:true,ticket:t});
  }catch(err){next(err)}
});

app.post('/api/tickets/:id/reopen',auth,async(req,res,next)=>{
  try{
    const me=findSessionUser(req);
    if(me.role!=='user')return res.status(403).json({error:'Hanya user pemilik ticket yang dapat meminta reopen.'});
    const tickets=readJson(TICKETS_FILE);
    const idx=tickets.findIndex(t=>t.id===req.params.id&&t.requester?.userId===me.id);
    if(idx<0)return res.status(404).json({error:'Ticket tidak ditemukan.'});
    const t=tickets[idx];
    if(t.status!=='Resolved - Awaiting Confirmation'||t.resolutionMode!=='user_confirm')return res.status(400).json({error:'Ticket tidak berada pada tahap konfirmasi user.'});
    const note=String(req.body.note||'').trim();

    t.resolutionHistory=t.resolutionHistory||[];
    t.resolutionHistory.push({
      resolvedAt:t.resolvedAt||null,resolvedBy:t.resolvedBy||null,resolutionMode:t.resolutionMode||'user_confirm',
      resolutionNote:t.resolutionNote||'',reopenedAt:nowIso(),reopenedBy:{userId:me.id,name:me.name},reopenNote:note
    });
    t.status='Reopened';
    t.feedback=null;
    t.userConfirmation={confirmed:false,at:nowIso(),by:me.name,note};
    // Current resolution is reset so analytics measures the final successful completion, while history remains auditable.
    t.resolvedAt=null;t.resolvedBy=null;t.resolutionMode=null;t.resolutionNote='';
    t.updatedAt=nowIso();
    t.timeline=t.timeline||[];
    t.timeline.push({at:nowIso(),type:'reopened',by:me.name,note:`User meminta perbaikan lanjutan.${note?' '+note:''}`});
    writeJson(TICKETS_FILE,tickets);
    await notifyTicketTeam(t,'Ticket Dibuka Kembali',`User <strong>${escapeHtml(me.name)}</strong> menyatakan pekerjaan masih memerlukan tindak lanjut.${note?`<p><strong>Catatan:</strong> ${escapeHtml(note)}</p>`:''}`);
    res.json({ok:true,ticket:t});
  }catch(err){next(err)}
});

app.get('/api/dashboard',auth,(req,res)=>{
  const me=findSessionUser(req);
  const tickets=filterTickets(req,readJson(TICKETS_FILE));
  const stats={total:tickets.length,open:0,inProgress:0,waiting:0,resolved:0,finished:0,critical:0,evidenceFiles:0,originalBytes:0,storedBytes:0,savedBytes:0};
  tickets.forEach(t=>{
    if(t.status==='Open')stats.open++;
    if(t.status==='In Progress'||t.status==='Reopened')stats.inProgress++;
    if(t.status==='Waiting User')stats.waiting++;
    if(t.status==='Resolved - Awaiting Confirmation')stats.resolved++;
    if(t.status==='Finished')stats.finished++;
    if(t.priority==='Critical')stats.critical++;
    for(const f of [...(t.evidence||[]),...(t.resolutionEvidence||[])]){
      stats.evidenceFiles++;stats.originalBytes+=Number(f.originalSize||f.size||0);stats.storedBytes+=Number(f.size||0);stats.savedBytes+=Number(f.savedBytes||0);
    }
  });

  let analytics=null;
  if(isStaffViewRole(me?.role)){
    const all=filterTickets(req,readJson(TICKETS_FILE));
    const completed=all.filter(t=>t.resolvedAt&&['Finished','Resolved - Awaiting Confirmation'].includes(t.status));
    const avg=arr=>arr.length?Math.round(arr.reduce((a,b)=>a+b,0)/arr.length):0;
    const actualMinutes=t=>Math.max(0,Math.round((new Date(t.resolvedAt)-new Date(t.createdAt))/60000));
    const actualFromEstimate=t=>Math.max(0,Math.round((new Date(t.resolvedAt)-new Date(t.estimateSetAt||t.createdAt))/60000));
    const ratings=all.map(t=>Number(t.feedback?.rating)).filter(x=>x>=1&&x<=5);
    const onTimeEligible=completed.filter(t=>t.targetDueAt);
    const onTime=onTimeEligible.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;

    const priorities=['Critical','High','Medium','Low','Unassigned'].map(priority=>{
      const arr=completed.filter(t=>t.priority===priority);
      const eligible=arr.filter(t=>t.targetDueAt);
      const within=eligible.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;
      const avgEstimateMinutes=avg(eligible.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean));
      const avgComparableActualMinutes=avg(eligible.map(actualFromEstimate));
      const estimateUsagePct=avgEstimateMinutes&&avgComparableActualMinutes?Math.round(avgComparableActualMinutes/avgEstimateMinutes*100):null;
      return {
        priority,count:arr.length,avgMinutes:avg(arr.map(actualMinutes)),
        avgEstimateMinutes,avgComparableActualMinutes,
        withinEstimatePct:eligible.length?Math.round(within/eligible.length*100):null,
        eligibleCount:eligible.length,withinCount:within,lateCount:Math.max(0,eligible.length-within),
        estimateUsagePct,avgDeltaMinutes:avgEstimateMinutes&&avgComparableActualMinutes?avgComparableActualMinutes-avgEstimateMinutes:null
      };
    });

    const groupBy=(keyFn)=>{
      const m=new Map();
      for(const t of all){
        const key=keyFn(t);if(!key)continue;
        if(!m.has(key))m.set(key,[]);
        m.get(key).push(t);
      }
      return m;
    };
    const picGroups=groupBy(t=>t.assignedTo?.name);
    const picWorkload=[...picGroups.entries()].map(([name,arr])=>{
      const done=arr.filter(t=>t.resolvedAt&&['Finished','Resolved - Awaiting Confirmation'].includes(t.status));
      const eligible=done.filter(t=>t.targetDueAt);
      const within=eligible.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;
      const avgEstimateMinutes=avg(eligible.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean));
      const avgComparableActualMinutes=avg(eligible.map(actualFromEstimate));
      const rr=arr.map(t=>Number(t.feedback?.rating)).filter(x=>x>=1&&x<=5);
      const avgRating=rr.length?Number((rr.reduce((a,b)=>a+b,0)/rr.length).toFixed(2)):null;
      return {
        name,count:arr.length,finished:arr.filter(t=>t.status==='Finished').length,resolvedCount:done.length,
        completionPct:arr.length?Math.round(done.length/arr.length*100):0,
        avgMinutes:avg(done.map(actualMinutes)),avgRating,ratingCount:rr.length,ratingScorePct:avgRating===null?null:Math.round(avgRating/5*100),
        eligibleCount:eligible.length,withinCount:within,withinEstimatePct:eligible.length?Math.round(within/eligible.length*100):null,
        avgEstimateMinutes,avgComparableActualMinutes,
        estimateUsagePct:avgEstimateMinutes&&avgComparableActualMinutes?Math.round(avgComparableActualMinutes/avgEstimateMinutes*100):null
      };
    }).sort((a,b)=>b.count-a.count);

    const solverGroups=groupBy(t=>t.resolvedBy?.name);
    const solverWorkload=[...solverGroups.entries()].map(([name,arr])=>{
      const done=arr.filter(t=>t.resolvedAt);
      const eligible=done.filter(t=>t.targetDueAt);
      const within=eligible.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;
      return {name,count:done.length,avgMinutes:avg(done.map(actualMinutes)),withinEstimatePct:eligible.length?Math.round(within/eligible.length*100):null,eligibleCount:eligible.length,withinCount:within};
    }).sort((a,b)=>b.count-a.count);

    const active=all.filter(t=>!['Finished','Resolved - Awaiting Confirmation'].includes(t.status));
    const statusOrder=['Open','In Progress','Waiting User','Reopened','Resolved - Awaiting Confirmation','Finished'];
    const statusBreakdown=statusOrder.map(name=>({name,count:all.filter(t=>t.status===name).length}));
    const priorityDistribution=['Critical','High','Medium','Low','Unassigned'].map(name=>({name,count:all.filter(t=>t.priority===name).length}));
    const requestKinds=[
      {name:'Kendala',count:all.filter(t=>inferRequestKind(t)==='Issue').length},
      {name:'Permintaan',count:all.filter(t=>inferRequestKind(t)==='Request').length}
    ];
    const ratingDistribution=[5,4,3,2,1].map(rating=>({name:`${rating} Bintang`,count:all.filter(t=>Number(t.feedback?.rating)===rating).length}));
    const visibilityBreakdown=[
      {name:'Public',count:all.filter(t=>t.isPublic===true).length},
      {name:'Private',count:all.filter(t=>t.isPublic!==true).length}
    ];
    const estimateHealth=[
      {name:'Sesuai Target',count:onTime},
      {name:'Selesai Terlambat',count:Math.max(0,onTimeEligible.length-onTime)},
      {name:'Aktif Overdue',count:active.filter(t=>t.targetDueAt&&new Date(t.targetDueAt)<new Date()).length}
    ];
    const trendMap=new Map();
    const ensureTrend=(key)=>{if(!trendMap.has(key))trendMap.set(key,{date:key,created:0,resolved:0});return trendMap.get(key);};
    for(const t of all){
      if(t.createdAt)ensureTrend(jakartaDateKey(t.createdAt)).created++;
      if(t.resolvedAt)ensureTrend(jakartaDateKey(t.resolvedAt)).resolved++;
    }
    const activityTrend=[...trendMap.values()].filter(x=>x.date).sort((a,b)=>a.date.localeCompare(b.date)).slice(-31);
    analytics={
      totalTickets:all.length,
      completedCount:completed.length,
      avgResolutionMinutes:avg(completed.map(actualMinutes)),
      avgRating:ratings.length?Number((ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(2)):null,
      ratingCount:ratings.length,
      onTimePct:onTimeEligible.length?Math.round(onTime/onTimeEligible.length*100):null,
      overdueActive:active.filter(t=>t.targetDueAt&&new Date(t.targetDueAt)<new Date()).length,
      overdueProcessStart:all.filter(t=>t.status==='Open'&&t.processTargetAt&&new Date(t.processTargetAt)<new Date()).length,
      publicCount:all.filter(t=>t.isPublic===true).length,
      privateCount:all.filter(t=>t.isPublic!==true).length,
      byPriority:priorities,
      picWorkload,
      solverWorkload,
      requestKinds,
      issueTypes:[
        {name:'IT',count:all.filter(t=>inferIssueType(t)==='IT').length},
        {name:'Network',count:all.filter(t=>inferIssueType(t)==='Network').length}
      ],
      ratingDistribution,
      visibilityBreakdown,
      estimateHealth,
      resolutionModes:[
        {name:'User Confirm',count:all.filter(t=>t.resolutionMode==='user_confirm').length},
        {name:'Self Confirm',count:all.filter(t=>t.resolutionMode==='self_confirm').length}
      ],
      statusBreakdown,
      priorityDistribution,
      activityTrend,
      selectedPicKey:req.query.pic||'All',
      estimateComparison:{
        eligible:onTimeEligible.length,
        within:onTime,
        avgActualFromEstimateMinutes:avg(onTimeEligible.map(actualFromEstimate)),
        avgTargetMinutes:avg(onTimeEligible.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean)),
        usagePct:(()=>{const actual=avg(onTimeEligible.map(actualFromEstimate));const target=avg(onTimeEligible.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean));return actual&&target?Math.round(actual/target*100):null;})()
      }
    };
  }
  res.json({stats,analytics});
});
app.get('/api/system/status',rootOnly,(req,res)=>res.json({smtpConfigured,storage:'mysql',database:DB_CONFIG.database,internalDomain:INTERNAL_DOMAIN,maxUploadFiles:MAX_UPLOAD_FILES,maxUploadMB:MAX_UPLOAD_MB,picDirectoryCount:externalPicDirectory().length,imageCompression:{format:'webp',quality:IMAGE_WEBP_QUALITY,maxWidth:IMAGE_MAX_WIDTH,maxHeight:IMAGE_MAX_HEIGHT}}));


function xmlEscape(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function svgBarChart(title,items,width=760,height=300,total=null){
  const clean=(items||[]).filter(x=>Number(x.value)>0).slice(0,10);
  const max=Math.max(1,...clean.map(x=>Number(x.value)||0));
  const denominator=Number(total)||clean.reduce((sum,x)=>sum+(Number(x.value)||0),0);
  const left=170,right=36,top=58,bottom=26;
  const plotW=width-left-right;
  const rowH=clean.length?Math.max(24,Math.floor((height-top-bottom)/clean.length)):30;
  const bars=clean.map((x,i)=>{
    const y=top+i*rowH+5;
    const bw=Math.max(3,Math.round((Number(x.value)||0)/max*plotW));
    const pctValue=denominator?Math.round((Number(x.value)||0)/denominator*100):0;
    return `<text x="${left-12}" y="${y+14}" text-anchor="end" font-family="Arial,sans-serif" font-size="12" fill="#334155">${xmlEscape(x.name)}</text><rect x="${left}" y="${y}" width="${plotW}" height="16" rx="8" fill="#edf2f7"/><rect x="${left}" y="${y}" width="${bw}" height="16" rx="8" fill="#1f6fbd"/><text x="${Math.min(width-72,left+bw+8)}" y="${y+13}" font-family="Arial,sans-serif" font-size="11" fill="#475569">${xmlEscape(`${x.value} · ${pctValue}%`)}</text>`;
  }).join('');
  const empty=clean.length?'':`<text x="${width/2}" y="${height/2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">Belum ada data</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" rx="18" fill="#ffffff"/><text x="24" y="32" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#102b50">${xmlEscape(title)}</text>${bars}${empty}</svg>`;
}
function svgCompareChart(title,items,width=760,height=310){
  const clean=(items||[]).filter(x=>Number(x.actual)>0||Number(x.target)>0).slice(0,8);
  const max=Math.max(1,...clean.flatMap(x=>[Number(x.actual)||0,Number(x.target)||0]));
  const left=130,right=50,top=60,bottom=48,plotW=width-left-right,plotH=height-top-bottom;
  const colW=clean.length?plotW/clean.length:plotW;
  const bars=clean.map((x,i)=>{
    const x0=left+i*colW+colW*.18;
    const aw=colW*.25,tw=colW*.25;
    const ah=(Number(x.actual)||0)/max*plotH,th=(Number(x.target)||0)/max*plotH;
    return `<rect x="${x0}" y="${top+plotH-ah}" width="${aw}" height="${ah}" rx="4" fill="#1f6fbd"/><rect x="${x0+aw+6}" y="${top+plotH-th}" width="${tw}" height="${th}" rx="4" fill="#8ab6df"/><text x="${x0+colW*.25}" y="${top+plotH+18}" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#475569">${xmlEscape(x.name)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" rx="18" fill="#ffffff"/><text x="24" y="32" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#102b50">${xmlEscape(title)}</text><rect x="${width-220}" y="18" width="10" height="10" rx="2" fill="#1f6fbd"/><text x="${width-204}" y="27" font-family="Arial,sans-serif" font-size="11" fill="#475569">Aktual</text><rect x="${width-135}" y="18" width="10" height="10" rx="2" fill="#8ab6df"/><text x="${width-119}" y="27" font-family="Arial,sans-serif" font-size="11" fill="#475569">Target</text><line x1="${left}" y1="${top+plotH}" x2="${left+plotW}" y2="${top+plotH}" stroke="#dbe4ee"/>${bars}</svg>`;
}
function svgPercentBarChart(title,items,width=620,height=250){
  const clean=(items||[]).filter(x=>x.value!==null&&x.value!==undefined).slice(0,10);
  const left=150,right=48,top=58,bottom=28,plotW=width-left-right;
  const rowH=clean.length?Math.max(28,Math.floor((height-top-bottom)/clean.length)):32;
  const bars=clean.map((x,i)=>{
    const value=Math.max(0,Math.min(100,Number(x.value)||0));
    const y=top+i*rowH+5;
    const bw=plotW*value/100;
    return `<text x="${left-10}" y="${y+13}" text-anchor="end" font-family="Arial,sans-serif" font-size="11" fill="#475569">${xmlEscape(x.name)}</text><rect x="${left}" y="${y+3}" width="${plotW}" height="12" rx="6" fill="#edf2f7"/><rect x="${left}" y="${y+3}" width="${bw}" height="12" rx="6" fill="#1f6fbd"/><text x="${Math.min(width-40,left+bw+8)}" y="${y+13}" font-family="Arial,sans-serif" font-size="11" font-weight="700" fill="#28425f">${value}%</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" rx="18" fill="#ffffff"/><text x="24" y="32" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#102b50">${xmlEscape(title)}</text><text x="24" y="48" font-family="Arial,sans-serif" font-size="10" fill="#64748b">Persentase ticket selesai di dalam target estimasi.</text>${bars}</svg>`;
}

async function addSvgChartToSheet(workbook,sheet,svg,range){
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  const id=workbook.addImage({buffer:png,extension:'png'});
  sheet.addImage(id,range);
}

app.get('/api/tickets-export.xlsx',auth,async(req,res,next)=>{
  try{
    const me=findSessionUser(req);
    let list=filterTickets(req,readJson(TICKETS_FILE));
    if(me?.role==='user')list=list.filter(t=>t.requester?.userId===me.id);
    const wb=new ExcelJS.Workbook();wb.creator=APP_NAME;wb.created=new Date();
    const summary=wb.addWorksheet('Ringkasan');
    summary.columns=[{header:'Item',key:'item',width:38},{header:'Nilai',key:'value',width:46}];
    const period=[req.query.dateFrom&&`Dari ${req.query.dateFrom}`,req.query.dateTo&&`Sampai ${req.query.dateTo}`].filter(Boolean).join(' · ') || ({daily:'Hari Ini',weekly:'7 Hari Terakhir',monthly:'30 Hari Terakhir',all:'Keseluruhan'}[req.query.timeframe||'all']||'Keseluruhan');
    const ratings=list.map(t=>Number(t.feedback?.rating)).filter(x=>x>=1&&x<=5);
    const completed=list.filter(t=>t.resolvedAt);
    const avgMins=completed.length?Math.round(completed.reduce((n,t)=>n+Math.max(0,(new Date(t.resolvedAt)-new Date(t.createdAt))/60000),0)/completed.length):0;
    const eligible=completed.filter(t=>t.targetDueAt);
    const onTime=eligible.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;
    summary.addRows([
      {item:'Periode',value:period},{item:'Total Ticket',value:list.length},{item:'Kategori',value:req.query.category||'All'},
      {item:'Jenis Ticket',value:req.query.requestKind==='Request'?'Permintaan':req.query.requestKind==='Issue'?'Kendala':'All'},{item:'Area Penanganan',value:req.query.issueType||'All'},{item:'Visibility',value:req.query.visibility||'All'},
      {item:'Priority',value:req.query.priority||'All'},{item:'Status',value:req.query.status||'All'},
      {item:'PIC',value:req.query.pic&&req.query.pic!=='All'?(list[0]?.assignedTo?.name||req.query.pic):'All'},
      {item:'Solver',value:req.query.solver&&req.query.solver!=='All'?(list.find(t=>t.resolvedBy)?.resolvedBy?.name||req.query.solver):'All'},
      {item:'Created By',value:req.query.creator&&req.query.creator!=='All'?(list[0]?.createdBy?.name||req.query.creator):'All'},
      {item:'Rata-rata Durasi Penyelesaian',value:avgMins?`${avgMins} menit`:'-'},{item:'Sesuai Target Estimasi',value:eligible.length?`${Math.round(onTime/eligible.length*100)}% (${onTime}/${eligible.length})`:'-'},
      {item:'Rata-rata Aktual / Target',value:(()=>{const targets=eligible.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean);const actuals=eligible.map(t=>Math.max(0,Math.round((new Date(t.resolvedAt)-new Date(t.estimateSetAt||t.createdAt))/60000)));if(!targets.length||!actuals.length)return '-';const ta=Math.round(targets.reduce((a,b)=>a+b,0)/targets.length),aa=Math.round(actuals.reduce((a,b)=>a+b,0)/actuals.length);return ta?`${Math.round(aa/ta*100)}% dari target`:'-';})()},
      {item:'Rata-rata Rating User',value:ratings.length?`${(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(2)} / 5 (${ratings.length} feedback)`:'-'},
      {item:'Search',value:req.query.q||'-'}
    ]);
    summary.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};summary.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123E7C'}};summary.views=[{state:'frozen',ySplit:1}];
    const by=(fn)=>{const m=new Map();for(const t of list){const k=fn(t)||'Belum ditentukan';m.set(k,(m.get(k)||0)+1);}return [...m.entries()].sort((a,b)=>b[1]-a[1]);};
    let row=summary.rowCount+3;
    const addGroup=(title,items,total=list.length)=>{summary.getCell(`A${row}`).value=title;summary.getCell(`A${row}`).font={bold:true};summary.getCell(`B${row}`).value='Nilai · Persentase';summary.getCell(`B${row}`).font={bold:true,color:{argb:'FF60718A'}};row++;for(const [name,count] of items){summary.getCell(`A${row}`).value=name;summary.getCell(`B${row}`).value=`${count} · ${total?Math.round(count/total*100):0}%`;row++;}row+=2;};
    addGroup('Pembagian berdasarkan Status',by(t=>t.status));
    addGroup('Pembagian berdasarkan Priority',by(t=>t.priority));
    addGroup('Pembagian berdasarkan PIC',by(t=>t.assignedTo?.name));
    addGroup('Pembagian berdasarkan Solver',by(t=>t.resolvedBy?.name),completed.length||1);
    addGroup('Pembagian berdasarkan Jenis Ticket',by(t=>requestKindLabel(inferRequestKind(t))));
    addGroup('Pembagian berdasarkan Area Penanganan',by(t=>inferIssueType(t)));
    addGroup('Pembagian berdasarkan Visibility',by(t=>t.isPublic?'Public':'Private'));
    addGroup('Pembagian berdasarkan Mode Penyelesaian',by(t=>t.resolutionMode==='self_confirm'?'Self Confirm':t.resolutionMode==='user_confirm'?'User Confirm':'Belum Resolve'),list.length);

    const chartSheet=wb.addWorksheet('Dashboard Grafik');
    chartSheet.mergeCells('A1:J2');
    chartSheet.getCell('A1').value='ARU IT Ticketing - Dashboard Analytics';
    chartSheet.getCell('A1').font={bold:true,size:20,color:{argb:'FF123E7C'}};
    chartSheet.getCell('A1').alignment={vertical:'middle'};
    chartSheet.mergeCells('A3:J3');
    chartSheet.getCell('A3').value=`Periode: ${period} | Filter PIC: ${req.query.pic&&req.query.pic!=='All'?(list[0]?.assignedTo?.name||req.query.pic):'Semua PIC'}`;
    chartSheet.getCell('A3').font={color:{argb:'FF66758B'},size:11};
    for(let c=1;c<=10;c++)chartSheet.getColumn(c).width=14;
    chartSheet.getCell('A5').value='Total Ticket';chartSheet.getCell('B5').value=list.length;
    chartSheet.getCell('D5').value='Selesai';chartSheet.getCell('E5').value=`${completed.length} · ${list.length?Math.round(completed.length/list.length*100):0}%`;
    chartSheet.getCell('G5').value='Rata-rata Selesai';chartSheet.getCell('H5').value=avgMins?`${avgMins} menit`:'-';
    chartSheet.getCell('I5').value='Rating';chartSheet.getCell('J5').value=ratings.length?`${(ratings.reduce((a,b)=>a+b,0)/ratings.length).toFixed(2)}/5 · ${Math.round((ratings.reduce((a,b)=>a+b,0)/ratings.length)/5*100)}%`:'-';
    ['A5','D5','G5','I5'].forEach(cell=>{chartSheet.getCell(cell).font={bold:true,color:{argb:'FF60718A'}};});

    const picChartData=by(t=>t.assignedTo?.name).slice(0,8).map(([name,value])=>({name,value}));
    const statusChartData=by(t=>t.status).map(([name,value])=>({name,value}));
    const priorityChartData=['Critical','High','Medium','Low','Unassigned'].map(name=>{
      const arr=completed.filter(t=>t.priority===name);
      const eligibleArr=arr.filter(t=>t.targetDueAt);
      const actuals=eligibleArr.map(t=>Math.max(0,Math.round((new Date(t.resolvedAt)-new Date(t.estimateSetAt||t.createdAt))/60000)));
      const targets=eligibleArr.map(t=>Number(t.estimatedCompletionMinutes||estimateToMinutes(t.estimatedCompletion)||0)).filter(Boolean);
      const actual=actuals.length?Math.round(actuals.reduce((a,b)=>a+b,0)/actuals.length):0;
      const target=targets.length?Math.round(targets.reduce((a,b)=>a+b,0)/targets.length):0;
      const within=eligibleArr.filter(t=>new Date(t.resolvedAt)<=new Date(t.targetDueAt)).length;
      return {name,actual,target,withinPct:eligibleArr.length?Math.round(within/eligibleArr.length*100):null,usagePct:actual&&target?Math.round(actual/target*100):null};
    });
    const requestKindChartData=[
      {name:'Kendala',value:list.filter(t=>inferRequestKind(t)==='Issue').length},
      {name:'Permintaan',value:list.filter(t=>inferRequestKind(t)==='Request').length}
    ];
    const areaChartData=[
      {name:'IT',value:list.filter(t=>inferIssueType(t)==='IT').length},
      {name:'Network',value:list.filter(t=>inferIssueType(t)==='Network').length}
    ];
    const ratingChartData=[5,4,3,2,1].map(r=>({name:`${r} Bintang`,value:list.filter(t=>Number(t.feedback?.rating)===r).length}));
    const resolutionChartData=[
      {name:'User Confirm',value:list.filter(t=>t.resolutionMode==='user_confirm').length},
      {name:'Self Confirm',value:list.filter(t=>t.resolutionMode==='self_confirm').length}
    ];
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Workload Ticket per PIC',picChartData,760,300,list.length),'A7:E21');
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Distribusi Status Ticket',statusChartData,760,300,list.length),'F7:J21');
    await addSvgChartToSheet(wb,chartSheet,svgCompareChart('Rata-rata Aktual vs Target per Priority',priorityChartData,760,310),'A23:F39');
    await addSvgChartToSheet(wb,chartSheet,svgPercentBarChart('Sesuai Estimasi per Priority (%)',priorityChartData.map(x=>({name:x.name,value:x.withinPct})),620,310),'G23:J39');
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Jenis Ticket: Kendala vs Permintaan',requestKindChartData,620,240,list.length),'A41:E53');
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Area Penanganan: IT vs Network',areaChartData,620,240,list.length),'F41:J53');
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Distribusi Rating User',ratingChartData,620,250,ratings.length),'A55:E68');
    await addSvgChartToSheet(wb,chartSheet,svgBarChart('Mode Penyelesaian',resolutionChartData,620,240,resolutionChartData.reduce((n,x)=>n+x.value,0)),'F55:J68');
    chartSheet.getCell('F70').value='Catatan';
    chartSheet.getCell('F70').font={bold:true,color:{argb:'FF123E7C'}};
    chartSheet.mergeCells('F71:J78');
    chartSheet.getCell('F71').value='Grafik mengikuti filter export. Grafik priority membandingkan rata-rata aktual sejak estimasi ditetapkan dengan target, ditambah persentase ticket yang selesai di dalam target estimasi.';
    chartSheet.getCell('F71').alignment={vertical:'top',wrapText:true};
    chartSheet.getCell('F71').font={color:{argb:'FF66758B'},size:11};

    const ws=wb.addWorksheet('Tickets');
    ws.columns=[
      {header:'Ticket ID',key:'id',width:22},{header:'Created At',key:'createdAt',width:21},{header:'Updated At',key:'updatedAt',width:21},
      {header:'Requester',key:'requester',width:24},{header:'Bagian',key:'department',width:24},{header:'Email',key:'email',width:30},{header:'Phone',key:'phone',width:18},
      {header:'Created By',key:'createdBy',width:24},{header:'Creator Role',key:'creatorRole',width:18},
      {header:'Jenis Ticket',key:'requestKind',width:16},{header:'Area Penanganan',key:'issueType',width:16},{header:'Visibility',key:'visibility',width:12},{header:'Category',key:'category',width:22},{header:'Priority',key:'priority',width:12},{header:'Status',key:'status',width:30},
      {header:'Title',key:'title',width:36},{header:'Description',key:'description',width:52},
      {header:'Processing Est.',key:'processing',width:22},{header:'Process Days',key:'processingDays',width:12},{header:'Process Hours',key:'processingHours',width:12},{header:'Process Minutes',key:'processingMinutes',width:14},{header:'Process Target At',key:'processTargetAt',width:21},
      {header:'Completion Est.',key:'completion',width:24},{header:'Target Days',key:'completionDays',width:12},{header:'Target Hours',key:'completionHours',width:12},{header:'Target Minutes',key:'completionMinutes',width:14},{header:'Target Due At',key:'targetDueAt',width:21},{header:'Actual Resolution',key:'actualDuration',width:20},{header:'Estimate Result',key:'estimateResult',width:20},
      {header:'PIC',key:'pic',width:24},{header:'PIC Team',key:'picTeam',width:14},{header:'PIC Type',key:'picType',width:16},{header:'PIC Contact',key:'picContact',width:25},
      {header:'Solver',key:'solver',width:24},{header:'Resolved At',key:'resolvedAt',width:21},{header:'Resolution Mode',key:'resolutionMode',width:18},{header:'Resolution Note',key:'resolutionNote',width:52},
      {header:'Rating',key:'rating',width:10},{header:'Feedback',key:'feedback',width:42},{header:'Initial Evidence',key:'evidenceCount',width:16},{header:'Resolution Evidence',key:'resolutionCount',width:18}
    ];
    for(const t of list){
      const actual=t.resolvedAt?Math.max(0,Math.round((new Date(t.resolvedAt)-new Date(t.createdAt))/60000)):null;
      const estResult=t.resolvedAt&&t.targetDueAt?(new Date(t.resolvedAt)<=new Date(t.targetDueAt)?'Sesuai / lebih cepat':'Melewati estimasi'):'-';
      ws.addRow({
        id:t.id,createdAt:formatDateId(t.createdAt),updatedAt:formatDateId(t.updatedAt),requester:t.requester?.name||'',department:t.requester?.department||'',email:t.requester?.email||'',phone:t.requester?.phone||'',
        createdBy:t.createdBy?.name||'',creatorRole:t.createdBy?.role||'',requestKind:requestKindLabel(inferRequestKind(t)),issueType:inferIssueType(t),visibility:t.isPublic?'Public':'Private',category:t.category,priority:t.priority,status:t.status,title:t.title,description:t.description,
        processing:t.estimatedProcessing,processingDays:t.processingEstimate?.days||0,processingHours:t.processingEstimate?.hours||0,processingMinutes:t.processingEstimate?.minutes||0,processTargetAt:formatDateId(t.processTargetAt),
        completion:t.estimatedCompletion||'TBA',completionDays:t.completionEstimate?.days||0,completionHours:t.completionEstimate?.hours||0,completionMinutes:t.completionEstimate?.minutes||0,targetDueAt:formatDateId(t.targetDueAt),actualDuration:actual===null?'-':`${actual} menit`,estimateResult:estResult,
        pic:t.assignedTo?.name||'',picTeam:t.assignedTo?.supportType||'',picType:t.assignedTo?.type==='external'?'PIC Non-Admin':(t.assignedTo?'Admin':'Belum ditentukan'),picContact:t.assignedTo?.contact||t.assignedTo?.email||'',
        solver:t.resolvedBy?.name||'',resolvedAt:formatDateId(t.resolvedAt),resolutionMode:t.resolutionMode==='self_confirm'?'Self Confirm':t.resolutionMode==='user_confirm'?'User Confirm':'-',resolutionNote:t.resolutionNote||'',
        rating:t.feedback?.rating||'',feedback:t.feedback?.comment||'',evidenceCount:(t.evidence||[]).length,resolutionCount:(t.resolutionEvidence||[]).length
      });
    }
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123E7C'}};ws.views=[{state:'frozen',ySplit:1}];
    const excelCol=(n)=>{let out='';for(let x=n;x>0;x=Math.floor((x-1)/26))out=String.fromCharCode(65+((x-1)%26))+out;return out;};
    ws.autoFilter={from:'A1',to:`${excelCol(ws.columnCount)}${Math.max(1,ws.rowCount)}`};ws.eachRow((r,idx)=>{if(idx>1)r.alignment={vertical:'top',wrapText:true};});
    const safeFrom=String(req.query.dateFrom||'').replace(/[^0-9-]/g,'');const safeTo=String(req.query.dateTo||'').replace(/[^0-9-]/g,'');
    const suffix=safeFrom||safeTo?`${safeFrom||'awal'}_sd_${safeTo||'akhir'}`:(req.query.timeframe||'all');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename=ARU_IT_Ticketing_${suffix}.xlsx`);
    await wb.xlsx.write(res);res.end();
  }catch(err){next(err)}
});

app.use((err,req,res,next)=>{
  console.error(err);
  if(err instanceof multer.MulterError){const msg=err.code==='LIMIT_FILE_SIZE'?`Maksimum ${MAX_UPLOAD_MB} MB per file.`:err.code==='LIMIT_FILE_COUNT'?`Maksimum ${MAX_UPLOAD_FILES} file per upload.`:err.message;return res.status(400).json({error:msg});}
  res.status(err.status||400).json({error:err.message||'Terjadi kesalahan.'});
});
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
async function bootstrap(){
  await ensureSchema();
  await loadCollectionsFromMySQL();
  await migrateUsers();
  await migrateTickets();
  await seedRoot();
  await flushDbWrites();
  app.listen(PORT,HOST,()=>console.log(`${APP_NAME} V5.5.1 MySQL running at http://${HOST}:${PORT} | DB: ${DB_CONFIG.database}`));
}
async function shutdown(signal){
  console.log(`${signal} received. Flushing MySQL writes...`);
  try{await flushDbWrites();}catch(err){console.error('Flush error:',err.message);}
  try{await mysqlSessionStore.close();}catch{}
  try{if(dbPool)await dbPool.end();}catch{}
  process.exit(0);
}
process.once('SIGINT',()=>shutdown('SIGINT'));
process.once('SIGTERM',()=>shutdown('SIGTERM'));
bootstrap().catch(err=>{
  console.error('Failed to start ARU IT Ticketing:',err.message);
  console.error('Periksa DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD dan schema MySQL.');
  process.exit(1);
});
