require('dotenv').config();

const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pool, withTransaction, assertDatabaseReady, config: dbConfig } = require('./db');

const app = express();
if (String(process.env.TRUST_PROXY || 'false').toLowerCase() === 'true') app.set('trust proxy', 1);

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const APP_NAME = process.env.APP_NAME || 'ARU IT Ticketing';
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const INTERNAL_DOMAIN = String(process.env.INTERNAL_EMAIL_DOMAIN || 'aruraharja.co.id').toLowerCase();
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const TICKET_UPLOAD_DIR = path.join(UPLOAD_DIR, 'tickets');
const RESOLUTION_UPLOAD_DIR = path.join(UPLOAD_DIR, 'resolutions');

const MAX_UPLOAD_FILES = Number(process.env.MAX_UPLOAD_FILES || 10);
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 5);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const OTP_EXPIRE_MINUTES = Number(process.env.OTP_EXPIRE_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const SESSION_HOURS = Number(process.env.SESSION_HOURS || 12);
const IMAGE_MAX_WIDTH = Number(process.env.IMAGE_MAX_WIDTH || 1600);
const IMAGE_MAX_HEIGHT = Number(process.env.IMAGE_MAX_HEIGHT || 1600);
const IMAGE_WEBP_QUALITY = Number(process.env.IMAGE_WEBP_QUALITY || 68);

for (const dir of [UPLOAD_DIR, TICKET_UPLOAD_DIR, RESOLUTION_UPLOAD_DIR]) fs.mkdirSync(dir, { recursive: true });

function nowDate() { return new Date(); }
function nowIso() { return new Date().toISOString(); }
function toIso(v) { return v ? new Date(v).toISOString() : null; }
function uid(prefix='ID') { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }
function isAdminRole(role) { return role === 'admin' || role === 'root_admin'; }
function isInternalEmail(email='') { return String(email).trim().toLowerCase().endsWith(`@${INTERNAL_DOMAIN}`); }
function normalizeEmail(email='') { return String(email).trim().toLowerCase(); }
function sanitizeFilename(name='file') { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(-110) || 'file'; }
function roleLabelForServer(role) { return role==='root_admin'?'Root Administrator':role==='admin'?'Administrator':'User'; }
function escapeHtml(v='') { return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function maskedEmail(email='') {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(3, local.length-visible.length))}@${domain}`;
}
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
function sqlDate(v) { return v ? new Date(v) : null; }
function bool(v) { return Boolean(Number(v)); }
function publicUser(u) { if (!u) return null; const { passwordHash, ...safe } = u; return safe; }
function picKey(pic) {
  if (!pic) return '';
  if (pic.key) return String(pic.key);
  if (pic.type === 'external' && pic.picId) return `external:${pic.picId}`;
  if (pic.userId) return `admin:${pic.userId}`;
  return pic.name ? `name:${String(pic.name).trim().toLowerCase()}` : '';
}
function otpHash(code) { return crypto.createHmac('sha256', process.env.SESSION_SECRET || 'aru-dev-secret').update(String(code)).digest('hex'); }
function randomOtp() { return String(crypto.randomInt(100000, 1000000)); }

function dbUserToObject(r) {
  if (!r) return null;
  return {
    id:r.id, username:r.username, name:r.name, email:r.email, phone:r.phone,
    department:r.department, label:r.label, role:r.role, status:r.status,
    emailVerified:bool(r.email_verified), emailVerifiedAt:toIso(r.email_verified_at),
    passwordHash:r.password_hash, registrationMethod:r.registration_method,
    createdAt:toIso(r.created_at), approvedAt:toIso(r.approved_at), approvedBy:r.approved_by,
    createdByRoot:r.created_by_root, updatedAt:toIso(r.updated_at), updatedBy:r.updated_by,
    rejectionReason:r.rejection_reason, rejectedAt:toIso(r.rejected_at), rejectedBy:r.rejected_by,
    passwordChangedAt:toIso(r.password_changed_at), passwordChangedBy:r.password_changed_by,
    emailChangedBy:r.email_changed_by
  };
}

async function getUserById(id, conn=pool) {
  const [rows] = await conn.query('SELECT * FROM users WHERE id=? LIMIT 1',[id]);
  return dbUserToObject(rows[0]);
}
async function getUserByIdentity(identity, conn=pool) {
  const key=String(identity||'').trim().toLowerCase();
  if(!key)return null;
  const [rows]=await conn.query('SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=? LIMIT 1',[key,key]);
  return dbUserToObject(rows[0]);
}
async function listAllUsers(conn=pool) {
  const [rows]=await conn.query('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(dbUserToObject);
}
async function listActiveUsers(conn=pool) {
  const [rows]=await conn.query("SELECT * FROM users WHERE status='active' ORDER BY name ASC");
  return rows.map(dbUserToObject);
}
async function listActiveAdmins(conn=pool) {
  const [rows]=await conn.query("SELECT * FROM users WHERE status='active' AND role IN ('admin','root_admin') ORDER BY name ASC");
  return rows.map(dbUserToObject);
}

async function listExternalPics(conn=pool) {
  const [rows]=await conn.query('SELECT * FROM pics ORDER BY name ASC');
  return rows.map(r=>({
    id:r.id,name:r.name,contact:r.contact,createdAt:toIso(r.created_at),
    createdBy:{userId:r.created_by_user_id,name:r.created_by_name},
    updatedAt:toIso(r.updated_at),updatedBy:r.updated_by_user_id?{userId:r.updated_by_user_id,name:r.updated_by_name}:null
  }));
}
async function adminPicDirectory(conn=pool) {
  const admins=await listActiveAdmins(conn);
  return admins.map(u=>({
    key:`admin:${u.id}`,type:'admin',userId:u.id,name:u.name,
    contact:u.phone && u.phone!=='-' ? u.phone : (u.email||'-'),email:u.email||'',
    department:u.department||'',label:u.label||roleLabelForServer(u.role)
  }));
}
async function combinedPicDirectory(conn=pool) {
  const [admins, external]=await Promise.all([adminPicDirectory(conn),listExternalPics(conn)]);
  return [
    ...admins,
    ...external.map(p=>({key:`external:${p.id}`,type:'external',picId:p.id,name:p.name,contact:p.contact||'-',email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.contact||''))?String(p.contact).trim():'',department:'PIC Non-Admin',label:'External / Support PIC'}))
  ].sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
}
async function resolvePicSelection(value, conn=pool) {
  const key=String(value||'').trim();
  if(!key)return null;
  if(key.startsWith('admin:')){
    const u=await getUserById(key.slice(6),conn);
    if(!u || !isAdminRole(u.role) || u.status!=='active')return null;
    return {key,type:'admin',userId:u.id,name:u.name,contact:u.phone&&u.phone!=='-'?u.phone:(u.email||'-'),email:u.email||'',department:u.department||'',label:u.label||roleLabelForServer(u.role)};
  }
  if(key.startsWith('external:')){
    const id=key.slice(9);const [rows]=await conn.query('SELECT * FROM pics WHERE id=? LIMIT 1',[id]);const p=rows[0];
    if(!p)return null;
    return {key,type:'external',picId:p.id,name:p.name,contact:p.contact||'-',email:/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(p.contact||''))?String(p.contact).trim():'',department:'PIC Non-Admin',label:'External / Support PIC'};
  }
  return null;
}

function ticketRowToObject(r) {
  const assigned = r.assigned_pic_name ? {
    key:r.assigned_pic_key,
    type:r.assigned_pic_type,
    userId:r.assigned_admin_user_id || undefined,
    picId:r.assigned_external_pic_id || undefined,
    name:r.assigned_pic_name,
    contact:r.assigned_pic_contact || '',
    email:r.assigned_pic_email || '',
    department:r.assigned_pic_department || '',
    label:r.assigned_pic_label || '',
    accountDeleted:bool(r.assigned_pic_account_deleted)
  } : null;
  const resolved = r.resolved_by_name ? {
    userId:r.resolved_by_user_id || undefined,
    key:r.resolved_by_key || undefined,
    name:r.resolved_by_name,
    department:r.resolved_by_department || '',
    label:r.resolved_by_label || ''
  } : null;
  const confirmation = r.user_confirmation_state ? {
    confirmed:r.user_confirmation_state==='confirmed',
    at:toIso(r.user_confirmation_at),
    by:r.user_confirmation_by || '',
    note:r.user_confirmation_note || ''
  } : null;
  return {
    id:r.id,title:r.title,category:r.category,priority:r.priority,description:r.description,
    location:r.location||'',asset:r.asset||'',impact:r.impact||'',
    requester:{
      userId:r.requester_user_id||null,name:r.requester_name,email:r.requester_email||'',phone:r.requester_phone||'',
      department:r.requester_department||'',guest:bool(r.requester_guest),accountDeleted:bool(r.requester_account_deleted)
    },
    createdBy:{userId:r.created_by_user_id||null,key:r.created_by_key,name:r.created_by_name,role:r.created_by_role,department:r.created_by_department||''},
    createdAt:toIso(r.created_at),updatedAt:toIso(r.updated_at),status:r.status,
    estimatedProcessing:r.estimated_processing||'TBA',estimatedCompletion:r.estimated_completion||'TBA',
    assignedTo:assigned,resolvedBy:resolved,resolvedAt:toIso(r.resolved_at),resolutionNote:r.resolution_note||'',
    userConfirmation:confirmation,evidence:[],resolutionEvidence:[],timeline:[]
  };
}

function evidenceRowToObject(r) {
  return {id:r.id,name:r.name,filename:r.filename,size:Number(r.size_bytes||0),originalSize:Number(r.original_size_bytes||0),savedBytes:Number(r.saved_bytes||0),mimetype:r.mimetype,compressed:bool(r.compressed),url:r.url,uploadedAt:toIso(r.uploaded_at)};
}
function timelineRowToObject(r) { return {at:toIso(r.at),type:r.type,by:r.by_name,note:r.note}; }

async function hydrateTickets(rows,{includeTimeline=false}={}) {
  const tickets=rows.map(ticketRowToObject);
  if(!tickets.length)return tickets;
  const ids=tickets.map(t=>t.id);
  const placeholders=ids.map(()=>'?').join(',');
  const [evidenceRows]=await pool.query(`SELECT * FROM ticket_evidence WHERE ticket_id IN (${placeholders}) ORDER BY uploaded_at ASC,id ASC`,ids);
  const evidenceMap=new Map();
  for(const r of evidenceRows){
    if(!evidenceMap.has(r.ticket_id))evidenceMap.set(r.ticket_id,{initial:[],resolution:[]});
    evidenceMap.get(r.ticket_id)[r.kind].push(evidenceRowToObject(r));
  }
  for(const t of tickets){const e=evidenceMap.get(t.id)||{initial:[],resolution:[]};t.evidence=e.initial;t.resolutionEvidence=e.resolution;}
  if(includeTimeline){
    const [timelineRows]=await pool.query(`SELECT * FROM ticket_timeline WHERE ticket_id IN (${placeholders}) ORDER BY at ASC,id ASC`,ids);
    const timelineMap=new Map();
    for(const r of timelineRows){if(!timelineMap.has(r.ticket_id))timelineMap.set(r.ticket_id,[]);timelineMap.get(r.ticket_id).push(timelineRowToObject(r));}
    for(const t of tickets)t.timeline=timelineMap.get(t.id)||[];
  }
  return tickets;
}
async function getTicketById(id,{includeTimeline=true}={}) {
  const [rows]=await pool.query('SELECT * FROM tickets WHERE id=? LIMIT 1',[id]);
  if(!rows[0])return null;
  return (await hydrateTickets(rows,{includeTimeline}))[0];
}

const priorityDefaults={
  Critical:{processing:'1-2 jam',completion:'Hari ini / secepatnya'},
  High:{processing:'2-4 jam',completion:'1 hari kerja'},
  Medium:{processing:'1 hari kerja',completion:'2 hari kerja'},
  Low:{processing:'1-2 hari kerja',completion:'3-5 hari kerja'}
};

async function nextTicketId(conn) {
  const key = jakartaDateKey(new Date());

  await conn.query(
    'INSERT IGNORE INTO `ticket_sequences` (`seq_date`, `last_value`) VALUES (?, 0)',
    [key]
  );

  const [rows] = await conn.query(
    'SELECT `last_value` FROM `ticket_sequences` WHERE `seq_date` = ? FOR UPDATE',
    [key]
  );

  const next = Number(rows[0]?.last_value || 0) + 1;

  await conn.query(
    'UPDATE `ticket_sequences` SET `last_value` = ? WHERE `seq_date` = ?',
    [next, key]
  );

  return `ARU-${key.replaceAll('-', '')}-${String(next).padStart(4, '0')}`;
}

async function insertTimeline(conn,ticketId,type,byName,note,byUserId=null,at=nowDate()) {
  await conn.query('INSERT INTO ticket_timeline (ticket_id,at,type,by_user_id,by_name,note) VALUES (?,?,?,?,?,?)',[ticketId,at,type,byUserId,byName||'System',note||'']);
}
async function insertEvidenceRows(conn,ticketId,kind,files) {
  if(!files?.length)return;
  const values=files.map(f=>[ticketId,kind,f.name,f.filename,f.size,f.originalSize,f.savedBytes,f.mimetype,f.compressed?1:0,f.url,sqlDate(f.uploadedAt)]);
  await conn.query('INSERT INTO ticket_evidence (ticket_id,kind,name,filename,size_bytes,original_size_bytes,saved_bytes,mimetype,compressed,url,uploaded_at) VALUES ?', [values]);
}

function buildTicketFilter(req, me, alias='t') {
  const where=[];const params=[];
  if(me?.role==='user'){where.push(`${alias}.requester_user_id=?`);params.push(me.id);}
  const q=String(req.query.q||'').trim();
  if(q){
    const like=`%${q}%`;where.push(`(${alias}.id LIKE ? OR ${alias}.title LIKE ? OR ${alias}.category LIKE ? OR ${alias}.priority LIKE ? OR ${alias}.status LIKE ? OR ${alias}.description LIKE ? OR ${alias}.requester_name LIKE ? OR ${alias}.requester_department LIKE ? OR ${alias}.requester_email LIKE ? OR ${alias}.requester_phone LIKE ? OR ${alias}.created_by_name LIKE ? OR ${alias}.created_by_department LIKE ? OR ${alias}.assigned_pic_name LIKE ? OR ${alias}.assigned_pic_contact LIKE ? OR ${alias}.resolved_by_name LIKE ?)`);params.push(...Array(15).fill(like));
  }
  if(req.query.category&&req.query.category!=='All'){where.push(`${alias}.category=?`);params.push(req.query.category);}
  if(req.query.priority&&req.query.priority!=='All'){where.push(`${alias}.priority=?`);params.push(req.query.priority);}
  if(req.query.status&&req.query.status!=='All'){where.push(`${alias}.status=?`);params.push(req.query.status);}
  if(req.query.pic&&req.query.pic!=='All'){where.push(`${alias}.assigned_pic_key=?`);params.push(String(req.query.pic));}
  if(req.query.solver&&req.query.solver!=='All'){where.push(`${alias}.resolved_by_key=?`);params.push(String(req.query.solver));}
  if(req.query.creator&&req.query.creator!=='All'){where.push(`${alias}.created_by_key=?`);params.push(String(req.query.creator));}
  let from=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateFrom||''))?String(req.query.dateFrom):'';
  let to=/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.dateTo||''))?String(req.query.dateTo):'';
  if(!from&&!to){
    const tf=req.query.timeframe||'all';
    if(tf==='daily'){from=jakartaDateKey(new Date());to=from;}
    if(tf==='weekly'){const d=new Date();d.setDate(d.getDate()-6);from=jakartaDateKey(d);to=jakartaDateKey(new Date());}
  }
  if(from){where.push(`DATE(DATE_ADD(${alias}.created_at, INTERVAL 7 HOUR)) >= ?`);params.push(from);}
  if(to){where.push(`DATE(DATE_ADD(${alias}.created_at, INTERVAL 7 HOUR)) <= ?`);params.push(to);}
  const sortMap={
    created_asc:`${alias}.created_at ASC`,
    created_desc:`${alias}.created_at DESC`,
    updated_desc:`${alias}.updated_at DESC`,
    priority_desc:`FIELD(${alias}.priority,'Critical','High','Medium','Low','Unassigned') ASC`
  };
  return {whereSql:where.length?'WHERE '+where.join(' AND '):'',params,orderBy:sortMap[req.query.sort]||sortMap.updated_desc};
}

async function queryTickets(req,me,{includeTimeline=false}={}) {
  const f=buildTicketFilter(req,me);
  const [rows]=await pool.query(`SELECT * FROM tickets t ${f.whereSql} ORDER BY ${f.orderBy}`,f.params);
  return hydrateTickets(rows,{includeTimeline});
}

const allowedExt = new Set(['.jpg','.jpeg','.png','.webp','.gif','.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt']);
const imageExt = new Set(['.jpg','.jpeg','.png','.webp']);
const upload = multer({
  storage:multer.memoryStorage(),
  limits:{fileSize:MAX_UPLOAD_BYTES,files:MAX_UPLOAD_FILES},
  fileFilter:(_,file,cb)=>{const ext=path.extname(file.originalname).toLowerCase();const ok=allowedExt.has(ext);cb(ok?null:new Error('Tipe file tidak didukung.'),ok);}
});

async function saveUploadedFile(file,folderName) {
  const ext=path.extname(file.originalname).toLowerCase();
  const folder=folderName==='resolutions'?RESOLUTION_UPLOAD_DIR:TICKET_UPLOAD_DIR;
  const token=`${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
  const originalSize=file.size;
  if(imageExt.has(ext)){
    try{
      const compressed=await sharp(file.buffer).rotate().resize({width:IMAGE_MAX_WIDTH,height:IMAGE_MAX_HEIGHT,fit:'inside',withoutEnlargement:true}).webp({quality:IMAGE_WEBP_QUALITY,effort:5,smartSubsample:true}).toBuffer();
      if(compressed.length<file.buffer.length){
        const filename=`${token}.webp`;fs.writeFileSync(path.join(folder,filename),compressed);
        return {name:file.originalname,filename,size:compressed.length,originalSize,savedBytes:Math.max(0,originalSize-compressed.length),mimetype:'image/webp',compressed:true,url:`/uploads/${folderName}/${filename}`,uploadedAt:nowIso()};
      }
    }catch(err){console.warn('Image compression fallback:',file.originalname,err.message);}
  }
  const filename=`${token}-${sanitizeFilename(file.originalname)}`;fs.writeFileSync(path.join(folder,filename),file.buffer);
  return {name:file.originalname,filename,size:file.size,originalSize,savedBytes:0,mimetype:file.mimetype,compressed:false,url:`/uploads/${folderName}/${filename}`,uploadedAt:nowIso()};
}
async function saveUploadedFiles(files,folderName){return Promise.all((files||[]).map(f=>saveUploadedFile(f,folderName)));}
function removeSavedFiles(files,folderName){const folder=folderName==='resolutions'?RESOLUTION_UPLOAD_DIR:TICKET_UPLOAD_DIR;for(const f of files||[]){try{fs.unlinkSync(path.join(folder,f.filename));}catch(_){}}}

const smtpConfigured=Boolean(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS);
const mailer=smtpConfigured?nodemailer.createTransport({
  host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT||587),secure:String(process.env.SMTP_SECURE||'false').toLowerCase()==='true',requireTLS:String(process.env.SMTP_REQUIRE_TLS||'true').toLowerCase()==='true',
  auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS},tls:{minVersion:'TLSv1.2'},pool:true,maxConnections:3,maxMessages:100
}):null;

