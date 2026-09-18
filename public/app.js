const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let ME = null;
let DIRECTORY = [];
let PIC_DIRECTORY = [];
let currentPage = 'dashboard';
let createQueue = [];
let resolutionQueue = [];
let verifyIdentity = '';
let resetIdentity = '';
let guestQueue = [];

const CATEGORIES = ['Hardware','Software / Aplikasi','Network / Wi-Fi','Printer / Scanner','Email / Account','Server / System','Access / Permission','Website','Data / Report','Other'];
const STATUSES = ['Open','In Progress','Waiting User','Reopened','Resolved - Awaiting Confirmation','Finished'];
const PRIORITIES = ['Critical','High','Medium','Low'];
const ALL_PRIORITIES = ['Unassigned', ...PRIORITIES];
const DEFAULTS = {
  Critical:{processing:'1-2 jam',completion:'Hari ini / secepatnya'},
  High:{processing:'2-4 jam',completion:'1 hari kerja'},
  Medium:{processing:'1 hari kerja',completion:'2 hari kerja'},
  Low:{processing:'1-2 hari kerja',completion:'3-5 hari kerja'}
};

async function api(url, options = {}) {
  const isForm = options.body instanceof FormData;
  const res = await fetch(url, {
    credentials:'same-origin',
    ...options,
    headers:isForm ? (options.headers || {}) : {'Content-Type':'application/json', ...(options.headers || {})}
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await res.json() : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.data = data; err.status = res.status; throw err;
  }
  return data;
}
function esc(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
function fmtDate(v){if(!v)return '-';return new Intl.DateTimeFormat('id-ID',{dateStyle:'medium',timeStyle:'short'}).format(new Date(v));}
function fmtBytes(n=0){n=Number(n||0);if(n<1024)return `${n} B`;if(n<1048576)return `${(n/1024).toFixed(1)} KB`;return `${(n/1048576).toFixed(1)} MB`;}
function roleLabel(r){return r==='root_admin'?'Root Administrator':r==='admin'?'Administrator':r==='guest'?'Guest':'User';}
function statusLabel(s){return String(s||'').replaceAll('_',' ');}
function toast(msg,type='success'){const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>el.className='toast',3800);}
function badgeStatus(v=''){const c=v==='Finished'?'green':v.includes('Resolved')?'purple':v==='Open'?'blue':v==='Waiting User'?'orange':v==='Reopened'?'red':'gray';return `<span class="badge ${c}">${esc(v)}</span>`;}
function badgePriority(v=''){const c=v==='Critical'?'red':v==='High'?'orange':v==='Medium'?'blue':v==='Low'?'green':'gray';return `<span class="badge ${c}">${esc(v||'Unassigned')}</span>`;}
function badgeRole(v=''){const c=v==='root_admin'?'purple':v==='admin'?'blue':'gray';return `<span class="badge ${c}">${esc(roleLabel(v))}</span>`;}
function openModal(html,wide=false){$('#modalContent').innerHTML=html;$('#modalBox').classList.toggle('wide',wide);$('#modalBackdrop').classList.remove('hidden');document.body.classList.add('no-scroll');}
function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#modalContent').innerHTML='';$('#modalBox').classList.remove('wide');document.body.classList.remove('no-scroll');}
function isAdmin(){return ['admin','root_admin'].includes(ME?.role);}
function isRoot(){return ME?.role==='root_admin';}

$('#modalClose').onclick=closeModal;
$('#modalBackdrop').addEventListener('click',e=>{if(e.target.id==='modalBackdrop')closeModal();});

function switchAuthTab(tab){
  $$('.tab-btn').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));
  $$('.auth-pane').forEach(x=>x.classList.remove('active'));
  $(`#tab-${tab}`)?.classList.add('active');
}
$$('.tab-btn').forEach(b=>b.onclick=()=>switchAuthTab(b.dataset.tab));
$$('[data-switch-tab]').forEach(b=>b.onclick=()=>switchAuthTab(b.dataset.switchTab));

$('#loginForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    ME=d.user;showApp();
  }catch(err){
    if(err.data?.status==='pending_verification'&&err.data.identity){verifyIdentity=err.data.identity;$('#verifyIdentity').value=verifyIdentity;$('#verifyHint').textContent=`Email belum diverifikasi. Masukkan kode untuk ${verifyIdentity}.`;switchAuthTab('verify');}
    toast(err.message,'error');
  }
};
const registerEmailInput = $('#registerForm [name="email"]');
function syncRegisterMode(){
  const email=String(registerEmailInput?.value||'').trim().toLowerCase();
  const internal=email.endsWith('@aruraharja.co.id');
  $('#registerSubmitBtn').textContent=internal?'Kirim Kode Verifikasi':email?'Ajukan Registrasi':'Daftar Akun';
  $('#registerFlowHint').innerHTML=internal
    ? 'Email internal <b>@aruraharja.co.id</b> akan menerima OTP 6 digit. Setelah OTP benar, akun langsung aktif dan Anda langsung masuk ke dashboard.'
    : 'Email di luar <b>@aruraharja.co.id</b> tidak memerlukan OTP. Registrasi akan masuk ke antrean approval admin sebelum akun dapat digunakan.';
}
registerEmailInput?.addEventListener('input',syncRegisterMode);syncRegisterMode();

$('#registerForm').onsubmit=async e=>{
  e.preventDefault();
  try{
    const d=await api('/api/register',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
    if(d.needsVerification){
      verifyIdentity=d.identity;$('#verifyIdentity').value=verifyIdentity;$('#verifyHint').textContent=`Kode 6 digit sudah dikirim ke ${d.maskedEmail}. Setelah verifikasi Anda akan langsung masuk.`;switchAuthTab('verify');toast(d.message);
    }else{
      $('#pendingHint').textContent=d.message||'Registrasi sudah masuk ke antrean approval admin.';switchAuthTab('pending');toast('Registrasi berhasil diajukan.');
    }
  }catch(err){toast(err.message,'error');}
};
$('#verifyForm').onsubmit=async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));f.identity=verifyIdentity||f.identity;
  try{const d=await api('/api/register/verify',{method:'POST',body:JSON.stringify(f)});toast(d.message);if(d.user){ME=d.user;showApp();}else switchAuthTab('login');}catch(err){toast(err.message,'error');}
};
$('#resendVerifyBtn').onclick=async()=>{if(!verifyIdentity)return toast('Daftar atau masukkan akun terlebih dahulu.','error');try{const d=await api('/api/register/resend',{method:'POST',body:JSON.stringify({identity:verifyIdentity})});toast(d.message);}catch(err){toast(err.message,'error');}};
$('#forgotForm').onsubmit=async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));resetIdentity=f.identity;
  try{const d=await api('/api/forgot-password',{method:'POST',body:JSON.stringify(f)});$('#resetIdentity').value=resetIdentity;$('#resetBlock').classList.remove('hidden');toast(d.message);}catch(err){toast(err.message,'error');}
};
$('#resetForm').onsubmit=async e=>{
  e.preventDefault();const f=Object.fromEntries(new FormData(e.target));f.identity=resetIdentity||f.identity;
  try{const d=await api('/api/reset-password',{method:'POST',body:JSON.stringify(f)});toast(d.message);e.target.reset();$('#resetBlock').classList.add('hidden');switchAuthTab('login');}catch(err){toast(err.message,'error');}
};
$('#resendResetBtn').onclick=async()=>{if(!resetIdentity)return toast('Masukkan akun terlebih dahulu.','error');try{const d=await api('/api/forgot-password/resend',{method:'POST',body:JSON.stringify({identity:resetIdentity})});toast(d.message);}catch(err){toast(err.message,'error');}};

