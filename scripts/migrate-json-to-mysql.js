require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, withTransaction, assertDatabaseReady, close } = require('../db');

const PROJECT = path.join(__dirname,'..');
const explicitLegacy = process.env.LEGACY_DATA_DIR ? path.resolve(process.env.LEGACY_DATA_DIR) : null;
const legacyDir = path.join(PROJECT,'legacy-data');
const oldDataDir = path.join(PROJECT,'data');
const hasJson = dir => ['users.json','tickets.json','pics.json','email_tokens.json'].some(n=>fs.existsSync(path.join(dir,n)));
const LEGACY = explicitLegacy || (hasJson(legacyDir) ? legacyDir : oldDataDir);
function read(name){const p=path.join(LEGACY,name);if(!fs.existsSync(p))return [];try{return JSON.parse(fs.readFileSync(p,'utf8')||'[]');}catch(e){throw new Error(`Gagal membaca ${p}: ${e.message}`);}}
function dt(v){return v?new Date(v):null;}
function b(v){return v?1:0;}
function creatorKey(t){return t?.createdBy?.userId?`creator:${t.createdBy.userId}`:'creator:guest';}
function pkey(p){if(!p)return null;if(p.key)return p.key;if(p.type==='external'&&p.picId)return `external:${p.picId}`;if(p.userId)return `admin:${p.userId}`;return p.name?`name:${String(p.name).trim().toLowerCase()}`:null;}