function mailShell(title,bodyHtml){return `<!doctype html><html><body style="margin:0;background:#f3f7fb;font-family:Arial,Helvetica,sans-serif;color:#13223d"><div style="max-width:640px;margin:0 auto;padding:32px 16px"><div style="background:#0c3978;color:white;border-radius:18px 18px 0 0;padding:24px 28px"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#7edcff;font-weight:700">PT ARU RAHARJA · IT SERVICE DESK</div><h1 style="font-size:24px;margin:8px 0 0">${title}</h1></div><div style="background:white;border:1px solid #dce5ef;border-top:0;border-radius:0 0 18px 18px;padding:28px;line-height:1.6">${bodyHtml}<div style="border-top:1px solid #e8eef5;margin-top:28px;padding-top:18px;color:#6b7890;font-size:12px">Pesan otomatis dari ${APP_NAME}. Mohon tidak membalas email ini.</div></div></div></body></html>`;}
async function sendEmail(to,subject,bodyHtml,required=false){
  if(!to)return false;if(!mailer){if(required)throw new Error('SMTP belum dikonfigurasi.');return false;}
  try{await mailer.sendMail({from:`"${process.env.MAIL_FROM_NAME||APP_NAME}" <${process.env.MAIL_FROM_ADDRESS||process.env.SMTP_USER}>`,to,subject,html:mailShell(subject,bodyHtml)});return true;}
  catch(err){console.error('Email failed:',to,subject,err.message);if(required)throw new Error('Email gagal dikirim. Periksa konfigurasi SMTP atau coba lagi beberapa saat.');return false;}
}
function otpEmailBody(name,code,purpose){const action=purpose==='registration'?'verifikasi alamat email untuk registrasi akun':'reset password akun';return `<p>Halo <strong>${escapeHtml(name||'Pengguna')}</strong>,</p><p>Gunakan kode berikut untuk ${action}:</p><div style="font-size:34px;letter-spacing:8px;font-weight:800;color:#0b3b82;background:#f2f7fc;border-radius:14px;padding:18px;text-align:center;margin:22px 0">${code}</div><p>Kode berlaku selama <strong>${OTP_EXPIRE_MINUTES} menit</strong> dan hanya dapat digunakan satu kali.</p><p style="color:#6b7890">Jika Anda tidak melakukan permintaan ini, abaikan email ini.</p>`;}