async function boot(){try{const d=await api('/api/me');ME=d.user;showApp();}catch{$('#authView').classList.remove('hidden');$('#appView').classList.add('hidden');}}
function showApp(){$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');renderNav();navigate('dashboard');}
function renderNav(){
  let items;
  if(ME.role==='user') items=[['dashboard','⌂','Dashboard'],['tickets','◫','Ticket Saya'],['new','＋','Buat Ticket'],['reports','▤','Export Ticket Saya']];
  else if(ME.role==='admin') items=[['dashboard','⌂','Dashboard'],['tickets','◫','Semua Ticket'],['new','＋','Buat Ticket'],['pics','♟','PIC Directory'],['approvals','✓','Approval User'],['reports','▤','Report & Excel']];
  else items=[['dashboard','⌂','Dashboard'],['tickets','◫','Semua Ticket'],['new','＋','Buat Ticket'],['pics','♟','PIC Directory'],['approvals','✓','Approval User'],['accounts','♙','Account Management'],['reports','▤','Report & Excel']];
  $('#navMenu').innerHTML=items.map(i=>`<button class="nav-btn" data-page="${i[0]}"><span class="nav-icon">${i[1]}</span><span>${i[2]}</span></button>`).join('');
  $$('#navMenu .nav-btn').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
  $('#sidebarUser').innerHTML=`<div class="avatar">${esc(ME.name.slice(0,1).toUpperCase())}</div><div><strong>${esc(ME.name)}</strong><span>${esc(roleLabel(ME.role))}</span><small>${esc(ME.department||'-')}</small></div>`;
}
const TITLES={
  dashboard:['Dashboard','Ringkasan aktivitas IT Service Desk.'],
  tickets:['Ticket Monitoring','Cari, filter, dan pantau progress pekerjaan.'],
  new:['Buat Ticket','Catat kendala baru dengan detail dan evidence.'],
  approvals:['Approval User','Registrasi eksternal yang membutuhkan persetujuan admin.'],
  accounts:['Account Management','CRUD user/admin khusus root administrator.'],
  pics:['PIC Directory','Admin aktif otomatis menjadi PIC; tambahkan PIC non-admin bila diperlukan.'],
  reports:['Report & Excel','Export data berdasarkan rentang tanggal, PIC, creator, solver, kategori, priority, dan status.']
};
async function navigate(page){
  if(page==='accounts'&&!isRoot())page='dashboard';
  if(page==='pics'&&!isAdmin())page='dashboard';
  if(page==='approvals'&&!isAdmin())page='dashboard';
  currentPage=page;$('#pageTitle').textContent=TITLES[page]?.[0]||page;$('#pageSubtitle').textContent=TITLES[page]?.[1]||'';
  $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===page));$('#sidebar').classList.remove('open');
  $('#pageContent').innerHTML='<div class="loading-card"><div class="spinner"></div><span>Memuat data…</span></div>';
  try{
    if(page==='dashboard')await renderDashboard();
    else if(page==='tickets')await renderTickets();
    else if(page==='new')await renderNewTicket();
    else if(page==='approvals')await renderApprovals();
    else if(page==='accounts')await renderAccounts();
    else if(page==='pics')await renderPicDirectory();
    else if(page==='reports')await renderReports();
  }catch(err){$('#pageContent').innerHTML=`<div class="empty-state"><h3>Gagal memuat halaman</h3><p>${esc(err.message)}</p></div>`;}
}
$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload();};
$('#changePasswordBtn').onclick=()=>{
  openModal(`<span class="eyebrow">SECURITY</span><h2>Ganti Password</h2><p class="muted">Masukkan password saat ini untuk membuat password baru. Notifikasi keamanan akan dikirim ke email akun.</p><form id="changePasswordForm" class="stack-form"><label>Password Saat Ini<input type="password" name="currentPassword" required></label><label>Password Baru<input type="password" name="newPassword" minlength="8" required></label><button class="btn primary">Simpan Password</button></form>`);
  $('#changePasswordForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast(d.message);closeModal();}catch(err){toast(err.message,'error');}};
};

async function loadDirectory(){if(!isAdmin())return [];const d=await api('/api/admin/directory');DIRECTORY=d.users;return DIRECTORY;}
async function loadPicDirectory(){if(!isAdmin())return [];const d=await api('/api/admin/pics');PIC_DIRECTORY=d.pics||[];return PIC_DIRECTORY;}
function picOptionLabel(p){return p.type==='admin'?`${p.name} — ${p.department||'Admin'}${p.key===`admin:${ME?.id}`?' (Saya sendiri)':''}`:`${p.name} — ${p.contact||'PIC Non-Admin'}`;}

async function renderDashboard(){
  const jobs=[api('/api/dashboard'),api('/api/tickets?sort=updated_desc')];if(isRoot())jobs.push(api('/api/root/accounts'));
  const [d,t,accounts]=await Promise.all(jobs);const s=d.stats;const pending=accounts?.users?.filter(u=>u.role==='user'&&u.status==='pending_approval').length||0;
  const cards=[['Total',s.total,'Semua ticket'],['Open',s.open,'Menunggu diproses'],['In Progress',s.inProgress,'Sedang dikerjakan'],['Need Confirm',s.resolved,'Menunggu user'],['Finished',s.finished,'Sudah selesai']];
  if(isRoot())cards.push(['Pending Account',pending,'Butuh approval root']);
  const storage=isAdmin()?`<section class="storage-card"><div><span class="eyebrow light">STORAGE EFFICIENCY</span><h3>${fmtBytes(s.savedBytes)} berhasil dihemat</h3><p>${s.evidenceFiles} evidence · original ${fmtBytes(s.originalBytes)} → tersimpan ${fmtBytes(s.storedBytes)}</p></div><div class="storage-ring"><strong>${s.originalBytes?Math.round((s.savedBytes/s.originalBytes)*100):0}%</strong><span>saving</span></div></section>`:'';
  $('#pageContent').innerHTML=`<section class="welcome-card"><div><span class="eyebrow light">SERVICE DESK OVERVIEW</span><h2>Halo, ${esc(ME.name)}.</h2><p>${ME.role==='user'?'Pantau ticket, estimasi pengerjaan, email update, dan konfirmasi hasil pekerjaan dari sini.':'Kelola antrean, PIC, estimasi, evidence, solver, dan reporting dari satu dashboard.'}</p></div><button class="btn light" id="quickTicket">＋ Buat Ticket</button></section><div class="stats-grid">${cards.map(c=>`<div class="stat-card"><span>${c[0]}</span><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join('')}</div>${storage}<section class="section-card"><div class="section-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Ticket Terbaru</h3></div><button class="btn secondary" id="seeAll">Lihat Semua</button></div><div class="ticket-list">${renderTicketCards(t.tickets.slice(0,6))||'<div class="empty-state"><h3>Belum ada ticket</h3><p>Ticket baru akan tampil di sini.</p></div>'}</div></section>`;
  $('#quickTicket').onclick=()=>navigate('new');$('#seeAll').onclick=()=>navigate('tickets');bindTicketButtons();
}
function renderTicketCards(list){
  return list.map(t=>`<article class="ticket-card"><div class="ticket-main"><div class="ticket-topline"><strong>${esc(t.id)}</strong>${badgePriority(t.priority)}${badgeStatus(t.status)}</div><h4>${esc(t.title)}</h4><p>${esc(t.requester?.name||'-')} · ${esc(t.requester?.department||'-')} · ${esc(t.category)}</p><div class="ticket-meta"><span>👤 PIC: ${esc(t.assignedTo?.name||'Belum ditentukan')}</span><span>⏱ Proses: ${esc(t.estimatedProcessing||'TBA')}</span><span>🏁 Selesai: ${esc(t.estimatedCompletion||'TBA')}</span><span>📎 ${(t.evidence||[]).length+(t.resolutionEvidence||[]).length} file</span></div></div><div class="ticket-side"><small>Update</small><b>${fmtDate(t.updatedAt||t.createdAt)}</b><button class="btn secondary detail-btn" data-id="${esc(t.id)}">Detail</button></div></article>`).join('');
}
function bindTicketButtons(){$$('.detail-btn').forEach(b=>b.onclick=()=>showTicket(b.dataset.id));}