(async()=>{
  try{
    await assertDatabaseReady();
    const users=read('users.json'),pics=read('pics.json'),tickets=read('tickets.json'),tokens=read('email_tokens.json');
    console.log(`Legacy dir: ${LEGACY}`);
    console.log(`Users=${users.length}, PICs=${pics.length}, Tickets=${tickets.length}, Tokens=${tokens.length}`);

    for(const u of users){
      if(!u?.id||!u?.username||!u?.email||!u?.passwordHash)continue;
      await pool.query(`INSERT IGNORE INTO users (id,username,name,email,phone,department,label,role,status,email_verified,email_verified_at,password_hash,registration_method,created_at,approved_at,approved_by,created_by_root,updated_at,updated_by,rejection_reason,rejected_at,rejected_by,password_changed_at,password_changed_by,email_changed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
        u.id,u.username,u.name||u.username,String(u.email).toLowerCase(),u.phone||'-',u.department||'-',u.label||'User',u.role||'user',u.status||'active',b(u.emailVerified),dt(u.emailVerifiedAt),u.passwordHash,u.registrationMethod||null,dt(u.createdAt)||new Date(),dt(u.approvedAt),u.approvedBy||null,u.createdByRoot||null,dt(u.updatedAt),u.updatedBy||null,u.rejectionReason||null,dt(u.rejectedAt),u.rejectedBy||null,dt(u.passwordChangedAt),u.passwordChangedBy||null,u.emailChangedBy||null
      ]);
    }
    const [dbUserRows]=await pool.query('SELECT id FROM users');
    const userIds=new Set(dbUserRows.map(r=>r.id));
    for(const p of pics){
      if(!p?.id||!p?.name||!p?.contact)continue;
      await pool.query(`INSERT IGNORE INTO pics (id,name,contact,created_at,created_by_user_id,created_by_name,updated_at,updated_by_user_id,updated_by_name) VALUES (?,?,?,?,?,?,?,?,?)`,[
        p.id,p.name,p.contact,dt(p.createdAt)||new Date(),userIds.has(p.createdBy?.userId)?p.createdBy.userId:null,p.createdBy?.name||null,dt(p.updatedAt),userIds.has(p.updatedBy?.userId)?p.updatedBy.userId:null,p.updatedBy?.name||null
      ]);
    }
    const [dbPicRows]=await pool.query('SELECT id FROM pics');
    const picIds=new Set(dbPicRows.map(r=>r.id));
    for(const token of tokens){
      if(!token?.id||!token?.userId||!token?.codeHash||!userIds.has(token.userId))continue;
      await pool.query(`INSERT IGNORE INTO email_tokens (id,user_id,email,purpose,code_hash,attempts,max_attempts,created_at,expires_at,consumed_at,invalidated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[
        token.id,token.userId,token.email||'',token.purpose||'password_reset',token.codeHash,Number(token.attempts||0),Number(token.maxAttempts||5),dt(token.createdAt)||new Date(),dt(token.expiresAt)||new Date(),dt(token.consumedAt),dt(token.invalidatedAt)
      ]).catch(()=>{});
    }

    let imported=0,skipped=0;
    for(const t of tickets){
      if(!t?.id){skipped++;continue;}
      const [exists]=await pool.query('SELECT id FROM tickets WHERE id=? LIMIT 1',[t.id]);if(exists.length){skipped++;continue;}
      await withTransaction(async conn=>{
        const ap=t.assignedTo||null,rb=t.resolvedBy||null,uc=t.userConfirmation||null;
        await conn.query(`INSERT INTO tickets (id,title,category,priority,description,location,asset,impact,requester_user_id,requester_name,requester_email,requester_phone,requester_department,requester_guest,requester_account_deleted,created_by_user_id,created_by_key,created_by_name,created_by_role,created_by_department,status,estimated_processing,estimated_completion,assigned_pic_key,assigned_pic_type,assigned_admin_user_id,assigned_external_pic_id,assigned_pic_name,assigned_pic_contact,assigned_pic_email,assigned_pic_department,assigned_pic_label,assigned_pic_account_deleted,resolved_by_user_id,resolved_by_key,resolved_by_name,resolved_by_department,resolved_by_label,resolved_at,resolution_note,user_confirmation_state,user_confirmation_at,user_confirmation_by,user_confirmation_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
          t.id,t.title||'-',t.category||'Other',t.priority||'Unassigned',t.description||'',t.location||'',t.asset||'',t.impact||'',userIds.has(t.requester?.userId)?t.requester.userId:null,t.requester?.name||'-',t.requester?.email||'',t.requester?.phone||'',t.requester?.department||'',b(t.requester?.guest),b(t.requester?.accountDeleted||Boolean(t.requester?.userId&&!userIds.has(t.requester.userId))),userIds.has(t.createdBy?.userId)?t.createdBy.userId:null,creatorKey(t),t.createdBy?.name||'-',t.createdBy?.role||'guest',t.createdBy?.department||'',t.status||'Open',t.estimatedProcessing||'TBA',t.estimatedCompletion||'TBA',pkey(ap),ap?.type||null,ap?.type==='admin'&&userIds.has(ap.userId)?ap.userId:null,ap?.type==='external'&&picIds.has(ap.picId)?ap.picId:null,ap?.name||null,ap?.contact||null,ap?.email||null,ap?.department||null,ap?.label||null,b(ap?.accountDeleted||(ap?.type==='admin'&&ap?.userId&&!userIds.has(ap.userId))),rb?.userId&&userIds.has(rb.userId)?rb.userId:null,rb?.userId?`admin:${rb.userId}`:(rb?.key||null),rb?.name||null,rb?.department||null,rb?.label||null,dt(t.resolvedAt),t.resolutionNote||'',uc?(uc.confirmed?'confirmed':'reopened'):null,dt(uc?.at),uc?.by||null,uc?.note||null,dt(t.createdAt)||new Date(),dt(t.updatedAt)||dt(t.createdAt)||new Date()
        ]);
        for(const [kind,arr] of [['initial',t.evidence||[]],['resolution',t.resolutionEvidence||[]]]){
          for(const f of arr){await conn.query(`INSERT INTO ticket_evidence (ticket_id,kind,name,filename,size_bytes,original_size_bytes,saved_bytes,mimetype,compressed,url,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,[t.id,kind,f.name||f.filename||'file',f.filename||path.basename(f.url||'file'),Number(f.size||0),Number(f.originalSize||f.size||0),Number(f.savedBytes||0),f.mimetype||'application/octet-stream',b(f.compressed),f.url||'',dt(f.uploadedAt)||dt(t.createdAt)||new Date()]);}
        }
        for(const x of t.timeline||[]){await conn.query('INSERT INTO ticket_timeline (ticket_id,at,type,by_user_id,by_name,note) VALUES (?,?,?,?,?,?)',[t.id,dt(x.at)||dt(t.createdAt)||new Date(),x.type||'legacy',null,x.by||'Legacy',x.note||'']);}
      });
      const m=/^ARU-(\d{4})(\d{2})(\d{2})-(\d+)$/.exec(t.id);if(m){const date=`${m[1]}-${m[2]}-${m[3]}`,n=Number(m[4]);await pool.query('INSERT INTO ticket_sequences (seq_date,last_value) VALUES (?,?) ON DUPLICATE KEY UPDATE last_value=GREATEST(last_value,VALUES(last_value))',[date,n]);}
      imported++;
    }
    console.log(`Ticket imported=${imported}, skipped=${skipped}`);
    console.log('Migration selesai. Copy folder uploads lama ke project V5 jika evidence lama ingin tetap dapat dibuka.');
    await close();
  }catch(err){console.error('Migration gagal:',err);try{await close();}catch(_){}process.exit(1);}
})();