async function issueOtp(user,purpose,{ignoreCooldown=false}={}){
  const [latestRows]=await pool.query('SELECT * FROM email_tokens WHERE user_id=? AND purpose=? ORDER BY created_at DESC LIMIT 1',[user.id,purpose]);
  const latest=latestRows[0];
  if(!ignoreCooldown&&latest&&(Date.now()-new Date(latest.created_at).getTime())<OTP_RESEND_SECONDS*1000){const wait=Math.ceil((OTP_RESEND_SECONDS*1000-(Date.now()-new Date(latest.created_at).getTime()))/1000);const err=new Error(`Tunggu ${wait} detik sebelum mengirim ulang kode.`);err.status=429;throw err;}
  const code=randomOtp();const id=uid('OTP');const created=nowDate();const expires=new Date(Date.now()+OTP_EXPIRE_MINUTES*60*1000);
  await withTransaction(async conn=>{
    await conn.query('UPDATE email_tokens SET invalidated_at=? WHERE user_id=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL',[created,user.id,purpose]);
    await conn.query('INSERT INTO email_tokens (id,user_id,email,purpose,code_hash,attempts,max_attempts,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)',[id,user.id,user.email,purpose,otpHash(code),0,OTP_MAX_ATTEMPTS,created,expires]);
  });
  try{await sendEmail(user.email,purpose==='registration'?'Kode Verifikasi Akun IT Ticketing':'Kode Reset Password IT Ticketing',otpEmailBody(user.name,code,purpose),true);}
  catch(err){await pool.query('UPDATE email_tokens SET invalidated_at=? WHERE id=?',[nowDate(),id]);throw err;}
  return {id};
}
async function consumeOtp(userId,purpose,code){
  return withTransaction(async conn=>{
    const [rows]=await conn.query('SELECT * FROM email_tokens WHERE user_id=? AND purpose=? AND consumed_at IS NULL AND invalidated_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE',[userId,purpose]);
    const active=rows[0];if(!active)return {ok:false,error:'Kode tidak ditemukan atau sudah tidak berlaku.'};
    if(new Date(active.expires_at).getTime()<Date.now()){await conn.query('UPDATE email_tokens SET invalidated_at=? WHERE id=?',[nowDate(),active.id]);return {ok:false,error:'Kode sudah kedaluwarsa. Silakan kirim ulang kode.'};}
    if(Number(active.attempts)>=OTP_MAX_ATTEMPTS){await conn.query('UPDATE email_tokens SET invalidated_at=? WHERE id=?',[nowDate(),active.id]);return {ok:false,error:'Batas percobaan kode tercapai. Silakan kirim kode baru.'};}
    if(otpHash(code)!==active.code_hash){const attempts=Number(active.attempts)+1;await conn.query('UPDATE email_tokens SET attempts=?, invalidated_at=? WHERE id=?',[attempts,attempts>=OTP_MAX_ATTEMPTS?nowDate():null,active.id]);return {ok:false,error:`Kode tidak sesuai. Sisa percobaan ${Math.max(0,OTP_MAX_ATTEMPTS-attempts)}.`};}
    await conn.query('UPDATE email_tokens SET consumed_at=? WHERE id=?',[nowDate(),active.id]);return {ok:true};
  });
}

function ticketLink(ticket){return `${APP_BASE_URL}/?ticket=${encodeURIComponent(ticket.id)}`;}
function ticketSummaryHtml(ticket,heading,extra=''){
  return `<p>${heading}</p><table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:12px"><tr><td style="padding:12px;color:#68758b">Ticket</td><td style="padding:12px;font-weight:700">${escapeHtml(ticket.id)}</td></tr><tr><td style="padding:12px;color:#68758b">Judul</td><td style="padding:12px;font-weight:700">${escapeHtml(ticket.title)}</td></tr><tr><td style="padding:12px;color:#68758b">Status</td><td style="padding:12px">${escapeHtml(ticket.status)}</td></tr><tr><td style="padding:12px;color:#68758b">Priority</td><td style="padding:12px">${escapeHtml(ticket.priority)}</td></tr><tr><td style="padding:12px;color:#68758b">PIC</td><td style="padding:12px">${escapeHtml(ticket.assignedTo?.name||'Belum ditentukan')}</td></tr><tr><td style="padding:12px;color:#68758b">Estimasi</td><td style="padding:12px">${escapeHtml(ticket.estimatedCompletion||'TBA')}</td></tr></table>${extra}<p style="margin-top:20px"><a href="${ticketLink(ticket)}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Buka IT Ticketing</a></p>`;
}
async function notifyRequester(ticket,subject,intro,extra=''){return sendEmail(ticket.requester?.email,`${ticket.id} · ${subject}`,ticketSummaryHtml(ticket,intro,extra),false);}
async function notifyAdminsNewTicket(ticket){const admins=await listActiveAdmins();const emails=admins.filter(u=>u.email).map(u=>u.email);if(emails.length)await sendEmail([...new Set(emails)].join(','),`${ticket.id} · Ticket baru masuk`,ticketSummaryHtml(ticket,`Ticket baru dibuat oleh <strong>${escapeHtml(ticket.createdBy?.name||'-')}</strong>.`),false);}
async function notifyTicketTeam(ticket,subject,intro){const emails=[];if(ticket.assignedTo?.type==='admin'&&ticket.assignedTo?.userId){const u=await getUserById(ticket.assignedTo.userId);if(u?.email)emails.push(u.email);}if(ticket.resolvedBy?.userId){const u=await getUserById(ticket.resolvedBy.userId);if(u?.email)emails.push(u.email);}const ext=String(ticket.assignedTo?.contact||'').trim();if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ext))emails.push(ext);const unique=[...new Set(emails)];if(unique.length)await sendEmail(unique.join(','),`${ticket.id} · ${subject}`,ticketSummaryHtml(ticket,intro),false);}
async function notifyRootPendingUser(user){const roots=(await listActiveAdmins()).filter(u=>u.role==='root_admin'&&u.email).map(u=>u.email);if(!roots.length)return;await sendEmail([...new Set(roots)].join(','),'Registrasi Eksternal Menunggu Approval',`<p>Registrasi akun eksternal baru masuk dan menunggu persetujuan administrator IT.</p><table style="width:100%;border-collapse:collapse;background:#f7f9fc;border-radius:12px"><tr><td style="padding:10px;color:#68758b">Nama</td><td style="padding:10px;font-weight:700">${escapeHtml(user.name)}</td></tr><tr><td style="padding:10px;color:#68758b">Email</td><td style="padding:10px">${escapeHtml(user.email)}</td></tr><tr><td style="padding:10px;color:#68758b">Bagian</td><td style="padding:10px">${escapeHtml(user.department)}</td></tr></table><p style="margin-top:20px"><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Buka Account Management</a></p>`,false);}
async function notifyPicAssignment(ticket,pic){const email=pic?.email||(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(pic?.contact||''))?String(pic.contact).trim():'');if(email)await sendEmail(email,`${ticket.id} · Ticket Ditugaskan Kepada Anda`,ticketSummaryHtml(ticket,`Anda ditetapkan sebagai PIC untuk ticket <strong>${escapeHtml(ticket.id)}</strong>.`),false);}

function updateSession(req,u){req.session.user={id:u.id,username:u.username,name:u.name,role:u.role,department:u.department,label:u.label,email:u.email};}
async function findSessionUser(req){if(!req.session.user)return null;return getUserById(req.session.user.id);}
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:'Silakan login.'});next();}
function adminOnly(req,res,next){if(!req.session.user||!isAdminRole(req.session.user.role))return res.status(403).json({error:'Akses admin diperlukan.'});next();}
function rootOnly(req,res,next){if(!req.session.user||req.session.user.role!=='root_admin')return res.status(403).json({error:'Akses root admin diperlukan.'});next();}

const rateBuckets=new Map();
function rateLimit(name,windowMs,max){return (req,res,next)=>{const now=Date.now(),key=`${name}:${req.ip}`;let row=rateBuckets.get(key);if(!row||row.resetAt<=now)row={count:0,resetAt:now+windowMs};row.count++;rateBuckets.set(key,row);if(row.count>max)return res.status(429).json({error:'Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.'});next();};}
const authLimiter=rateLimit('auth',15*60*1000,30);const mailLimiter=rateLimit('mail',15*60*1000,15);const guestLimiter=rateLimit('guest',15*60*1000,12);