async function renderTickets(){
  let opts={pics:[],solvers:[],creators:[]};
  if(isAdmin())opts=await api('/api/admin/report-options');
  const advanced=isAdmin()?`<select id="tPic"><option value="All">Semua PIC</option>${opts.pics.map(x=>`<option value="${esc(x.key)}">PIC: ${esc(x.name)}</option>`).join('')}</select><select id="tCreator"><option value="All">Semua Created By</option>${opts.creators.map(x=>`<option value="${esc(x.key)}">Creator: ${esc(x.name)}</option>`).join('')}</select><select id="tSolver"><option value="All">Semua Solver</option>${opts.solvers.map(x=>`<option value="${esc(x.key)}">Solver: ${esc(x.name)}</option>`).join('')}</select><label class="date-filter">Dari<input id="tFrom" type="date"></label><label class="date-filter">Sampai<input id="tTo" type="date"></label>`:'';
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">TICKET MONITORING</span><h3>${ME.role==='user'?'Ticket Saya':'Semua Ticket'}</h3><p>Pencarian mencakup ID, requester, creator, PIC, solver, judul, deskripsi, email, dan nomor telepon.</p></div></div><div class="filter-grid${isAdmin()?' advanced-filter':''}"><input id="tQ" placeholder="Cari ticket, user, PIC, solver..."><select id="tTime"><option value="all">Keseluruhan</option><option value="daily">Hari Ini</option><option value="weekly">7 Hari</option></select><select id="tStatus"><option>All</option>${STATUSES.map(x=>`<option>${x}</option>`)}</select><select id="tPriority"><option>All</option>${ALL_PRIORITIES.map(x=>`<option>${x}</option>`)}</select><select id="tCategory"><option>All</option>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select><select id="tSort"><option value="updated_desc">Update Terbaru</option><option value="created_desc">Dibuat Terbaru</option><option value="created_asc">Paling Lama</option><option value="priority_desc">Priority Tertinggi</option></select>${advanced}</div><div id="ticketCount" class="result-count"></div><div id="ticketsList" class="ticket-list"></div></section>`;
  let timer;
  async function load(){
    const params={q:$('#tQ').value,timeframe:$('#tTime').value,status:$('#tStatus').value,priority:$('#tPriority').value,category:$('#tCategory').value,sort:$('#tSort').value};
    if(isAdmin()){Object.assign(params,{pic:$('#tPic').value,creator:$('#tCreator').value,solver:$('#tSolver').value,dateFrom:$('#tFrom').value,dateTo:$('#tTo').value});}
    const d=await api('/api/tickets?'+new URLSearchParams(params));$('#ticketCount').textContent=`${d.tickets.length} ticket ditemukan`;$('#ticketsList').innerHTML=renderTicketCards(d.tickets)||'<div class="empty-state"><h3>Tidak ada ticket</h3><p>Coba ubah filter atau kata pencarian.</p></div>';bindTicketButtons();
  }
  const ids=['tTime','tStatus','tPriority','tCategory','tSort',...(isAdmin()?['tPic','tCreator','tSolver','tFrom','tTo']:[])];ids.forEach(id=>$(`#${id}`).onchange=load);$('#tQ').oninput=()=>{clearTimeout(timer);timer=setTimeout(load,250);};await load();
}