async function seedRoot(){
  const [rows]=await pool.query("SELECT COUNT(*) AS c FROM users WHERE role='root_admin'");
  if(Number(rows[0].c)>0)return;
  const at=nowDate();const id=uid('USR');const passwordHash=await bcrypt.hash(process.env.ROOT_ADMIN_PASSWORD||'@Deva2004',12);
  await pool.query(`INSERT INTO users (id,username,name,email,phone,department,label,role,status,email_verified,email_verified_at,password_hash,registration_method,created_at,approved_at,approved_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
    id,process.env.ROOT_ADMIN_USERNAME||'admin',process.env.ROOT_ADMIN_NAME||'Root Admin',normalizeEmail(process.env.ROOT_ADMIN_EMAIL||'masterofunity@gmail.com'),'-',process.env.ROOT_ADMIN_DEPARTMENT||'IT Web Development & Operations','Root Administrator','root_admin','active',1,at,passwordHash,'system_seed',at,at,'SYSTEM'
  ]);
  console.log('Root administrator seeded from environment variables.');
}

const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  password: dbConfig.password,
  database: dbConfig.database,
  clearExpired:true,
  checkExpirationInterval:15*60*1000,
  expiration:SESSION_HOURS*60*60*1000,
  createDatabaseTable:false,
  schema:{tableName:'sessions',columnNames:{session_id:'session_id',expires:'expires',data:'data'}}
});

app.disable('x-powered-by');
app.use(express.json({limit:'2mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  store:sessionStore,
  secret:process.env.SESSION_SECRET||'aru-ticketing-dev-secret-change-me',
  resave:false,
  saveUninitialized:false,
  rolling:true,
  cookie:{httpOnly:true,sameSite:'lax',secure:String(process.env.SESSION_COOKIE_SECURE||'false').toLowerCase()==='true',maxAge:1000*60*60*SESSION_HOURS}
}));

app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  next();
});
app.use('/uploads',express.static(UPLOAD_DIR,{fallthrough:false,maxAge:'7d'}));
app.use(express.static(path.join(ROOT,'public')));

// ---------------- AUTH & EMAIL VERIFICATION ----------------
app.post('/api/register',mailLimiter,async(req,res,next)=>{
  try{
    const {username,password,name,email,phone,department}=req.body;
    if(![username,password,name,email,phone,department].every(v=>String(v||'').trim()))return res.status(400).json({error:'Semua field registrasi wajib diisi.'});
    if(String(password).length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const cleanEmail=normalizeEmail(email),cleanUsername=String(username).trim(),internal=isInternalEmail(cleanEmail);
    const [dup]=await pool.query('SELECT id FROM users WHERE LOWER(username)=? OR LOWER(email)=? LIMIT 1',[cleanUsername.toLowerCase(),cleanEmail]);
    if(dup.length)return res.status(409).json({error:'Username atau email sudah digunakan.'});
    const user={id:uid('USR'),username:cleanUsername,name:String(name).trim(),email:cleanEmail,phone:String(phone).trim(),department:String(department).trim(),label:'User',role:'user',status:internal?'pending_verification':'pending_approval',emailVerified:false,passwordHash:await bcrypt.hash(password,12),createdAt:nowIso(),registrationMethod:internal?'internal_email_otp':'external_admin_approval'};
    await pool.query(`INSERT INTO users (id,username,name,email,phone,department,label,role,status,email_verified,password_hash,registration_method,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      user.id,user.username,user.name,user.email,user.phone,user.department,user.label,user.role,user.status,0,user.passwordHash,user.registrationMethod,sqlDate(user.createdAt)
    ]);
    if(internal){
      try{await issueOtp(user,'registration',{ignoreCooldown:true});}
      catch(err){await pool.query('DELETE FROM users WHERE id=?',[user.id]);return res.status(503).json({error:err.message});}
      return res.json({ok:true,needsVerification:true,needsApproval:false,identity:user.email,maskedEmail:maskedEmail(user.email),message:'Kode verifikasi telah dikirim ke email internal Anda.'});
    }
    await Promise.allSettled([
      sendEmail(user.email,'Registrasi IT Ticketing Diterima',`<p>Halo <strong>${escapeHtml(user.name)}</strong>,</p><p>Registrasi akun Anda sudah diterima dan sedang menunggu persetujuan administrator IT.</p><p>Notifikasi akan dikirim setelah akun disetujui.</p>`,false),
      notifyRootPendingUser(user)
    ]);
    res.json({ok:true,needsVerification:false,needsApproval:true,identity:user.email,message:'Registrasi berhasil diajukan. Akun akan dapat digunakan setelah disetujui admin IT.'});
  }catch(err){next(err)}
});

app.post('/api/register/resend',mailLimiter,async(req,res,next)=>{
  try{
    const user=await getUserByIdentity(req.body.identity);
    if(!user||user.emailVerified||!isInternalEmail(user.email)||user.status!=='pending_verification')return res.status(400).json({error:'Kode verifikasi hanya berlaku untuk registrasi email internal yang belum terverifikasi.'});
    await issueOtp(user,'registration');res.json({ok:true,maskedEmail:maskedEmail(user.email),message:'Kode baru telah dikirim.'});
  }catch(err){next(err)}
});

app.post('/api/register/verify',authLimiter,async(req,res,next)=>{
  try{
    const user=await getUserByIdentity(req.body.identity);if(!user)return res.status(400).json({error:'Akun tidak ditemukan.'});
    if(!isInternalEmail(user.email))return res.status(400).json({error:'Registrasi eksternal tidak menggunakan OTP dan harus menunggu approval admin.'});
    if(user.emailVerified)return res.status(400).json({error:'Email sudah terverifikasi. Silakan login menggunakan akun Anda.'});
    const check=await consumeOtp(user.id,'registration',String(req.body.code||''));if(!check.ok)return res.status(400).json({error:check.error});
    const at=nowDate();await pool.query("UPDATE users SET email_verified=1,email_verified_at=?,status='active',approved_at=?,approved_by='AUTO_INTERNAL_DOMAIN' WHERE id=?",[at,at,user.id]);
    const updated=await getUserById(user.id);updateSession(req,updated);
    await sendEmail(updated.email,'Akun IT Ticketing Aktif',`<p>Halo <strong>${escapeHtml(updated.name)}</strong>,</p><p>Email internal Anda berhasil diverifikasi dan akun <strong>langsung aktif</strong>. Anda sudah masuk ke ${APP_NAME}.</p>`,false);
    res.json({ok:true,status:'active',autoActivated:true,user:publicUser(updated),message:'Email berhasil diverifikasi. Akun aktif dan Anda langsung masuk ke dashboard.'});
  }catch(err){next(err)}
});

app.post('/api/login',authLimiter,async(req,res,next)=>{
  try{
    const user=await getUserByIdentity(req.body.login);
    if(!user||!(await bcrypt.compare(String(req.body.password||''),user.passwordHash)))return res.status(401).json({error:'Username/email atau password salah.'});
    if(user.status!=='active'){
      const msg=user.status==='pending_verification'?'Email belum diverifikasi.':user.status==='pending_approval'?'Akun masih menunggu approval admin.':user.status==='rejected'?'Registrasi akun ditolak.':'Akun tidak aktif.';
      return res.status(403).json({error:msg,status:user.status,identity:user.email});
    }
    updateSession(req,user);res.json({ok:true,user:publicUser(user)});
  }catch(err){next(err)}
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,async(req,res,next)=>{try{const u=await findSessionUser(req);if(!u||u.status!=='active')return res.status(401).json({error:'Session tidak valid.'});updateSession(req,u);res.json({user:publicUser(u)});}catch(err){next(err)}});

app.post('/api/change-password',auth,async(req,res,next)=>{
  try{
    const u=await getUserById(req.session.user.id);if(!u)return res.status(404).json({error:'User tidak ditemukan.'});
    if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password baru minimal 8 karakter.'});
    if(!(await bcrypt.compare(String(req.body.currentPassword||''),u.passwordHash)))return res.status(400).json({error:'Password saat ini salah.'});
    const hash=await bcrypt.hash(req.body.newPassword,12);await pool.query('UPDATE users SET password_hash=?,password_changed_at=?,password_changed_by=? WHERE id=?',[hash,nowDate(),u.id,u.id]);
    await sendEmail(u.email,'Password IT Ticketing Diubah',`<p>Password akun <strong>${escapeHtml(u.username)}</strong> baru saja diubah pada ${escapeHtml(formatDateId(nowIso()))}.</p><p>Jika bukan Anda yang melakukan perubahan ini, segera hubungi tim IT.</p>`,false);
    res.json({ok:true,message:'Password berhasil diubah.'});
  }catch(err){next(err)}
});

app.post('/api/forgot-password',mailLimiter,async(req,res,next)=>{
  try{const user=await getUserByIdentity(req.body.identity);if(!user)return res.json({ok:true,message:'Jika akun ditemukan, kode reset akan dikirim ke email terdaftar.'});if(!user.email)return res.status(400).json({error:'Akun tidak memiliki email.'});await issueOtp(user,'password_reset');res.json({ok:true,identity:user.email,maskedEmail:maskedEmail(user.email),message:'Kode reset password telah dikirim ke email terdaftar.'});}catch(err){next(err)}
});
app.post('/api/forgot-password/resend',mailLimiter,async(req,res,next)=>{try{const user=await getUserByIdentity(req.body.identity);if(!user)return res.json({ok:true,message:'Jika akun ditemukan, kode akan dikirim.'});await issueOtp(user,'password_reset');res.json({ok:true,maskedEmail:maskedEmail(user.email),message:'Kode reset baru telah dikirim.'});}catch(err){next(err)}});
app.post('/api/reset-password',authLimiter,async(req,res,next)=>{
  try{
    const user=await getUserByIdentity(req.body.identity);if(!user)return res.status(400).json({error:'Kode atau akun tidak valid.'});
    if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password baru minimal 8 karakter.'});
    const check=await consumeOtp(user.id,'password_reset',String(req.body.code||''));if(!check.ok)return res.status(400).json({error:check.error});
    const hash=await bcrypt.hash(req.body.newPassword,12);await pool.query('UPDATE users SET password_hash=?,password_changed_at=? WHERE id=?',[hash,nowDate(),user.id]);
    await sendEmail(user.email,'Password IT Ticketing Berhasil Direset',`<p>Password akun Anda berhasil direset pada ${escapeHtml(formatDateId(nowIso()))}.</p><p>Jika bukan Anda yang melakukan reset ini, segera hubungi tim IT.</p>`,false);
    res.json({ok:true,message:'Password berhasil direset. Silakan login menggunakan password baru.'});
  }catch(err){next(err)}
});

// ---------------- USERS & ADMINS ----------------
app.get('/api/admin/directory',adminOnly,async(req,res,next)=>{try{const users=(await listActiveUsers()).map(publicUser).map(u=>({id:u.id,username:u.username,name:u.name,email:u.email,phone:u.phone,department:u.department,label:u.label,role:u.role,status:u.status}));res.json({users});}catch(err){next(err)}});
app.get('/api/root/accounts',rootOnly,async(req,res,next)=>{try{res.json({users:(await listAllUsers()).map(publicUser)});}catch(err){next(err)}});
app.get('/api/admin/users',adminOnly,async(req,res,next)=>{try{const [rows]=await pool.query("SELECT * FROM users WHERE role='user' AND status IN ('pending_approval','rejected') ORDER BY created_at DESC");res.json({users:rows.map(dbUserToObject).map(publicUser)});}catch(err){next(err)}});

app.post('/api/admin/users/:id/approve',adminOnly,async(req,res,next)=>{
  try{
    const u=await getUserById(req.params.id);if(!u||u.role!=='user')return res.status(404).json({error:'User tidak ditemukan.'});
    if(u.status!=='pending_approval')return res.status(400).json({error:'Hanya registrasi eksternal berstatus pending approval yang dapat disetujui dari antrean ini.'});
    const at=nowDate();await pool.query("UPDATE users SET status='active',approved_at=?,approved_by=?,rejection_reason=NULL,rejected_at=NULL,rejected_by=NULL WHERE id=?",[at,req.session.user.id,u.id]);
    const updated=await getUserById(u.id);await sendEmail(updated.email,'Akun IT Ticketing Disetujui',`<p>Halo <strong>${escapeHtml(updated.name)}</strong>,</p><p>Registrasi Anda telah disetujui oleh administrator IT. Akun sekarang aktif dan dapat digunakan.</p><p><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Login</a></p>`,false);
    res.json({ok:true,user:publicUser(updated)});
  }catch(err){next(err)}
});
app.post('/api/admin/users/:id/reject',adminOnly,async(req,res,next)=>{
  try{
    const u=await getUserById(req.params.id);if(!u||u.role!=='user')return res.status(404).json({error:'User tidak ditemukan.'});
    const reason=String(req.body.reason||'Tidak memenuhi ketentuan akses.').trim();await pool.query("UPDATE users SET status='rejected',rejection_reason=?,rejected_at=?,rejected_by=? WHERE id=?",[reason,nowDate(),req.session.user.id,u.id]);
    await sendEmail(u.email,'Registrasi IT Ticketing Tidak Disetujui',`<p>Registrasi akun Anda belum dapat disetujui.</p><p><strong>Catatan:</strong> ${escapeHtml(reason)}</p><p>Silakan hubungi tim IT jika membutuhkan klarifikasi.</p>`,false);res.json({ok:true});
  }catch(err){next(err)}
});

async function createRootManagedAccount(req,res,next,forcedRole=null){
  try{
    const role=forcedRole||req.body.role||'user';const {username,password,name,email,phone,department,label}=req.body;
    if(!['user','admin'].includes(role))return res.status(400).json({error:'Role hanya dapat user atau admin.'});
    if(![username,password,name,email,department].every(v=>String(v||'').trim()))return res.status(400).json({error:'Username, password, nama, email, dan bagian wajib diisi.'});
    if(String(password).length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});
    const cleanEmail=normalizeEmail(email),cleanUsername=String(username).trim();const [dup]=await pool.query('SELECT id FROM users WHERE LOWER(username)=? OR LOWER(email)=? LIMIT 1',[cleanUsername.toLowerCase(),cleanEmail]);if(dup.length)return res.status(409).json({error:'Username/email sudah digunakan.'});
    const at=nowDate(),id=uid('USR'),hash=await bcrypt.hash(password,12);
    await pool.query(`INSERT INTO users (id,username,name,email,phone,department,label,role,status,email_verified,email_verified_at,password_hash,registration_method,created_at,approved_at,approved_by,created_by_root) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
      id,cleanUsername,String(name).trim(),cleanEmail,String(phone||'-').trim()||'-',String(department).trim(),String(label||(role==='admin'?'Administrator':'User')).trim(),role,'active',1,at,hash,'root_created',at,at,req.session.user.id,req.session.user.id
    ]);
    const u=await getUserById(id);await sendEmail(u.email,role==='admin'?'Akun Administrator IT Ticketing Dibuat':'Akun IT Ticketing Dibuat',`<p>Halo <strong>${escapeHtml(u.name)}</strong>,</p><p>Akun ${APP_NAME} Anda dibuat oleh root administrator.</p><p>Username: <strong>${escapeHtml(u.username)}</strong></p><p>Gunakan password awal yang diberikan oleh root administrator dan segera ganti password setelah login.</p><p><a href="${APP_BASE_URL}" style="display:inline-block;background:#0c3978;color:white;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Login</a></p>`,false);
    res.json({ok:true,user:publicUser(u)});
  }catch(err){next(err)}
}
app.post('/api/root/accounts',rootOnly,(req,res,next)=>createRootManagedAccount(req,res,next));
app.post('/api/admin/create-admin',rootOnly,(req,res,next)=>createRootManagedAccount(req,res,next,'admin'));

app.patch('/api/root/accounts/:id',rootOnly,async(req,res,next)=>{
  try{
    const current=await getUserById(req.params.id);if(!current)return res.status(404).json({error:'Akun tidak ditemukan.'});
    if(current.role==='root_admin'&&current.id!==req.session.user.id)return res.status(403).json({error:'Root administrator lain tidak dapat diedit.'});
    const nextRole=current.role==='root_admin'?'root_admin':(['user','admin'].includes(req.body.role)?req.body.role:current.role);
    const nextUsername=String(req.body.username??current.username).trim(),nextEmail=normalizeEmail(req.body.email??current.email);if(!nextUsername||!nextEmail)return res.status(400).json({error:'Username dan email wajib diisi.'});
    const [dup]=await pool.query('SELECT id FROM users WHERE id<>? AND (LOWER(username)=? OR LOWER(email)=?) LIMIT 1',[current.id,nextUsername.toLowerCase(),nextEmail]);if(dup.length)return res.status(409).json({error:'Username atau email sudah digunakan akun lain.'});
    let nextStatus=current.status;if(nextRole==='admin'||nextRole==='root_admin')nextStatus='active';else if(req.body.status&&['active','pending_approval','rejected','disabled'].includes(req.body.status))nextStatus=req.body.status;
    const emailChanged=nextEmail!==current.email;
    await pool.query(`UPDATE users SET username=?,email=?,name=?,phone=?,department=?,label=?,role=?,status=?,email_verified=?,email_verified_at=?,email_changed_by=?,updated_at=?,updated_by=? WHERE id=?`,[
      nextUsername,nextEmail,String(req.body.name??current.name).trim()||current.name,String(req.body.phone??current.phone??'-').trim()||'-',String(req.body.department??current.department).trim()||current.department,String(req.body.label??current.label??(nextRole==='admin'?'Administrator':'User')).trim(),nextRole,nextStatus,(nextRole==='admin'||nextRole==='root_admin'||emailChanged)?1:(current.emailVerified?1:0),(nextRole==='admin'||nextRole==='root_admin'||emailChanged)?nowDate():sqlDate(current.emailVerifiedAt),emailChanged?req.session.user.id:current.emailChangedBy,nowDate(),req.session.user.id,current.id
    ]);
    const updated=await getUserById(current.id);if(updated.id===req.session.user.id)updateSession(req,updated);await sendEmail(updated.email,'Profil Akun IT Ticketing Diperbarui',`<p>Data akun <strong>${escapeHtml(updated.username)}</strong> baru saja diperbarui oleh root administrator.</p><p>Jika ada data yang tidak sesuai, hubungi tim IT.</p>`,false);res.json({ok:true,user:publicUser(updated)});
  }catch(err){next(err)}
});

app.delete('/api/root/accounts/:id',rootOnly,async(req,res,next)=>{
  try{
    const target=await getUserById(req.params.id);if(!target)return res.status(404).json({error:'Akun tidak ditemukan.'});if(target.role==='root_admin')return res.status(403).json({error:'Root administrator tidak dapat dihapus.'});
    await withTransaction(async conn=>{
      const [assigned]=await conn.query('SELECT id FROM tickets WHERE assigned_admin_user_id=?',[target.id]);
      await conn.query('UPDATE tickets SET requester_account_deleted=1 WHERE requester_user_id=?',[target.id]);
      await conn.query('UPDATE tickets SET assigned_pic_account_deleted=1 WHERE assigned_admin_user_id=?',[target.id]);
      for(const row of assigned)await insertTimeline(conn,row.id,'account_deleted',req.session.user.name,`Akun PIC ${target.name} dihapus, tetapi snapshot PIC pada histori ticket tetap dipertahankan.`,req.session.user.id);
      await conn.query('DELETE FROM users WHERE id=?',[target.id]);
    });
    await sendEmail(target.email,'Akun IT Ticketing Dinonaktifkan',`<p>Akun <strong>${escapeHtml(target.username)}</strong> telah dihapus oleh root administrator.</p><p>Jika Anda merasa ini tidak sesuai, hubungi tim IT.</p>`,false);res.json({ok:true});
  }catch(err){next(err)}
});

async function rootResetPassword(req,res,next){
  try{
    if(String(req.body.newPassword||'').length<8)return res.status(400).json({error:'Password minimal 8 karakter.'});const u=await getUserById(req.params.id);if(!u||u.role==='root_admin')return res.status(404).json({error:'Akun tidak ditemukan atau tidak dapat direset dari sini.'});const hash=await bcrypt.hash(req.body.newPassword,12);await pool.query('UPDATE users SET password_hash=?,password_changed_at=?,password_changed_by=? WHERE id=?',[hash,nowDate(),req.session.user.id,u.id]);await sendEmail(u.email,'Password Akun IT Ticketing Direset',`<p>Password akun Anda telah direset oleh root administrator.</p><p>Silakan login menggunakan password baru yang diberikan dan segera lakukan penggantian password.</p>`,false);res.json({ok:true});
  }catch(err){next(err)}
}
app.post('/api/root/accounts/:id/reset-password',rootOnly,rootResetPassword);
app.post('/api/admin/accounts/:id/reset-password',rootOnly,rootResetPassword);

// ---------------- PIC DIRECTORY ----------------
app.get('/api/admin/pics',adminOnly,async(req,res,next)=>{try{const [pics,external]=await Promise.all([combinedPicDirectory(),listExternalPics()]);res.json({pics,external});}catch(err){next(err)}});
app.post('/api/admin/pics',adminOnly,async(req,res,next)=>{
  try{const name=String(req.body.name||'').trim(),contact=String(req.body.contact||'').trim();if(!name||!contact)return res.status(400).json({error:'Nama dan kontak PIC wajib diisi.'});const [dup]=await pool.query('SELECT id FROM pics WHERE LOWER(name)=? AND LOWER(contact)=? LIMIT 1',[name.toLowerCase(),contact.toLowerCase()]);if(dup.length)return res.status(409).json({error:'PIC dengan nama dan kontak tersebut sudah ada.'});const id=uid('PIC');await pool.query('INSERT INTO pics (id,name,contact,created_at,created_by_user_id,created_by_name) VALUES (?,?,?,?,?,?)',[id,name,contact,nowDate(),req.session.user.id,req.session.user.name]);const [rows]=await pool.query('SELECT * FROM pics WHERE id=?',[id]);const r=rows[0];res.status(201).json({ok:true,pic:{id:r.id,name:r.name,contact:r.contact,createdAt:toIso(r.created_at),createdBy:{userId:r.created_by_user_id,name:r.created_by_name}}});}catch(err){next(err)}
});
app.patch('/api/admin/pics/:id',adminOnly,async(req,res,next)=>{
  try{const [rows]=await pool.query('SELECT * FROM pics WHERE id=? LIMIT 1',[req.params.id]);if(!rows[0])return res.status(404).json({error:'PIC non-admin tidak ditemukan.'});const name=String(req.body.name||rows[0].name||'').trim(),contact=String(req.body.contact||rows[0].contact||'').trim();if(!name||!contact)return res.status(400).json({error:'Nama dan kontak PIC wajib diisi.'});await pool.query('UPDATE pics SET name=?,contact=?,updated_at=?,updated_by_user_id=?,updated_by_name=? WHERE id=?',[name,contact,nowDate(),req.session.user.id,req.session.user.name,req.params.id]);res.json({ok:true,pic:{id:req.params.id,name,contact}});}catch(err){next(err)}
});
app.delete('/api/admin/pics/:id',adminOnly,async(req,res,next)=>{
  try{const [rows]=await pool.query('SELECT * FROM pics WHERE id=? LIMIT 1',[req.params.id]);if(!rows[0])return res.status(404).json({error:'PIC non-admin tidak ditemukan.'});await pool.query('DELETE FROM pics WHERE id=?',[req.params.id]);res.json({ok:true,pic:{id:rows[0].id,name:rows[0].name,contact:rows[0].contact}});}catch(err){next(err)}
});

// ---------------- TICKETS ----------------
app.post('/api/guest/tickets',guestLimiter,upload.array('evidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  let saved=[];
  try{
    const name=String(req.body.name||'').trim(),title=String(req.body.title||'').trim(),description=String(req.body.description||'').trim();
    if(!name||!title||!description)return res.status(400).json({error:'Nama, judul, dan detail permintaan wajib diisi.'});
    const email=normalizeEmail(req.body.email||'');if(email&&!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Format email guest tidak valid.'});
    saved=await saveUploadedFiles(req.files,'tickets');
    const department=String(req.body.department||'').trim()||'Guest / Tidak ditentukan';
    const ticketId=await withTransaction(async conn=>{
      const id=await nextTicketId(conn),at=nowDate();
      await conn.query(`INSERT INTO tickets (id,title,category,priority,description,location,asset,impact,requester_user_id,requester_name,requester_email,requester_phone,requester_department,requester_guest,created_by_user_id,created_by_key,created_by_name,created_by_role,created_by_department,status,estimated_processing,estimated_completion,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        id,title,String(req.body.category||'Other').trim(),'Unassigned',description,String(req.body.location||'').trim(),'','',null,name,email,String(req.body.phone||'').trim(),department,1,null,'creator:guest',name,'guest',department,'Open','TBA','TBA',at,at
      ]);
      await insertEvidenceRows(conn,id,'initial',saved);
      await insertTimeline(conn,id,'created',name,`Ticket guest dibuat oleh ${name}. Priority menunggu triage IT.`,null,at);
      return id;
    });
    const ticket=await getTicketById(ticketId);const jobs=[notifyAdminsNewTicket(ticket)];if(email)jobs.push(notifyRequester(ticket,'Ticket Guest Berhasil Dibuat','Permintaan Anda sudah diterima oleh IT. Priority dan estimasi akan ditentukan setelah proses triage.'));await Promise.allSettled(jobs);
    res.json({ok:true,ticket:{id:ticket.id,title:ticket.title,status:ticket.status,priority:ticket.priority,estimatedProcessing:ticket.estimatedProcessing,estimatedCompletion:ticket.estimatedCompletion}});
  }catch(err){removeSavedFiles(saved,'tickets');next(err)}
});

app.post('/api/tickets',auth,upload.array('evidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  let saved=[];
  try{
    const me=await findSessionUser(req);if(!me)return res.status(401).json({error:'Session tidak valid.'});
    const title=String(req.body.title||'').trim(),description=String(req.body.description||'').trim();if(!title||!description)return res.status(400).json({error:'Judul dan deskripsi wajib diisi.'});
    const priority=['Critical','High','Medium','Low'].includes(req.body.priority)?req.body.priority:'Medium',defaults=priorityDefaults[priority];
    let requester={userId:me.id,name:me.name,email:me.email,phone:me.phone,department:me.department};
    if(isAdminRole(me.role)){
      if(req.body.requesterUserId==='__self__')requester={userId:me.id,name:me.name,email:me.email,phone:me.phone,department:me.department};
      else if(req.body.requesterUserId){const target=await getUserById(req.body.requesterUserId);if(!target||target.role!=='user'||target.status!=='active')return res.status(400).json({error:'Requester terdaftar tidak ditemukan atau tidak aktif.'});requester={userId:target.id,name:target.name,email:target.email,phone:target.phone,department:target.department};}
      else{const manualName=String(req.body.manualName||'').trim();if(!manualName)return res.status(400).json({error:'Nama requester walk-in wajib diisi, atau pilih user terdaftar.'});requester={userId:null,name:manualName,email:normalizeEmail(req.body.manualEmail||''),phone:String(req.body.manualPhone||'').trim(),department:String(req.body.manualDepartment||'').trim()||'Walk-in / Tidak ditentukan'};}
    }
    let initialPic=null;if(isAdminRole(me.role)&&req.body.assignedPicKey){initialPic=await resolvePicSelection(req.body.assignedPicKey);if(!initialPic)return res.status(400).json({error:'PIC awal yang dipilih tidak ditemukan atau sudah tidak aktif.'});}
    saved=await saveUploadedFiles(req.files,'tickets');
    const ticketId=await withTransaction(async conn=>{
      const id=await nextTicketId(conn),at=nowDate();
      await conn.query(`INSERT INTO tickets (id,title,category,priority,description,location,asset,impact,requester_user_id,requester_name,requester_email,requester_phone,requester_department,requester_guest,created_by_user_id,created_by_key,created_by_name,created_by_role,created_by_department,status,estimated_processing,estimated_completion,assigned_pic_key,assigned_pic_type,assigned_admin_user_id,assigned_external_pic_id,assigned_pic_name,assigned_pic_contact,assigned_pic_email,assigned_pic_department,assigned_pic_label,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        id,title,String(req.body.category||'Other').trim(),priority,description,String(req.body.location||'').trim(),String(req.body.asset||'').trim(),String(req.body.impact||'').trim(),requester.userId||null,requester.name,requester.email||'',requester.phone||'',requester.department||'',0,me.id,`creator:${me.id}`,me.name,me.role,me.department||'','Open',String(req.body.estimatedProcessing||defaults.processing).trim(),String(req.body.estimatedCompletion||defaults.completion).trim()||'TBA',
        initialPic?.key||null,initialPic?.type||null,initialPic?.type==='admin'?initialPic.userId:null,initialPic?.type==='external'?initialPic.picId:null,initialPic?.name||null,initialPic?.contact||null,initialPic?.email||null,initialPic?.department||null,initialPic?.label||null,at,at
      ]);
      await insertEvidenceRows(conn,id,'initial',saved);await insertTimeline(conn,id,'created',me.name,`Ticket dibuat oleh ${me.name} (${me.role}).`,me.id,at);if(initialPic)await insertTimeline(conn,id,'assigned',me.name,`PIC awal ditetapkan ke ${initialPic.name}.`,me.id,at);return id;
    });
    const ticket=await getTicketById(ticketId);const jobs=[notifyRequester(ticket,'Ticket Berhasil Dibuat','Ticket Anda berhasil dibuat dan sudah masuk ke antrean IT.'),notifyAdminsNewTicket(ticket)];if(initialPic)jobs.push(notifyPicAssignment(ticket,initialPic));await Promise.allSettled(jobs);res.json({ok:true,ticket});
  }catch(err){removeSavedFiles(saved,'tickets');next(err)}
});

app.get('/api/tickets',auth,async(req,res,next)=>{try{const me=await findSessionUser(req);if(!me)return res.status(401).json({error:'Session tidak valid.'});res.json({tickets:await queryTickets(req,me)});}catch(err){next(err)}});

app.get('/api/admin/report-options',adminOnly,async(req,res,next)=>{
  try{
    const currentPics=await combinedPicDirectory();
    const [historicPicRows]=await pool.query("SELECT DISTINCT assigned_pic_key AS `key`,assigned_pic_name AS name,assigned_pic_contact AS contact,assigned_pic_type AS type FROM tickets WHERE assigned_pic_key IS NOT NULL AND assigned_pic_name IS NOT NULL");
    const map=new Map();for(const p of [...currentPics.map(x=>({key:x.key,name:x.name,contact:x.contact||x.email||'',type:x.type})),...historicPicRows])if(p.key&&!map.has(p.key))map.set(p.key,p);
    const pics=[...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name),'id'));
    const [solverRows]=await pool.query("SELECT DISTINCT resolved_by_key AS `key`,resolved_by_name AS name FROM tickets WHERE resolved_by_key IS NOT NULL AND resolved_by_name IS NOT NULL ORDER BY name ASC");
    const [creatorRows]=await pool.query("SELECT DISTINCT created_by_key AS `key`,created_by_name AS name,created_by_role AS role FROM tickets WHERE created_by_key IS NOT NULL ORDER BY name ASC");
    res.json({pics,solvers:solverRows,creators:creatorRows});
  }catch(err){next(err)}
});