async function renderNewTicket(){
  if(isAdmin()){await loadDirectory();await loadPicDirectory();}
  const activeUsers=DIRECTORY.filter(u=>u.role==='user'&&u.status==='active');createQueue=[];
  $('#pageContent').innerHTML=`<div class="ticket-create-grid"><section class="section-card"><div class="section-head"><div><span class="eyebrow">CREATE TICKET</span><h3>Detail Kendala</h3><p>Ticket dapat dibuat langsung oleh user atau dicatat admin saat user datang/menyampaikan kendala secara langsung.</p></div></div><form id="ticketForm" class="form-grid two">
    ${isAdmin()?`<label class="span-2">Requester<select id="requesterMode" name="requesterUserId"><option value="">Walk-in / Manual</option><option value="__self__">Saya sendiri — ${esc(ME.department||'-')}</option>${activeUsers.map(u=>`<option value="${u.id}">${esc(u.name)} — ${esc(u.department)}</option>`)}</select><small>Created By tetap tercatat sebagai ${esc(ME.name)}.</small></label><div id="manualRequester" class="span-2 form-grid two"><label>Nama Requester<input name="manualName" placeholder="Nama user yang datang langsung"></label><label>Bagian<input name="manualDepartment"></label><label>Email<input name="manualEmail" type="email"></label><label>No. Telepon<input name="manualPhone"></label></div><label class="span-2">PIC Awal<select name="assignedPicKey"><option value="">Belum ditentukan</option>${PIC_DIRECTORY.map(p=>`<option value="${esc(p.key)}" ${p.key===`admin:${ME.id}`?'selected':''}>${esc(picOptionLabel(p))}</option>`).join('')}</select><small>Admin/root otomatis tersedia sebagai PIC. PIC non-admin dapat ditambah melalui menu PIC Directory.</small></label>`:''}
    <label class="span-2">Judul Kendala<input name="title" required placeholder="Contoh: Tidak dapat mengakses Wi-Fi kantor"></label><label>Kategori<select name="category" required>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select></label><label>Priority<select name="priority" id="prioritySelect">${PRIORITIES.map(x=>`<option ${x==='Medium'?'selected':''}>${x}</option>`)}</select></label><label>Lokasi / Area<input name="location" placeholder="Lantai, ruang, lokasi kerja"></label><label>Perangkat / Asset<input name="asset" placeholder="Hostname / asset tag (opsional)"></label><label class="span-2">Impact<input name="impact" placeholder="Contoh: 5 user terdampak / pekerjaan Finance terhenti"></label><label class="span-2">Deskripsi<textarea name="description" rows="6" required placeholder="Jelaskan gejala, error, sejak kapan terjadi, dan langkah yang sudah dicoba."></textarea></label>
    <div class="span-2 estimate-panel"><div><span>Estimasi Proses</span><strong id="estProcess">1 hari kerja</strong></div><div><span>Estimasi Completion</span><strong id="estCompletion">2 hari kerja</strong></div><small>Default otomatis mengikuti priority. Admin dapat mengubah kedua estimasi kapan saja.</small></div>
    <div class="span-2"><div class="upload-zone" id="uploadZone"><input type="file" id="evidenceInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><div class="upload-icon">⇧</div><strong>Drop file di sini atau pilih hingga 10 file</strong><span>5 MB/file · dapat memilih file beberapa kali · gambar dikompres otomatis di server</span></div><div id="fileQueue" class="file-queue"></div></div>
    <button class="btn primary span-2 large">Kirim Ticket</button></form></section><aside class="side-info"><div class="mini-card"><span class="eyebrow">EMAIL AUTOMATION</span><h4>Update tanpa cek berkala</h4><p>Email dikirim saat ticket dibuat, di-update, PIC berubah, resolved, reopened, atau selesai.</p></div><div class="mini-card"><span class="eyebrow">STORAGE SAVING</span><h4>Evidence otomatis diperkecil</h4><p>Gambar di-resize dan dikonversi ke WebP hanya jika hasilnya lebih kecil. Original image tidak pernah disimpan ganda.</p></div><div class="mini-card"><span class="eyebrow">AUDIT TRAIL</span><h4>Creator & solver tercatat</h4><p>Requester, pembuat ticket, PIC, solver, dan timeline perubahan disimpan terpisah.</p></div></aside></div>`;
  if(isAdmin()){const mode=$('#requesterMode'),manual=$('#manualRequester');const sync=()=>manual.classList.toggle('hidden',!!mode.value);mode.onchange=sync;sync();}
  const syncEst=()=>{const d=DEFAULTS[$('#prioritySelect').value];$('#estProcess').textContent=d.processing;$('#estCompletion').textContent=d.completion;};$('#prioritySelect').onchange=syncEst;syncEst();
  setupCreateQueue();
  $('#ticketForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);for(const f of createQueue)fd.append('evidence',f);try{const d=await api('/api/tickets',{method:'POST',body:fd});toast(`Ticket ${d.ticket.id} berhasil dibuat dan notifikasi email diproses.`);createQueue=[];await showTicket(d.ticket.id);}catch(err){toast(err.message,'error');}};
}
function addFilesToQueue(files, queue, draw){
  for(const f of files){if(queue.length>=10){toast('Maksimal 10 file per evidence.','error');break;}if(f.size>5*1024*1024){toast(`${f.name} lebih dari 5 MB.`,'error');continue;}if(!queue.some(x=>x.name===f.name&&x.size===f.size&&x.lastModified===f.lastModified))queue.push(f);}draw();
}
function setupCreateQueue(){
  const input=$('#evidenceInput'),zone=$('#uploadZone');const draw=()=>drawQueue('#fileQueue',createQueue,draw);
  input.onchange=e=>{addFilesToQueue([...e.target.files],createQueue,draw);input.value='';};
  ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag');}));zone.addEventListener('drop',e=>addFilesToQueue([...e.dataTransfer.files],createQueue,draw));draw();
}
function drawQueue(selector,queue,redraw){const el=$(selector);if(!el)return;el.innerHTML=queue.map((f,i)=>`<div class="queue-item"><div class="file-type">${f.type.startsWith('image/')?'IMG':'FILE'}</div><div><strong>${esc(f.name)}</strong><span>${fmtBytes(f.size)}</span></div><button type="button" data-remove="${i}" aria-label="Hapus file">×</button></div>`).join('');$$('[data-remove]',el).forEach(b=>b.onclick=()=>{queue.splice(Number(b.dataset.remove),1);redraw();});}

async function showTicket(id){
  const d=await api('/api/tickets/'+encodeURIComponent(id));const t=d.ticket;if(isAdmin()){await loadDirectory();await loadPicDirectory();}
  const allEvidence=[...(t.evidence||[]).map(x=>({...x,group:'Evidence Awal'})),...(t.resolutionEvidence||[]).map(x=>({...x,group:'Evidence Penyelesaian'}))];
  const canConfirm=ME.role==='user'&&t.status==='Resolved - Awaiting Confirmation';
  openModal(`<div class="ticket-detail-head"><div><span class="eyebrow">${esc(t.id)}</span><h2>${esc(t.title)}</h2><div class="inline-badges">${badgePriority(t.priority)}${badgeStatus(t.status)}</div></div><div class="detail-date"><span>Dibuat</span><strong>${fmtDate(t.createdAt)}</strong></div></div>
  <div class="detail-kpis"><div><span>Requester</span><strong>${esc(t.requester?.name||'-')}</strong><small>${esc(t.requester?.department||'-')}</small></div><div><span>Created By</span><strong>${esc(t.createdBy?.name||'-')}</strong><small>${esc(roleLabel(t.createdBy?.role||'user'))}</small></div><div><span>PIC</span><strong>${esc(t.assignedTo?.name||'Belum ditentukan')}</strong><small>${esc(t.assignedTo?.contact||t.assignedTo?.department||'-')}</small></div><div><span>Solver</span><strong>${esc(t.resolvedBy?.name||'Belum selesai')}</strong><small>${t.resolvedAt?fmtDate(t.resolvedAt):'-'}</small></div></div>
  <div class="detail-section"><div class="info-grid"><div><span>Kategori</span><b>${esc(t.category)}</b></div><div><span>Lokasi</span><b>${esc(t.location||'-')}</b></div><div><span>Asset</span><b>${esc(t.asset||'-')}</b></div><div><span>Impact</span><b>${esc(t.impact||'-')}</b></div><div><span>Estimasi Proses</span><b>${esc(t.estimatedProcessing||'TBA')}</b></div><div><span>Estimasi Completion</span><b>${esc(t.estimatedCompletion||'TBA')}</b></div></div><div class="description-box"><span>Deskripsi</span><p>${esc(t.description)}</p></div></div>
  ${t.resolutionNote?`<div class="resolution-box"><span>CATATAN PENYELESAIAN</span><p>${esc(t.resolutionNote)}</p></div>`:''}
  <div class="detail-section"><div class="section-head compact"><div><span class="eyebrow">EVIDENCE</span><h4>${allEvidence.length} file tersimpan</h4></div></div><div class="evidence-grid">${allEvidence.length?renderEvidence(allEvidence):'<div class="empty-inline">Tidak ada evidence.</div>'}</div></div>
  <div class="detail-section"><div class="section-head compact"><div><span class="eyebrow">ACTIVITY</span><h4>Timeline Ticket</h4></div></div><div class="timeline">${(t.timeline||[]).slice().reverse().map(x=>`<div class="timeline-item"><i></i><div><strong>${esc(x.by||'System')}</strong><p>${esc(x.note||x.type)}</p><span>${fmtDate(x.at)}</span></div></div>`).join('')}</div></div>
  ${isAdmin()?adminTicketControls(t):''}${canConfirm?`<div class="confirm-panel"><h4>Apakah pekerjaan sudah sesuai?</h4><p>Konfirmasi selesai atau buka kembali jika kendala masih terjadi.</p><div class="action-row"><button class="btn success" id="confirmDone">✓ Konfirmasi Selesai</button><button class="btn danger-soft" id="reopenBtn">↻ Masih Bermasalah</button></div></div>`:''}`,true);
  if(isAdmin())bindAdminTicketControls(t);
  if(canConfirm){$('#confirmDone').onclick=async()=>{const note=prompt('Catatan opsional:')||'';try{await api(`/api/tickets/${encodeURIComponent(t.id)}/confirm`,{method:'POST',body:JSON.stringify({note})});toast('Ticket dikonfirmasi selesai.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};$('#reopenBtn').onclick=async()=>{const note=prompt('Jelaskan bagian yang masih bermasalah:');if(note===null)return;try{await api(`/api/tickets/${encodeURIComponent(t.id)}/reopen`,{method:'POST',body:JSON.stringify({note})});toast('Ticket dibuka kembali dan PIC diberi notifikasi.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};}
}
function renderEvidence(files){return files.map(f=>{const isImg=String(f.mimetype||'').startsWith('image/')||String(f.url||'').endsWith('.webp');const saved=Number(f.savedBytes||0)>0?` · hemat ${fmtBytes(f.savedBytes)}`:'';return isImg?`<a class="evidence-card image" href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="${esc(f.name)}"><div><strong>${esc(f.group||'Evidence')}</strong><span>${esc(f.name)} · ${fmtBytes(f.size)}${saved}</span></div></a>`:`<a class="evidence-card" href="${esc(f.url)}" target="_blank"><div class="doc-icon">DOC</div><div><strong>${esc(f.group||'Evidence')}</strong><span>${esc(f.name)} · ${fmtBytes(f.size)}</span></div></a>`;}).join('');}
function adminTicketControls(t){
  const currentKey=t.assignedTo?.key||(t.assignedTo?.userId?`admin:${t.assignedTo.userId}`:(t.assignedTo?.picId?`external:${t.assignedTo.picId}`:''));
  return `<div class="detail-section admin-controls"><div class="section-head compact"><div><span class="eyebrow">ADMIN CONTROL</span><h4>Kelola Ticket</h4></div></div><div class="form-grid two"><label>Status<select id="editStatus">${STATUSES.map(x=>`<option ${x===t.status?'selected':''}>${x}</option>`)}</select></label><label>Priority<select id="editPriority">${ALL_PRIORITIES.map(x=>`<option ${x===t.priority?'selected':''}>${x}</option>`)}</select></label><label class="span-2">PIC<select id="editPic"><option value="">Belum ditentukan</option>${PIC_DIRECTORY.map(p=>`<option value="${esc(p.key)}" ${currentKey===p.key?'selected':''}>${esc(picOptionLabel(p))}</option>`).join('')}</select><small>Root dan Admin biasa dapat menjadi PIC. PIC non-admin dikelola di menu PIC Directory.</small></label><label>Estimasi Proses<input id="editProcessing" value="${esc(t.estimatedProcessing||'TBA')}"></label><label>Estimasi Completion<input id="editCompletion" value="${esc(t.estimatedCompletion||'TBA')}" placeholder="Bisa ditulis TBA"></label><button class="btn ghost span-2" id="applyPriorityDefault">↺ Gunakan Default Priority</button><button class="btn secondary span-2" id="saveTicketChanges">Simpan Perubahan & Kirim Email</button></div><div class="divider"><span>penyelesaian</span></div><button class="btn primary wide" id="resolveTicketBtn">✓ Resolve Ticket + Catatan / Evidence</button></div>`;
}
function bindAdminTicketControls(t){
  const setDefaults=()=>{const d=DEFAULTS[$('#editPriority').value];$('#editProcessing').value=d?.processing||'TBA';$('#editCompletion').value=d?.completion||'TBA';};
  $('#applyPriorityDefault').onclick=setDefaults;$('#editPriority').addEventListener('change',setDefaults);
  $('#saveTicketChanges').onclick=async()=>{try{await api(`/api/admin/tickets/${encodeURIComponent(t.id)}`,{method:'PATCH',body:JSON.stringify({status:$('#editStatus').value,priority:$('#editPriority').value,assignedPicKey:$('#editPic').value,estimatedProcessing:$('#editProcessing').value,estimatedCompletion:$('#editCompletion').value})});toast('Perubahan disimpan. Requester dan PIC baru diberi notifikasi jika email tersedia.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
  $('#resolveTicketBtn').onclick=()=>resolveModal(t);
}

function resolveModal(t){
  resolutionQueue=[];
  openModal(`<span class="eyebrow">RESOLUTION</span><h2>Selesaikan ${esc(t.id)}</h2><p class="muted">Catatan dan evidence penyelesaian opsional, tetapi sangat disarankan untuk dokumentasi dan audit.</p><form id="resolveForm" class="stack-form"><label>Catatan Penyelesaian<textarea name="resolutionNote" rows="6" placeholder="Jelaskan tindakan yang dilakukan dan hasil pengecekan."></textarea></label><div><div class="upload-zone compact-upload" id="resolutionUploadZone"><input type="file" id="resolutionEvidenceInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><div class="upload-icon">⇧</div><strong>Tambah evidence penyelesaian</strong><span>Maks. 10 file total · 5 MB/file · gambar dikompres otomatis</span></div><div id="resolutionQueue" class="file-queue"></div></div><button class="btn primary">Resolve Ticket & Kirim Notifikasi</button></form>`);
  const input=$('#resolutionEvidenceInput'),zone=$('#resolutionUploadZone');const draw=()=>drawQueue('#resolutionQueue',resolutionQueue,draw);
  input.onchange=e=>{addFilesToQueue([...e.target.files],resolutionQueue,draw);input.value='';};['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag');}));['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag');}));zone.addEventListener('drop',e=>addFilesToQueue([...e.dataTransfer.files],resolutionQueue,draw));draw();
  $('#resolveForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);for(const f of resolutionQueue)fd.append('resolutionEvidence',f);try{await api(`/api/admin/tickets/${encodeURIComponent(t.id)}/resolve`,{method:'POST',body:fd});toast('Ticket ditandai selesai dan notifikasi email dikirim.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
}


async function renderPicDirectory(){
  const d=await api('/api/admin/pics');let external=d.external||[];const admins=(d.pics||[]).filter(p=>p.type==='admin');let query='';
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">PIC DIRECTORY</span><h3>Daftar PIC</h3><p>Semua Admin dan Root Administrator otomatis tersedia sebagai PIC. Tambahkan PIC non-admin cukup dengan nama dan kontak.</p></div><button class="btn primary" id="addPicBtn">＋ Tambah PIC Non-Admin</button></div><input id="picSearch" class="wide-search" placeholder="Cari nama atau kontak PIC..."><div class="pic-section-title">PIC Internal · Admin Aktif</div><div class="account-grid">${admins.map(p=>`<article class="account-card"><div class="account-card-head"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(p.name)}${p.key===`admin:${ME.id}`?' · Saya':''}</h4><p>${esc(p.department||'Administrator')}</p></div><span class="badge blue">Admin PIC</span></div><div class="account-details"><span>Kontak<b>${esc(p.contact||'-')}</b></span><span>Label<b>${esc(p.label||'-')}</b></span></div></article>`).join('')}</div><div class="pic-section-title">PIC Non-Admin</div><div id="externalPicGrid" class="account-grid"></div></section>`;
  function draw(){const q=query.trim().toLowerCase();const list=external.filter(p=>!q||[p.name,p.contact].some(v=>String(v||'').toLowerCase().includes(q)));$('#externalPicGrid').innerHTML=list.map(p=>`<article class="account-card"><div class="account-card-head"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(p.name)}</h4><p>PIC Non-Admin</p></div><span class="badge gray">External PIC</span></div><div class="account-details"><span>Kontak<b>${esc(p.contact)}</b></span><span>Dibuat<b>${fmtDate(p.createdAt)}</b></span></div><div class="account-actions"><button class="btn secondary edit-pic" data-id="${p.id}">Edit</button><button class="btn danger-soft delete-pic" data-id="${p.id}">Delete</button></div></article>`).join('')||'<div class="empty-state"><h3>Belum ada PIC non-admin</h3><p>Tambahkan vendor, teknisi, atau personel support lain bila diperlukan.</p></div>';
    $$('.edit-pic').forEach(b=>b.onclick=()=>picEditor(external.find(x=>x.id===b.dataset.id),refresh));
    $$('.delete-pic').forEach(b=>b.onclick=async()=>{const x=external.find(p=>p.id===b.dataset.id);if(!confirm(`Hapus ${x.name} dari PIC Directory? Ticket historis tetap menyimpan nama PIC.`))return;try{await api(`/api/admin/pics/${x.id}`,{method:'DELETE'});toast('PIC dihapus dari directory.');await refresh();}catch(err){toast(err.message,'error');}});
  }
  async function refresh(){const x=await api('/api/admin/pics');external=x.external||[];PIC_DIRECTORY=x.pics||[];draw();}
  $('#picSearch').oninput=e=>{query=e.target.value;draw();};$('#addPicBtn').onclick=()=>picEditor(null,refresh);draw();
}
function picEditor(pic,onDone){
  openModal(`<span class="eyebrow">PIC DIRECTORY</span><h2>${pic?'Edit':'Tambah'} PIC Non-Admin</h2><p class="muted">Data cukup nama dan kontak. Kontak dapat berupa nomor telepon, extension, atau email.</p><form id="picForm" class="stack-form"><label>Nama PIC<input name="name" value="${esc(pic?.name||'')}" required></label><label>Kontak<input name="contact" value="${esc(pic?.contact||'')}" placeholder="0812..., ext. 123, atau email" required></label><button class="btn primary">${pic?'Simpan Perubahan':'Tambah PIC'}</button></form>`);
  $('#picForm').onsubmit=async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(e.target));await api(pic?`/api/admin/pics/${pic.id}`:'/api/admin/pics',{method:pic?'PATCH':'POST',body:JSON.stringify(data)});toast(pic?'PIC diperbarui.':'PIC berhasil ditambahkan.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}


async function renderApprovals(){
  const d=await api('/api/admin/users');
  const users=d.users||[];
  const pending=users.filter(u=>u.status==='pending_approval');
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">USER APPROVAL</span><h3>Registrasi Eksternal</h3><p>Email non-@aruraharja.co.id langsung masuk antrean approval admin. Setelah disetujui, user dapat login dengan akun yang didaftarkan.</p></div><span class="count-pill">${pending.length} menunggu</span></div><div class="account-grid" id="approvalGrid">${pending.map(u=>`<article class="account-card pending"><div class="account-card-head"><div class="avatar">${esc(u.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(u.name)}</h4><p>@${esc(u.username)} · ${esc(u.department||'-')}</p></div>${badgeRole(u.role)}</div><div class="account-details"><span>Email<b>${esc(u.email)}</b></span><span>Telepon<b>${esc(u.phone||'-')}</b></span><span>Metode Aktivasi<b>${u.emailVerified?'Email Verified ✓':'Admin Approval'}</b></span><span>Didaftarkan<b>${fmtDate(u.createdAt)}</b></span></div><div class="account-actions"><button class="btn success approve-user" data-id="${u.id}">Approve</button><button class="btn danger-soft reject-user" data-id="${u.id}">Reject</button></div></article>`).join('')||'<div class="empty-state"><h3>Tidak ada approval tertunda</h3><p>Tidak ada registrasi eksternal yang menunggu persetujuan.</p></div>'}</div></section>`;
  $$('.approve-user').forEach(b=>b.onclick=async()=>{try{await api(`/api/admin/users/${b.dataset.id}/approve`,{method:'POST'});toast('User disetujui dan email aktivasi dikirim.');renderApprovals();}catch(err){toast(err.message,'error')}});
  $$('.reject-user').forEach(b=>b.onclick=async()=>{const reason=prompt('Alasan penolakan:','Data belum dapat diverifikasi.');if(reason===null)return;try{await api(`/api/admin/users/${b.dataset.id}/reject`,{method:'POST',body:JSON.stringify({reason})});toast('Registrasi ditolak dan user diberi notifikasi email.');renderApprovals();}catch(err){toast(err.message,'error')}});
}

async function renderAccounts(){
  if(!isRoot())throw new Error('Akses root administrator diperlukan.');
  const d=await api('/api/root/accounts');let users=d.users;let query='';let role='all';let status='all';
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">ROOT ACCOUNT CONTROL</span><h3>Account Management</h3><p>Hanya root administrator yang dapat membuat, mengubah, reset password, approve/reject, dan menghapus user/admin.</p></div><button class="btn primary" id="createAccountBtn">＋ Buat Akun</button></div><div class="filter-grid account-filter"><input id="accQ" placeholder="Cari nama, username, email, bagian..."><select id="accRole"><option value="all">Semua Role</option><option value="user">User</option><option value="admin">Admin</option><option value="root_admin">Root Admin</option></select><select id="accStatus"><option value="all">Semua Status</option><option value="active">Active</option><option value="pending_approval">Pending Approval</option><option value="pending_verification">Pending Verification</option><option value="rejected">Rejected</option><option value="disabled">Disabled</option></select></div><div id="accountSummary"></div><div id="accountsGrid" class="account-grid"></div></section>`;
  function draw(){
    const q=query.trim().toLowerCase();const list=users.filter(u=>(role==='all'||u.role===role)&&(status==='all'||u.status===status)&&(!q||[u.name,u.username,u.email,u.department,u.phone,u.label].some(v=>String(v||'').toLowerCase().includes(q))));
    const pending=users.filter(u=>u.role==='user'&&u.status==='pending_approval').length;const admins=users.filter(u=>u.role==='admin').length;const activeUsers=users.filter(u=>u.role==='user'&&u.status==='active').length;
    $('#accountSummary').innerHTML=`<div class="account-summary"><div><span>User Aktif</span><b>${activeUsers}</b></div><div><span>Admin</span><b>${admins}</b></div><div><span>Pending Approval</span><b>${pending}</b></div><div><span>Ditampilkan</span><b>${list.length}</b></div></div>`;
    $('#accountsGrid').innerHTML=list.map(u=>`<article class="account-card ${u.status==='pending_approval'?'pending':''}"><div class="account-card-head"><div class="avatar">${esc(u.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(u.name)}</h4><p>@${esc(u.username)} · ${esc(u.department||'-')}</p></div>${badgeRole(u.role)}</div><div class="account-details"><span>Email<b>${esc(u.email)}</b></span><span>Telepon<b>${esc(u.phone||'-')}</b></span><span>Status<b>${esc(statusLabel(u.status))}</b></span><span>Label<b>${esc(u.label||'-')}</b></span></div><div class="account-flags"><span>${u.emailVerified?'✓ Email verified':'○ Belum verified'}</span><span>Dibuat ${fmtDate(u.createdAt)}</span></div>${u.role==='root_admin'?`<div class="account-actions"><button class="btn secondary edit-account" data-id="${u.id}">Edit Profil Root</button></div>`:`<div class="account-actions">${u.status==='pending_approval'?`<button class="btn success approve-account" data-id="${u.id}">Approve</button><button class="btn danger-soft reject-account" data-id="${u.id}">Reject</button>`:''}<button class="btn secondary edit-account" data-id="${u.id}">Edit</button><button class="btn ghost reset-account" data-id="${u.id}">Reset Password</button><button class="btn danger-soft delete-account" data-id="${u.id}">Delete</button></div>`}</article>`).join('')||'<div class="empty-state"><h3>Tidak ada akun</h3><p>Coba ubah filter pencarian.</p></div>';
    bindAccountActions();
  }
  async function refresh(){const x=await api('/api/root/accounts');users=x.users;draw();}
  function bindAccountActions(){
    $$('.approve-account').forEach(b=>b.onclick=async()=>{try{await api(`/api/admin/users/${b.dataset.id}/approve`,{method:'POST'});toast('User disetujui dan email aktivasi dikirim.');await refresh();}catch(err){toast(err.message,'error');}});
    $$('.reject-account').forEach(b=>b.onclick=async()=>{const reason=prompt('Alasan penolakan:','Tidak memenuhi ketentuan akses.');if(reason===null)return;try{await api(`/api/admin/users/${b.dataset.id}/reject`,{method:'POST',body:JSON.stringify({reason})});toast('Registrasi ditolak dan user diberi email.');await refresh();}catch(err){toast(err.message,'error');}});
    $$('.edit-account').forEach(b=>b.onclick=()=>editAccountModal(users.find(u=>u.id===b.dataset.id),refresh));
    $$('.reset-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);const pw=prompt(`Password baru untuk ${u.name} (minimal 8 karakter):`);if(!pw)return;try{await api(`/api/root/accounts/${u.id}/reset-password`,{method:'POST',body:JSON.stringify({newPassword:pw})});toast('Password direset dan notifikasi keamanan dikirim.');}catch(err){toast(err.message,'error');}});
    $$('.delete-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);if(!confirm(`Hapus akun ${u.name} (@${u.username})? Histori ticket tetap disimpan.`))return;try{await api(`/api/root/accounts/${u.id}`,{method:'DELETE'});toast('Akun dihapus. Histori ticket tetap aman.');await refresh();}catch(err){toast(err.message,'error');}});
  }
  $('#accQ').oninput=e=>{query=e.target.value;draw();};$('#accRole').onchange=e=>{role=e.target.value;draw();};$('#accStatus').onchange=e=>{status=e.target.value;draw();};$('#createAccountBtn').onclick=()=>createAccountModal(refresh);draw();
}
function createAccountModal(onDone){
  openModal(`<span class="eyebrow">ROOT ONLY</span><h2>Buat Akun Baru</h2><p class="muted">Akun yang dibuat root langsung aktif dan dianggap sudah diverifikasi.</p><form id="createAccountForm" class="form-grid two"><label>Role<select name="role"><option value="user">User</option><option value="admin">Administrator</option></select></label><label>Nama<input name="name" required></label><label>Username<input name="username" required></label><label>Email<input name="email" type="email" required></label><label>No. Telepon<input name="phone"></label><label>Bagian<input name="department" required></label><label class="span-2">Label / Jabatan<input name="label" placeholder="Contoh: IT Support Engineer / Finance Staff"></label><label class="span-2">Password Awal<input name="password" type="password" minlength="8" required></label><button class="btn primary span-2">Buat Akun</button></form>`);
  $('#createAccountForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/root/accounts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Akun berhasil dibuat dan email notifikasi dikirim.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}
function editAccountModal(u,onDone){
  const root=u.role==='root_admin';
  openModal(`<span class="eyebrow">ACCOUNT EDITOR</span><h2>Edit ${esc(u.name)}</h2><form id="editAccountForm" class="form-grid two"><label>Role<select name="role" ${root?'disabled':''}><option value="user" ${u.role==='user'?'selected':''}>User</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrator</option><option value="root_admin" ${root?'selected':''}>Root Administrator</option></select></label><label>Status<select name="status" ${root?'disabled':''}><option value="active" ${u.status==='active'?'selected':''}>Active</option><option value="pending_approval" ${u.status==='pending_approval'?'selected':''}>Pending Approval</option><option value="rejected" ${u.status==='rejected'?'selected':''}>Rejected</option><option value="disabled" ${u.status==='disabled'?'selected':''}>Disabled</option></select></label><label>Nama<input name="name" value="${esc(u.name)}" required></label><label>Username<input name="username" value="${esc(u.username)}" required></label><label>Email<input name="email" type="email" value="${esc(u.email)}" required></label><label>No. Telepon<input name="phone" value="${esc(u.phone||'')}"></label><label>Bagian<input name="department" value="${esc(u.department||'')}" required></label><label>Label / Jabatan<input name="label" value="${esc(u.label||'')}"></label><button class="btn primary span-2">Simpan Perubahan</button></form>`);
  $('#editAccountForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(root){f.role='root_admin';f.status='active';}try{const d=await api(`/api/root/accounts/${u.id}`,{method:'PATCH',body:JSON.stringify(f)});if(u.id===ME.id){ME=d.user;renderNav();}toast('Data akun diperbarui dan notifikasi email dikirim.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}

async function renderReports(){
  let opts={pics:[],solvers:[],creators:[]};if(isAdmin())opts=await api('/api/admin/report-options');
  const advanced=isAdmin()?`<div class="report-divider span-2"><span>Pembagian Kerja / Audit</span></div><label>PIC<select id="rPic"><option value="All">Semua PIC</option>${opts.pics.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}${x.contact?` · ${esc(x.contact)}`:''}</option>`).join('')}</select></label><label>Created By<select id="rCreator"><option value="All">Semua Creator/Admin</option>${opts.creators.map(x=>`<option value="${esc(x.key)}">${esc(x.name)} · ${esc(roleLabel(x.role))}</option>`).join('')}</select></label><label>Solver<select id="rSolver"><option value="All">Semua Solver</option>${opts.solvers.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('')}</select></label><label>Quick Periode<select id="rTime"><option value="all">Keseluruhan</option><option value="daily">Hari Ini</option><option value="weekly">7 Hari</option></select></label><label>Tanggal Mulai<input id="rFrom" type="date"></label><label>Tanggal Akhir<input id="rTo" type="date"></label>`:`<label>Periode<select id="rTime"><option value="all">Keseluruhan</option><option value="daily">Harian / Hari Ini</option><option value="weekly">Mingguan / 7 Hari</option></select></label>`;
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">EXCEL REPORT</span><h3>Export Ticket (.xlsx)</h3><p>${ME.role==='user'?'Export hanya berisi ticket milik akun kamu.':'Root dan Admin mempunyai hak export yang sama. Gunakan filter untuk melihat pembagian kasus per PIC, pembuat ticket, solver, dan rentang tanggal.'}</p></div></div><div class="form-grid two">${advanced}<label>Kategori<select id="rCat"><option>All</option>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select></label><label>Priority<select id="rPri"><option>All</option>${ALL_PRIORITIES.map(x=>`<option>${x}</option>`)}</select></label><label>Status<select id="rStat"><option>All</option>${STATUSES.map(x=>`<option>${x}</option>`)}</select></label><label class="${ME.role==='user'?'':'span-2'}">Search Optional<input id="rQ" placeholder="Nama, ID, judul, PIC, solver..."></label><button id="exportBtn" class="btn primary span-2 large">↓ Download Excel + Ringkasan Pembagian</button></div><div class="report-note"><b>Workbook berisi 2 sheet:</b> <b>Ringkasan</b> untuk total dan pembagian ticket berdasarkan PIC, Created By, dan Solver; serta <b>Tickets</b> untuk data detail. Jika Tanggal Mulai/Akhir diisi, rentang tersebut mengalahkan Quick Periode.</div></section>`;
  $('#exportBtn').onclick=()=>{const params={timeframe:$('#rTime').value,category:$('#rCat').value,priority:$('#rPri').value,status:$('#rStat').value,q:$('#rQ').value};if(isAdmin())Object.assign(params,{pic:$('#rPic').value,creator:$('#rCreator').value,solver:$('#rSolver').value,dateFrom:$('#rFrom').value,dateTo:$('#rTo').value});location.href='/api/tickets-export.xlsx?'+new URLSearchParams(params);};
}

function setupGuestForm(){
  const form=$('#guestTicketForm');if(!form)return;
  const cat=$('#guestCategory');cat.innerHTML=CATEGORIES.map(x=>`<option>${esc(x)}</option>`).join('');
  cat.value='Email / Account';
  const input=$('#guestEvidenceInput'),zone=$('#guestUploadZone');
  const draw=()=>drawQueue('#guestFileQueue',guestQueue,draw);
  input.onchange=e=>{addFilesToQueue([...e.target.files],guestQueue,draw);input.value='';};
  ['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag');}));
  ['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag');}));
  zone.addEventListener('drop',e=>addFilesToQueue([...e.dataTransfer.files],guestQueue,draw));draw();
  form.onsubmit=async e=>{
    e.preventDefault();const fd=new FormData(e.target);for(const f of guestQueue)fd.append('evidence',f);
    try{
      const d=await api('/api/guest/tickets',{method:'POST',body:fd});
      $('#guestTicketResult').className='guest-result';
      $('#guestTicketResult').innerHTML=`<strong>Ticket ${esc(d.ticket.id)} berhasil dibuat.</strong><p>Simpan ID ticket ini bila perlu menghubungi tim IT. Priority dan estimasi akan ditentukan admin.</p>`;
      form.reset();guestQueue=[];draw();cat.value='Email / Account';toast(`Ticket ${d.ticket.id} berhasil dikirim.`);
    }catch(err){toast(err.message,'error');}
  };
}

setupGuestForm();
boot();