app.get('/api/tickets/:id',auth,async(req,res,next)=>{
  try{const me=await findSessionUser(req),t=await getTicketById(req.params.id);if(!t)return res.status(404).json({error:'Ticket tidak ditemukan.'});if(me.role==='user'&&t.requester?.userId!==me.id)return res.status(403).json({error:'Tidak memiliki akses ke ticket ini.'});res.json({ticket:t});}catch(err){next(err)}
});

app.patch('/api/admin/tickets/:id',adminOnly,async(req,res,next)=>{
  try{
    const t=await getTicketById(req.params.id);if(!t)return res.status(404).json({error:'Ticket tidak ditemukan.'});
    const before={status:t.status,priority:t.priority,estimatedProcessing:t.estimatedProcessing,estimatedCompletion:t.estimatedCompletion,assignedTo:t.assignedTo};const previousPicKey=picKey(t.assignedTo);
    let priority=t.priority,status=t.status,processing=t.estimatedProcessing,completion=t.estimatedCompletion,assigned=t.assignedTo,assignedChanged=false;
    if(req.body.priority!==undefined&&['Unassigned','Critical','High','Medium','Low'].includes(String(req.body.priority)))priority=String(req.body.priority);
    if(req.body.estimatedProcessing!==undefined)processing=String(req.body.estimatedProcessing).trim()||priorityDefaults[priority]?.processing||'TBA';
    if(req.body.estimatedCompletion!==undefined)completion=String(req.body.estimatedCompletion).trim()||priorityDefaults[priority]?.completion||'TBA';
    if(req.body.applyPriorityDefaults===true||req.body.applyPriorityDefaults==='true'){const d=priorityDefaults[priority];processing=d?.processing||'TBA';completion=d?.completion||'TBA';}
    if(req.body.status!==undefined&&['Open','In Progress','Waiting User','Reopened','Resolved - Awaiting Confirmation','Finished'].includes(String(req.body.status)))status=String(req.body.status);
    if(req.body.assignedPicKey!==undefined||req.body.assignedToUserId!==undefined){const requestedKey=req.body.assignedPicKey!==undefined?String(req.body.assignedPicKey||''):(req.body.assignedToUserId?`admin:${req.body.assignedToUserId}`:'');assigned=requestedKey?await resolvePicSelection(requestedKey):null;if(requestedKey&&!assigned)return res.status(400).json({error:'PIC yang dipilih tidak ditemukan atau sudah tidak aktif.'});assignedChanged=true;}
    const changes=[];if(before.status!==status)changes.push(`status ${before.status} → ${status}`);if(before.priority!==priority)changes.push(`priority ${before.priority} → ${priority}`);if(before.estimatedProcessing!==processing)changes.push(`estimasi proses → ${processing||'TBA'}`);if(before.estimatedCompletion!==completion)changes.push(`estimasi completion → ${completion||'TBA'}`);if(picKey(before.assignedTo)!==picKey(assigned))changes.push(`PIC → ${assigned?.name||'belum ditentukan'}`);
    await withTransaction(async conn=>{
      await conn.query(`UPDATE tickets SET priority=?,status=?,estimated_processing=?,estimated_completion=?,assigned_pic_key=?,assigned_pic_type=?,assigned_admin_user_id=?,assigned_external_pic_id=?,assigned_pic_name=?,assigned_pic_contact=?,assigned_pic_email=?,assigned_pic_department=?,assigned_pic_label=?,assigned_pic_account_deleted=0,updated_at=? WHERE id=?`,[
        priority,status,processing,completion,assigned?.key||null,assigned?.type||null,assigned?.type==='admin'?assigned.userId:null,assigned?.type==='external'?assigned.picId:null,assigned?.name||null,assigned?.contact||null,assigned?.email||null,assigned?.department||null,assigned?.label||null,nowDate(),t.id
      ]);
      if(changes.length)await insertTimeline(conn,t.id,'updated',req.session.user.name,changes.join(', '),req.session.user.id);
    });
    const updated=await getTicketById(t.id);const jobs=[];if(changes.length)jobs.push(notifyRequester(updated,'Update Ticket',`Ada pembaruan pada ticket Anda: <strong>${escapeHtml(changes.join(', '))}</strong>.`));if(updated.assignedTo&&picKey(updated.assignedTo)!==previousPicKey)jobs.push(notifyPicAssignment(updated,updated.assignedTo));await Promise.allSettled(jobs);res.json({ok:true,ticket:updated});
  }catch(err){next(err)}
});

app.post('/api/admin/tickets/:id/resolve',adminOnly,upload.array('resolutionEvidence',MAX_UPLOAD_FILES),async(req,res,next)=>{
  let saved=[];
  try{
    const t=await getTicketById(req.params.id);if(!t)return res.status(404).json({error:'Ticket tidak ditemukan.'});const me=await findSessionUser(req);if(!me)return res.status(401).json({error:'Session tidak valid.'});
    const [countRows]=await pool.query("SELECT COUNT(*) AS c FROM ticket_evidence WHERE ticket_id=? AND kind='resolution'",[t.id]);if(Number(countRows[0].c)+(req.files||[]).length>MAX_UPLOAD_FILES)return res.status(400).json({error:`Total evidence penyelesaian maksimal ${MAX_UPLOAD_FILES} file.`});
    saved=await saveUploadedFiles(req.files,'resolutions');const resolutionNote=String(req.body.resolutionNote||'').trim();let assigned=t.assignedTo;
    await withTransaction(async conn=>{
      if(!assigned){assigned={key:`admin:${me.id}`,type:'admin',userId:me.id,name:me.name,contact:me.phone&&me.phone!=='-'?me.phone:(me.email||'-'),email:me.email||'',department:me.department||'',label:me.label||roleLabelForServer(me.role)};await conn.query(`UPDATE tickets SET assigned_pic_key=?,assigned_pic_type='admin',assigned_admin_user_id=?,assigned_external_pic_id=NULL,assigned_pic_name=?,assigned_pic_contact=?,assigned_pic_email=?,assigned_pic_department=?,assigned_pic_label=?,assigned_pic_account_deleted=0 WHERE id=?`,[assigned.key,me.id,assigned.name,assigned.contact,assigned.email,assigned.department,assigned.label,t.id]);await insertTimeline(conn,t.id,'assigned',me.name,`PIC otomatis ditetapkan ke ${me.name} karena ticket diselesaikan dalam kondisi belum memiliki PIC.`,me.id);}
      await insertEvidenceRows(conn,t.id,'resolution',saved);
      const newStatus=t.requester?.userId?'Resolved - Awaiting Confirmation':'Finished';
      await conn.query(`UPDATE tickets SET resolution_note=?,resolved_by_user_id=?,resolved_by_key=?,resolved_by_name=?,resolved_by_department=?,resolved_by_label=?,resolved_at=?,updated_at=?,status=? WHERE id=?`,[resolutionNote,me.id,`admin:${me.id}`,me.name,me.department||'',me.label||roleLabelForServer(me.role),nowDate(),nowDate(),newStatus,t.id]);
      await insertTimeline(conn,t.id,'resolved',me.name,resolutionNote||'Pekerjaan ditandai selesai oleh admin.',me.id);
    });
    const updated=await getTicketById(t.id);await notifyRequester(updated,'Pekerjaan Selesai · Mohon Konfirmasi','Tim IT telah menyelesaikan pekerjaan pada ticket ini.',resolutionNote?`<p><strong>Catatan penyelesaian:</strong><br>${escapeHtml(resolutionNote)}</p>`:'');res.json({ok:true,ticket:updated});
  }catch(err){removeSavedFiles(saved,'resolutions');next(err)}
});

// ROOT ONLY - PERMANENT DELETE TICKET
app.delete('/api/root/tickets/:id', rootOnly, async (req, res, next) => {
  try {
    const ticketId = String(req.params.id || '').trim();
    const confirmation = String(req.body?.confirmTicketId || '').trim();

    const ticket = await getTicketById(ticketId, { includeTimeline: false });

    if (!ticket) {
      return res.status(404).json({
        error: 'Ticket tidak ditemukan.'
      });
    }

    // Root wajib mengetik Ticket ID yang sama persis.
    if (confirmation !== ticketId) {
      return res.status(400).json({
        error: `Ketik ${ticketId} untuk mengonfirmasi penghapusan permanen.`
      });
    }

    // Ambil file evidence sebelum metadata-nya ikut terhapus oleh CASCADE.
    const [evidenceRows] = await pool.query(
      'SELECT kind, filename FROM ticket_evidence WHERE ticket_id=?',
      [ticketId]
    );

    // ticket_evidence dan ticket_timeline otomatis terhapus
    // karena foreign key ON DELETE CASCADE.
    await withTransaction(async conn => {
      const [result] = await conn.query(
        'DELETE FROM tickets WHERE id=?',
        [ticketId]
      );

      if (!result.affectedRows) {
        throw new Error('Ticket gagal dihapus.');
      }
    });

    // Hapus file evidence fisik setelah DB berhasil dihapus.
    let deletedFiles = 0;
    let failedFiles = 0;

    for (const file of evidenceRows) {
      const folder =
        file.kind === 'resolution'
          ? RESOLUTION_UPLOAD_DIR
          : TICKET_UPLOAD_DIR;

      // basename mencegah path traversal.
      const filename = path.basename(String(file.filename || ''));

      if (!filename) continue;

      const fullPath = path.join(folder, filename);

      try {
        fs.unlinkSync(fullPath);
        deletedFiles++;
      } catch (err) {
        // File sudah tidak ada bukan masalah fatal.
        if (err.code !== 'ENOENT') {
          failedFiles++;

          console.warn(
            `[DELETE TICKET] Gagal menghapus evidence ${filename}:`,
            err.message
          );
        }
      }
    }

    console.warn(
      `[ROOT DELETE] ${req.session.user.name} (${req.session.user.id}) ` +
      `menghapus ticket ${ticketId}. Evidence deleted=${deletedFiles}, failed=${failedFiles}`
    );

    res.json({
      ok: true,
      deletedTicketId: ticketId,
      deletedFiles,
      failedFiles
    });
  } catch (err) {
    next(err);
  }
});

app.post('/api/tickets/:id/confirm',auth,async(req,res,next)=>{
  try{const me=await findSessionUser(req);if(me.role!=='user')return res.status(403).json({error:'Konfirmasi hanya untuk user pemilik ticket.'});const t=await getTicketById(req.params.id);if(!t||t.requester?.userId!==me.id)return res.status(404).json({error:'Ticket tidak ditemukan.'});if(t.status!=='Resolved - Awaiting Confirmation')return res.status(400).json({error:'Ticket belum menunggu konfirmasi.'});const note=String(req.body.note||'').trim();await withTransaction(async conn=>{await conn.query("UPDATE tickets SET status='Finished',user_confirmation_state='confirmed',user_confirmation_at=?,user_confirmation_by=?,user_confirmation_note=?,updated_at=? WHERE id=?",[nowDate(),me.name,note,nowDate(),t.id]);await insertTimeline(conn,t.id,'confirmed',me.name,'User mengonfirmasi pekerjaan sudah selesai.',me.id);});const updated=await getTicketById(t.id);await notifyTicketTeam(updated,'Ticket Dikonfirmasi Selesai',`User <strong>${escapeHtml(me.name)}</strong> mengonfirmasi bahwa pekerjaan sudah selesai.`);res.json({ok:true,ticket:updated});}catch(err){next(err)}
});
app.post('/api/tickets/:id/reopen',auth,async(req,res,next)=>{
  try{const me=await findSessionUser(req);if(me.role!=='user')return res.status(403).json({error:'Hanya user pemilik ticket yang dapat meminta reopen.'});const t=await getTicketById(req.params.id);if(!t||t.requester?.userId!==me.id)return res.status(404).json({error:'Ticket tidak ditemukan.'});if(t.status!=='Resolved - Awaiting Confirmation')return res.status(400).json({error:'Ticket tidak berada pada tahap konfirmasi.'});const note=String(req.body.note||'').trim();await withTransaction(async conn=>{await conn.query("UPDATE tickets SET status='Reopened',user_confirmation_state='reopened',user_confirmation_at=?,user_confirmation_by=?,user_confirmation_note=?,updated_at=? WHERE id=?",[nowDate(),me.name,note,nowDate(),t.id]);await insertTimeline(conn,t.id,'reopened',me.name,`User meminta perbaikan lanjutan.${note?' '+note:''}`,me.id);});const updated=await getTicketById(t.id);await notifyTicketTeam(updated,'Ticket Dibuka Kembali',`User <strong>${escapeHtml(me.name)}</strong> menyatakan pekerjaan masih memerlukan tindak lanjut.${note?`<p><strong>Catatan:</strong> ${escapeHtml(note)}</p>`:''}`);res.json({ok:true,ticket:updated});}catch(err){next(err)}
});

app.get('/api/dashboard',auth,async(req,res,next)=>{
  try{
    const me=await findSessionUser(req);const f=buildTicketFilter({query:{}},me);const [rows]=await pool.query(`SELECT status,priority,id FROM tickets t ${f.whereSql}`,f.params);const ids=rows.map(r=>r.id);const stats={total:rows.length,open:0,inProgress:0,waiting:0,resolved:0,finished:0,critical:0,evidenceFiles:0,originalBytes:0,storedBytes:0,savedBytes:0};for(const t of rows){if(t.status==='Open')stats.open++;if(t.status==='In Progress'||t.status==='Reopened')stats.inProgress++;if(t.status==='Waiting User')stats.waiting++;if(t.status==='Resolved - Awaiting Confirmation')stats.resolved++;if(t.status==='Finished')stats.finished++;if(t.priority==='Critical')stats.critical++;}
    if(ids.length){const placeholders=ids.map(()=>'?').join(',');const [er]=await pool.query(`SELECT COUNT(*) AS files,COALESCE(SUM(original_size_bytes),0) AS originalBytes,COALESCE(SUM(size_bytes),0) AS storedBytes,COALESCE(SUM(saved_bytes),0) AS savedBytes FROM ticket_evidence WHERE ticket_id IN (${placeholders})`,ids);stats.evidenceFiles=Number(er[0].files||0);stats.originalBytes=Number(er[0].originalBytes||0);stats.storedBytes=Number(er[0].storedBytes||0);stats.savedBytes=Number(er[0].savedBytes||0);}
    res.json({stats});
  }catch(err){next(err)}
});

app.get('/api/system/status',rootOnly,async(req,res,next)=>{try{const [rows]=await pool.query('SELECT COUNT(*) AS c FROM pics');res.json({database:'mysql',smtpConfigured,internalDomain:INTERNAL_DOMAIN,maxUploadFiles:MAX_UPLOAD_FILES,maxUploadMB:MAX_UPLOAD_MB,picDirectoryCount:Number(rows[0].c||0),imageCompression:{format:'webp',quality:IMAGE_WEBP_QUALITY,maxWidth:IMAGE_MAX_WIDTH,maxHeight:IMAGE_MAX_HEIGHT}});}catch(err){next(err)}});

app.get('/api/tickets-export.xlsx',auth,async(req,res,next)=>{
  try{
    const me=await findSessionUser(req),list=await queryTickets(req,me);
    const wb=new ExcelJS.Workbook();wb.creator=APP_NAME;wb.created=new Date();
    const summary=wb.addWorksheet('Ringkasan');summary.columns=[{header:'Item',key:'item',width:34},{header:'Nilai',key:'value',width:42}];
    const period=[req.query.dateFrom&&`Dari ${req.query.dateFrom}`,req.query.dateTo&&`Sampai ${req.query.dateTo}`].filter(Boolean).join(' · ')||({daily:'Hari Ini',weekly:'7 Hari Terakhir',all:'Keseluruhan'}[req.query.timeframe||'all']||'Keseluruhan');
    const labelForKey=(key,fn)=>{if(!key||key==='All')return 'All';const found=list.find(fn);return found?fn(found,true):key;};
    summary.addRows([
      {item:'Periode',value:period},{item:'Total Ticket',value:list.length},{item:'Kategori',value:req.query.category||'All'},{item:'Priority',value:req.query.priority||'All'},{item:'Status',value:req.query.status||'All'},
      {item:'PIC',value:req.query.pic&&req.query.pic!=='All'?(list.find(t=>picKey(t.assignedTo)===req.query.pic)?.assignedTo?.name||req.query.pic):'All'},
      {item:'Solver',value:req.query.solver&&req.query.solver!=='All'?(list.find(t=>t.resolvedBy?.key===req.query.solver)?.resolvedBy?.name||req.query.solver):'All'},
      {item:'Created By',value:req.query.creator&&req.query.creator!=='All'?(list.find(t=>t.createdBy?.key===req.query.creator)?.createdBy?.name||req.query.creator):'All'},
      {item:'Search',value:req.query.q||'-'}
    ]);
    summary.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};summary.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123E7C'}};summary.views=[{state:'frozen',ySplit:1}];
    const by=(fn)=>{const m=new Map();for(const t of list){const k=fn(t)||'Belum ditentukan';m.set(k,(m.get(k)||0)+1);}return [...m.entries()].sort((a,b)=>b[1]-a[1]);};
    let row=summary.rowCount+3;summary.getCell(`A${row}`).value='Pembagian berdasarkan PIC';summary.getCell(`A${row}`).font={bold:true};row++;for(const [name,count] of by(t=>t.assignedTo?.name)){summary.getCell(`A${row}`).value=name;summary.getCell(`B${row}`).value=count;row++;}
    row+=2;summary.getCell(`A${row}`).value='Pembagian berdasarkan Created By';summary.getCell(`A${row}`).font={bold:true};row++;for(const [name,count] of by(t=>t.createdBy?.name)){summary.getCell(`A${row}`).value=name;summary.getCell(`B${row}`).value=count;row++;}
    row+=2;summary.getCell(`A${row}`).value='Pembagian berdasarkan Solver';summary.getCell(`A${row}`).font={bold:true};row++;for(const [name,count] of by(t=>t.resolvedBy?.name)){summary.getCell(`A${row}`).value=name;summary.getCell(`B${row}`).value=count;row++;}
    const ws=wb.addWorksheet('Tickets');ws.columns=[
      {header:'Ticket ID',key:'id',width:22},{header:'Created At',key:'createdAt',width:21},{header:'Updated At',key:'updatedAt',width:21},{header:'Requester',key:'requester',width:24},{header:'Bagian',key:'department',width:24},{header:'Email',key:'email',width:30},{header:'Phone',key:'phone',width:18},{header:'Created By',key:'createdBy',width:24},{header:'Creator Role',key:'creatorRole',width:15},{header:'Category',key:'category',width:22},{header:'Priority',key:'priority',width:12},{header:'Status',key:'status',width:30},{header:'Title',key:'title',width:36},{header:'Description',key:'description',width:52},{header:'Processing Est.',key:'processing',width:22},{header:'Completion Est.',key:'completion',width:24},{header:'PIC',key:'pic',width:24},{header:'PIC Type',key:'picType',width:16},{header:'PIC Contact',key:'picContact',width:25},{header:'Solver',key:'solver',width:24},{header:'Resolved At',key:'resolvedAt',width:21},{header:'Resolution Note',key:'resolutionNote',width:52},{header:'Initial Evidence',key:'evidenceCount',width:16},{header:'Resolution Evidence',key:'resolutionCount',width:18}
    ];
    for(const t of list)ws.addRow({id:t.id,createdAt:formatDateId(t.createdAt),updatedAt:formatDateId(t.updatedAt),requester:t.requester?.name||'',department:t.requester?.department||'',email:t.requester?.email||'',phone:t.requester?.phone||'',createdBy:t.createdBy?.name||'',creatorRole:t.createdBy?.role||'',category:t.category,priority:t.priority,status:t.status,title:t.title,description:t.description,processing:t.estimatedProcessing,completion:t.estimatedCompletion||'TBA',pic:t.assignedTo?.name||'',picType:t.assignedTo?.type==='external'?'PIC Non-Admin':(t.assignedTo?'Admin':'Belum ditentukan'),picContact:t.assignedTo?.contact||t.assignedTo?.email||'',solver:t.resolvedBy?.name||'',resolvedAt:formatDateId(t.resolvedAt),resolutionNote:t.resolutionNote||'',evidenceCount:(t.evidence||[]).length,resolutionCount:(t.resolutionEvidence||[]).length});
    ws.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};ws.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF123E7C'}};ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:`X${Math.max(1,ws.rowCount)}`};ws.eachRow((r,idx)=>{if(idx>1)r.alignment={vertical:'top',wrapText:true};});
    const safeFrom=String(req.query.dateFrom||'').replace(/[^0-9-]/g,''),safeTo=String(req.query.dateTo||'').replace(/[^0-9-]/g,'');const suffix=safeFrom||safeTo?`${safeFrom||'awal'}_sd_${safeTo||'akhir'}`:(req.query.timeframe||'all');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.setHeader('Content-Disposition',`attachment; filename=ARU_IT_Ticketing_${suffix}.xlsx`);await wb.xlsx.write(res);res.end();
  }catch(err){next(err)}
});

app.use((err,req,res,next)=>{
  console.error(err);
  if(err instanceof multer.MulterError){const msg=err.code==='LIMIT_FILE_SIZE'?`Maksimum ${MAX_UPLOAD_MB} MB per file.`:err.code==='LIMIT_FILE_COUNT'?`Maksimum ${MAX_UPLOAD_FILES} file per upload.`:err.message;return res.status(400).json({error:msg});}
  if(err?.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Data duplikat. Username, email, atau data unik tersebut sudah digunakan.'});
  res.status(err.status||400).json({error:err.message||'Terjadi kesalahan.'});
});
app.get('*',(req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));

async function bootstrap(){
  try{
    await assertDatabaseReady();
    await seedRoot();
    if(mailer){mailer.verify().then(()=>console.log(`SMTP ready: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT||587}`)).catch(err=>console.warn('SMTP verification warning:',err.message));}
    else console.warn('SMTP is not configured. Email verification and password reset will not work until .env is configured.');
    app.listen(PORT,()=>console.log(`${APP_NAME} V5 MySQL running at http://localhost:${PORT}`));
  }catch(err){
    console.error('\nGagal memulai ARU IT Ticketing V5 MySQL.');
    console.error(err.message);
    console.error('\nChecklist: 1) MySQL aktif, 2) import database/aru_ticketing_mysql.sql, 3) isi DB_USER dan DB_PASSWORD di .env.\n');
    process.exit(1);
  }
}
bootstrap();
