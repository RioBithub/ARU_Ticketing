const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

let ME = null;
let DASHBOARD_TIMEFRAME = 'all';
let DASHBOARD_PIC = 'All';
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
  Critical:{processing:{days:0,hours:2,minutes:0},completion:{days:0,hours:8,minutes:0}},
  High:{processing:{days:0,hours:4,minutes:0},completion:{days:1,hours:0,minutes:0}},
  Medium:{processing:{days:1,hours:0,minutes:0},completion:{days:2,hours:0,minutes:0}},
  Low:{processing:{days:2,hours:0,minutes:0},completion:{days:5,hours:0,minutes:0}}
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
function roleLabel(r){return r==='root_admin'?'Root Administrator':r==='admin'?'Administrator':r==='supervisor'?'Admin Supervisor':r==='guest'?'Guest':'User';}
function requestKindLabel(v){return String(v||'Issue')==='Request'?'Permintaan':'Kendala';}
function statusLabel(s){return String(s||'').replaceAll('_',' ');}
function toast(msg,type='success'){const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>el.className='toast',3800);}
function badgeStatus(v=''){const c=v==='Finished'?'green':v.includes('Resolved')?'purple':v==='Open'?'blue':v==='Waiting User'?'orange':v==='Reopened'?'red':'gray';return `<span class="badge ${c}">${esc(v)}</span>`;}
function badgePriority(v=''){const c=v==='Critical'?'red':v==='High'?'orange':v==='Medium'?'blue':v==='Low'?'green':'gray';return `<span class="badge ${c}">${esc(v||'Unassigned')}</span>`;}
function badgeRole(v=''){const c=v==='root_admin'?'purple':v==='admin'?'blue':v==='supervisor'?'orange':'gray';return `<span class="badge ${c}">${esc(roleLabel(v))}</span>`;}
function openModal(html,wide=false){$('#modalContent').innerHTML=html;$('#modalBox').classList.toggle('wide',wide);$('#modalBackdrop').classList.remove('hidden');document.body.classList.add('no-scroll');}
function closeModal(){$('#modalBackdrop').classList.add('hidden');$('#modalContent').innerHTML='';$('#modalBox').classList.remove('wide');document.body.classList.remove('no-scroll');}

function actionDialog(options={}){
  const o={
    tone:'info',
    icon:'i',
    title:'Konfirmasi',
    message:'',
    confirmText:'Lanjutkan',
    cancelText:'Batal',
    field:null,
    ...options
  };
  return new Promise(resolve=>{
    document.querySelector('.action-dialog-backdrop')?.remove();
    const field=o.field?`<label class="action-dialog-field">${esc(o.field.label||'Keterangan')}
      ${o.field.type==='textarea'
        ?`<textarea id="actionDialogInput" rows="${Number(o.field.rows||5)}" ${o.field.required!==false?'required':''} minlength="${Number(o.field.minLength||0)}" placeholder="${esc(o.field.placeholder||'')}">${esc(o.field.value||'')}</textarea>`
        :`<div class="action-input-wrap"><input id="actionDialogInput" type="${esc(o.field.type||'text')}" ${o.field.required!==false?'required':''} minlength="${Number(o.field.minLength||0)}" value="${esc(o.field.value||'')}" placeholder="${esc(o.field.placeholder||'')}">${o.field.type==='password'?'<button type="button" class="action-password-toggle" id="actionPasswordToggle">Lihat</button>':''}</div>`}
      ${o.field.help?`<small>${esc(o.field.help)}</small>`:''}
    </label>`:'';
    const overlay=document.createElement('div');
    overlay.className='action-dialog-backdrop';
    overlay.innerHTML=`<div class="action-dialog ${esc(o.tone)}" role="dialog" aria-modal="true" aria-labelledby="actionDialogTitle">
      <div class="action-dialog-icon">${esc(o.icon)}</div>
      <div class="action-dialog-copy">
        <span class="eyebrow">${o.tone==='danger'?'PERLU KONFIRMASI':o.tone==='warning'?'PERIKSA KEMBALI':'KONFIRMASI AKSI'}</span>
        <h3 id="actionDialogTitle">${esc(o.title)}</h3>
        <p>${esc(o.message)}</p>
      </div>
      <form id="actionDialogForm">
        ${field}
        ${o.note?`<div class="action-dialog-note">${esc(o.note)}</div>`:''}
        <div class="action-dialog-actions">
          <button type="button" class="btn ghost" id="actionDialogCancel">${esc(o.cancelText)}</button>
          <button type="submit" class="btn ${o.tone==='danger'?'danger-action':'primary'}">${esc(o.confirmText)}</button>
        </div>
      </form>
    </div>`;
    document.body.appendChild(overlay);
    const input=overlay.querySelector('#actionDialogInput');
    const onKey=e=>{if(e.key==='Escape')close(null);};
    const close=value=>{document.removeEventListener('keydown',onKey);overlay.classList.add('closing');setTimeout(()=>overlay.remove(),140);resolve(value);};
    document.addEventListener('keydown',onKey);
    overlay.querySelector('#actionDialogCancel').onclick=()=>close(null);
    overlay.addEventListener('click',e=>{if(e.target===overlay)close(null);});
    overlay.querySelector('#actionDialogForm').onsubmit=e=>{
      e.preventDefault();
      if(input&&!input.checkValidity()){input.reportValidity();return;}
      close(o.field?input.value.trim():true);
    };
    const toggle=overlay.querySelector('#actionPasswordToggle');
    if(toggle&&input)toggle.onclick=()=>{const show=input.type==='password';input.type=show?'text':'password';toggle.textContent=show?'Sembunyikan':'Lihat';input.focus();};
    setTimeout(()=>{if(input)input.focus();else overlay.querySelector('button[type="submit"]')?.focus();},20);
  });
}
function uiConfirm(options){return actionDialog({...options,field:null});}
function uiPrompt(options){return actionDialog(options);}

function isAdmin(){return ['admin','root_admin'].includes(ME?.role);}
function isStaffView(){return ['admin','root_admin','supervisor'].includes(ME?.role);}
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

async function boot(){
  try{const d=await api('/api/me');ME=d.user;if(location.pathname==='/help')openPublicHelp(false);else showApp();}
  catch{ME=null;if(location.pathname==='/help')openPublicHelp(false);else{$('#authView').classList.remove('hidden');$('#appView').classList.add('hidden');$('#helpView')?.classList.add('hidden');}}
}
function showApp(){$('#helpView')?.classList.add('hidden');$('#authView').classList.add('hidden');$('#appView').classList.remove('hidden');renderNav();navigate('dashboard');}
function renderNav(){
  let items;
  if(ME.role==='user') items=[['dashboard','⌂','Dashboard'],['tickets','◫','Ticket Saya & Public'],['new','＋','Buat Ticket'],['reports','▤','Export Ticket Saya'],['tutorial','?','Tutorial']];
  else if(ME.role==='supervisor') items=[['dashboard','⌂','Dashboard Analytics'],['tickets','◫','Semua Ticket'],['reports','▤','Report & Excel'],['tutorial','?','Tutorial']];
  else if(ME.role==='admin') items=[['dashboard','⌂','Dashboard Analytics'],['tickets','◫','Semua Ticket'],['new','＋','Buat Ticket'],['pics','♟','PIC Directory'],['approvals','✓','Approval User'],['reports','▤','Report & Excel'],['tutorial','?','Tutorial']];
  else items=[['dashboard','⌂','Dashboard Analytics'],['tickets','◫','Semua Ticket'],['new','＋','Buat Ticket'],['pics','♟','PIC Directory'],['approvals','✓','Approval User'],['accounts','♙','Account Management'],['reports','▤','Report & Excel'],['tutorial','?','Tutorial']];
  $('#navMenu').innerHTML=items.map(i=>`<button class="nav-btn" data-page="${i[0]}"><span class="nav-icon">${i[1]}</span><span>${i[2]}</span></button>`).join('');
  $$('#navMenu .nav-btn').forEach(b=>b.onclick=()=>navigate(b.dataset.page));
  $('#sidebarUser').innerHTML=`<div class="avatar">${esc(ME.name.slice(0,1).toUpperCase())}</div><div class="sidebar-user-copy"><strong>${esc(ME.name)}</strong><span>${esc(roleLabel(ME.role))}</span><small>${esc(ME.department||'-')}</small><small class="sidebar-email" title="${esc(ME.email||'')}">${esc(ME.email||'')}</small><button type="button" class="sidebar-profile-link" id="sidebarProfileBtn">Edit profil</button></div>`;
  const topActions=document.querySelector('.top-actions');
  if(topActions&&!$('#profileBtn'))topActions.insertAdjacentHTML('afterbegin','<button class="btn ghost" id="profileBtn">Profil Saya</button>');
  if($('#profileBtn'))$('#profileBtn').onclick=openMyProfileModal;
  if($('#sidebarProfileBtn'))$('#sidebarProfileBtn').onclick=openMyProfileModal;
}
const TITLES={
  dashboard:['Dashboard','Ringkasan aktivitas IT Service Desk.'],
  tickets:['Ticket Monitoring','Cari, filter, dan pantau progress pekerjaan.'],
  new:['Buat Ticket','Catat kendala maupun permintaan layanan dengan detail dan evidence.'],
  approvals:['Approval User','Registrasi eksternal yang membutuhkan persetujuan admin.'],
  accounts:['Account Management','CRUD user, admin, dan supervisor khusus root administrator.'],
  pics:['PIC Directory','Admin aktif otomatis menjadi PIC; tambahkan PIC non-admin bila diperlukan.'],
  reports:['Report & Excel','Export berdasarkan periode, PIC, creator, solver, jenis ticket, area penanganan, visibility, priority, dan status.'],
  tutorial:['Tutorial & Bantuan','Panduan penggunaan ARU IT Ticketing sesuai akses akun Anda.']
};
async function navigate(page){
  if(page==='accounts'&&!isRoot())page='dashboard';
  if(page==='pics'&&!isAdmin())page='dashboard';
  if(page==='approvals'&&!isAdmin())page='dashboard';
  if(page==='new'&&ME.role==='supervisor')page='dashboard';
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
    else if(page==='tutorial')await renderTutorial();
  }catch(err){$('#pageContent').innerHTML=`<div class="empty-state"><h3>Gagal memuat halaman</h3><p>${esc(err.message)}</p></div>`;}
}
$('#mobileMenu').onclick=()=>$('#sidebar').classList.toggle('open');
$('#logoutBtn').onclick=async()=>{await api('/api/logout',{method:'POST'});location.reload();};
function openMyProfileModal(){
  openModal(`<span class="eyebrow">PROFIL SAYA</span><h2>Detail Akun</h2><p class="muted">Nama, nomor kontak, dan bagian dapat diperbarui sendiri. Email akun tetap dikunci dan tidak dapat diubah dari profil ini.</p><form id="myProfileForm" class="form-grid two"><label>Nama<input name="name" value="${esc(ME.name||'')}" required maxlength="190"></label><label>No. Telepon / Kontak<input name="phone" value="${esc(ME.phone||'')}" placeholder="Contoh: 0812... atau ext. 123"></label><label>Email<input value="${esc(ME.email||'')}" disabled></label><label>Bagian<input name="department" value="${esc(ME.department||'')}" required maxlength="190"></label><label>Akses<input value="${esc(roleLabel(ME.role))}" disabled></label><label>Tim Penanganan<input value="${esc(ME.role==='admin'||ME.role==='root_admin'?(ME.supportType||'Both'):'-')}" disabled></label><button class="btn primary span-2">Simpan Profil</button></form>`);
  $('#myProfileForm').onsubmit=async e=>{
    e.preventDefault();
    try{
      const f=Object.fromEntries(new FormData(e.target));
      const d=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify(f)});
      ME=d.user;renderNav();closeModal();toast(d.message||'Profil berhasil diperbarui.');
    }catch(err){toast(err.message,'error')}
  };
}
$('#changePasswordBtn').onclick=()=>{
  openModal(`<span class="eyebrow">SECURITY</span><h2>Ganti Password</h2><p class="muted">Masukkan password saat ini untuk membuat password baru. Notifikasi keamanan akan dikirim ke email akun.</p><form id="changePasswordForm" class="stack-form"><label>Password Saat Ini<input type="password" name="currentPassword" required></label><label>Password Baru<input type="password" name="newPassword" minlength="8" required></label><button class="btn primary">Simpan Password</button></form>`);
  $('#changePasswordForm').onsubmit=async e=>{e.preventDefault();try{const d=await api('/api/change-password',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast(d.message);closeModal();}catch(err){toast(err.message,'error');}};
};


function tutorialRoleGuide(role){
  if(role==='user')return `
    <section id="role-guide" class="tutorial-section role-deep-dive">
      <span class="eyebrow">PANDUAN USER</span><h3>Alur lengkap sebagai User</h3>
      <div class="tutorial-steps">
        <div><b>1</b><h4>Buat ticket yang jelas</h4><p>Pilih Kendala atau Permintaan, area IT/Network, kategori, judul, impact/tujuan, lokasi/asset bila relevan, lalu lampirkan evidence.</p></div>
        <div><b>2</b><h4>Pantau pekerjaan</h4><p>Perhatikan status, PIC, catatan progress, estimasi proses, target selesai, sisa waktu dan evidence penyelesaian.</p></div>
        <div><b>3</b><h4>Konfirmasi hasil</h4><p>Jika mode User Confirm dipakai, cek hasil lalu pilih selesai + rating 1–5 bintang atau Reopen bila masih ada yang perlu ditindaklanjuti.</p></div>
        <div><b>4</b><h4>Jaga profil aktual</h4><p>Nama, bagian dan nomor kontak dapat diperbarui dari Profil Saya. Email dikunci agar identitas akun tetap konsisten.</p></div>
      </div>
      <div class="tutorial-checklist">
        <div><b>Sebelum submit</b><span>Judul spesifik</span><span>Impact/tujuan jelas</span><span>Lokasi/asset bila ada</span><span>Evidence relevan</span></div>
        <div><b>Saat diproses</b><span>Balas jika status Waiting User</span><span>Jangan buat ticket duplikat</span><span>Pantau sisa estimasi</span></div>
        <div><b>Saat selesai</b><span>Uji hasil pekerjaan</span><span>Rating sesuai pengalaman</span><span>Feedback singkat dan objektif</span></div>
      </div>
    </section>`;
  if(role==='supervisor')return `
    <section id="role-guide" class="tutorial-section role-deep-dive supervisor-guide">
      <span class="eyebrow">PANDUAN KHUSUS SUPERVISOR</span><h3>Membaca dashboard tanpa salah interpretasi</h3>
      <p class="tutorial-lead">Supervisor bersifat <b>read-only</b>. Fokus utamanya adalah membaca volume pekerjaan, kecepatan, kepatuhan estimasi, kualitas feedback dan pembagian workload — bukan mengubah ticket.</p>
      <div class="tutorial-steps">
        <div><b>1</b><h4>Tentukan konteks</h4><p>Pilih periode dan PIC. Semua angka, persentase, grafik dan tabel di bawah mengikuti filter tersebut.</p></div>
        <div><b>2</b><h4>Baca volume dahulu</h4><p>Lihat Total, Status, Jenis Ticket, Area dan Priority. Ini menjelaskan komposisi pekerjaan sebelum menilai performa.</p></div>
        <div><b>3</b><h4>Baru baca performa</h4><p>Gunakan Rata-rata Selesai, Sesuai Estimasi, Aktual/Target, Rating dan Overdue. Jangan menilai satu metrik sendirian.</p></div>
        <div><b>4</b><h4>Validasi detail</h4><p>Buka tabel performance dan ticket individual untuk melihat jumlah sampel, priority, evidence, PIC, solver dan timeline.</p></div>
      </div>
      <div class="supervisor-metric-grid">
        <article><b>Rata-rata Selesai</b><strong>Lebih kecil biasanya lebih cepat</strong><p>Dihitung dari ticket dibuat sampai resolve. Bandingkan PIC pada periode, jenis ticket dan priority yang sebanding.</p></article>
        <article><b>Sesuai Estimasi %</b><strong>Semakin dekat 100% semakin konsisten</strong><p>Persentase ticket bertarget yang selesai sebelum atau tepat target. Selalu lihat jumlah ticket eligible.</p></article>
        <article><b>Aktual / Target %</b><strong>≤100% = rata-rata masih dalam target</strong><p>Contoh 75% berarti rata-rata memakai 75% dari waktu estimasi yang dialokasikan.</p></article>
        <article><b>Rating User</b><strong>5/5 = nilai tertinggi</strong><p>Hanya berasal dari penyelesaian User Confirm. Self Confirm tidak menghasilkan rating.</p></article>
        <article><b>Workload PIC</b><strong>Menunjukkan pembagian pekerjaan</strong><p>Jumlah/share ticket yang ditugaskan. Workload tinggi bukan otomatis performa lebih baik atau lebih buruk.</p></article>
        <article><b>Solver</b><strong>Siapa yang menutup pekerjaan</strong><p>PIC adalah penanggung jawab; Solver adalah admin yang melakukan resolve. Keduanya bisa berbeda.</p></article>
      </div>
      <div class="tutorial-example">
        <span>CONTOH MEMBACA</span>
        <p><b>PIC A: 20 ticket · 90% on-time · Aktual/Target 78% · Rating 4,7/5.</b> Artinya workload 20 ticket, mayoritas memenuhi estimasi, rata-rata memakai 78% dari target, dan feedback User Confirm tinggi. Tetap cek komposisi Critical/High serta jumlah feedback sebelum menarik kesimpulan.</p>
      </div>
      <details open><summary>Urutan baca dashboard yang disarankan</summary><p><b>1.</b> Filter periode/PIC → <b>2.</b> Total & Status → <b>3.</b> Priority/Jenis/Area → <b>4.</b> Rata-rata aktual vs target → <b>5.</b> On-time % → <b>6.</b> Workload & Solver → <b>7.</b> Rating → <b>8.</b> buka tabel/ticket detail untuk validasi.</p></details>
      <details><summary>Kapan perbandingan PIC dianggap lebih adil?</summary><p>Bandingkan pada rentang waktu serupa, tipe pekerjaan serupa, priority yang sebanding, dan jumlah ticket yang cukup. PIC yang banyak menangani Critical/Network outage dapat memiliki durasi lebih tinggi daripada PIC yang mayoritas menangani request ringan.</p></details>
      <details><summary>Apa yang perlu diwaspadai?</summary><p>Sample kecil, banyak Self Confirm, ticket tanpa estimasi, ticket masih aktif, atau mix priority yang sangat berbeda dapat membuat angka terlihat ekstrem. Gunakan analytics sebagai indikator operasional, lalu cek detail ticket sebagai konteks.</p></details>
      <details><summary>Bagaimana menggunakan Excel?</summary><p>Filter periode/PIC/jenis/area/priority/status terlebih dahulu, lalu export. Workbook berisi ringkasan, detail ticket dan grafik sehingga dapat dipakai sebagai bahan review pekerjaan tanpa mengubah data di aplikasi.</p></details>
    </section>`;
  if(role==='admin')return `
    <section id="role-guide" class="tutorial-section role-deep-dive">
      <span class="eyebrow">PANDUAN ADMINISTRATOR</span><h3>Operasional ticket dari triage sampai resolve</h3>
      <div class="tutorial-steps">
        <div><b>1</b><h4>Triage</h4><p>Validasi jenis ticket, area IT/Network, category, priority, visibility, PIC serta estimasi proses/penyelesaian.</p></div>
        <div><b>2</b><h4>Kerjakan sesuai ownership</h4><p>Admin mengikuti tim penanganan dan PIC lock. Ticket PIC admin lain tidak boleh diintervensi kecuali oleh Root.</p></div>
        <div><b>3</b><h4>Catat progress</h4><p>Gunakan status In Progress/Waiting User dan catatan yang ringkas agar timeline mudah diaudit.</p></div>
        <div><b>4</b><h4>Resolve dengan mode tepat</h4><p>User Confirm untuk pekerjaan yang perlu validasi requester + rating; Self Confirm untuk pekerjaan internal/teknis yang tidak perlu feedback user.</p></div>
      </div>
      <div class="tutorial-checklist">
        <div><b>Triage minimum</b><span>Jenis ticket</span><span>IT/Network</span><span>Priority</span><span>PIC</span><span>Estimasi</span></div>
        <div><b>Audit trail</b><span>Created By</span><span>PIC</span><span>Solver</span><span>Progress note</span><span>Evidence</span></div>
        <div><b>Penutupan</b><span>Catatan hasil</span><span>Evidence final</span><span>Mode resolve</span><span>Notifikasi user</span></div>
      </div>
    </section>`;
  return `
    <section id="role-guide" class="tutorial-section role-deep-dive">
      <span class="eyebrow">PANDUAN ROOT ADMIN</span><h3>Governance, routing dan kontrol akses</h3>
      <div class="tutorial-steps">
        <div><b>1</b><h4>Kelola akun</h4><p>Buat/edit User, Administrator dan Supervisor; reset password; atur status serta tim penanganan Administrator.</p></div>
        <div><b>2</b><h4>Override bila perlu</h4><p>Root dapat mengganti PIC, lintas IT/Network dan menangani ticket yang sudah dimiliki admin lain saat ada kebutuhan operasional.</p></div>
        <div><b>3</b><h4>Jaga governance</h4><p>Pastikan visibility, estimasi, PIC Directory, approval, Created By, PIC dan Solver konsisten sehingga audit trail jelas.</p></div>
        <div><b>4</b><h4>Review performa</h4><p>Gunakan analytics dan Excel untuk membaca workload, kecepatan, estimasi, rating dan distribusi penyelesaian.</p></div>
      </div>
      <div class="tutorial-note"><b>Prinsip akses:</b> Supervisor hanya membaca; Admin mengerjakan sesuai tim/PIC; Root mengelola akses dan override operasional saat diperlukan.</div>
    </section>`;
}
function commonTutorialHtml(role='public'){
  const roleBlock=role==='public'?'':tutorialRoleGuide(role);
  const publicRoleOverview=role==='public'?`
    <section id="role-overview" class="tutorial-section">
      <span class="eyebrow">ROLE & ACCESS</span><h3>Siapa melakukan apa?</h3>
      <div class="tutorial-grid three">
        <article><span>USER</span><h4>User</h4><p>Membuat ticket, melihat ticket sendiri/public, memantau progress, konfirmasi hasil, rating dan feedback.</p></article>
        <article><span>ADMIN</span><h4>Administrator</h4><p>Triage, assign PIC, update pekerjaan, resolve, approval user, PIC Directory, analytics dan report.</p></article>
        <article><span>SUPERVISOR</span><h4>Admin Supervisor</h4><p>Read-only. Melihat seluruh ticket, analytics dan export report tanpa mengubah pekerjaan.</p></article>
        <article><span>ROOT</span><h4>Root Administrator</h4><p>Semua fungsi Admin ditambah Account Management dan override routing/PIC.</p></article>
        <article><span>GUEST</span><h4>Guest</h4><p>Mengirim ticket tanpa akun. Priority/PIC/estimasi ditentukan tim setelah triage.</p></article>
      </div>
    </section>`:'';
  return `
    <div class="tutorial-page">
      <section class="tutorial-hero">
        <div><span class="eyebrow light">ARU IT SERVICE DESK</span><h2>Panduan Lengkap IT Ticketing</h2><p>Panduan dari login dan registrasi, membuat ticket, memahami estimasi, sampai membaca analytics dan laporan.</p></div>
        <div class="tutorial-hero-badge"><strong>?</strong><span>Help Center</span></div>
      </section>
      <nav class="tutorial-index">
        <a href="#getting-started">Mulai</a><a href="#create-ticket-guide">Buat Ticket</a><a href="#ticket-concept">Konsep</a><a href="#priority-guide">Priority</a><a href="#workflow">Status</a><a href="#estimate-guide">Estimasi</a><a href="#resolution-guide">Penyelesaian</a><a href="#privacy-guide">Visibility</a><a href="#analytics-guide">Analytics</a>${role==='public'?'<a href="#role-overview">Role</a>':'<a href="#role-guide">Role Saya</a>'}<a href="#security-guide">Keamanan</a><a href="#faq-guide">FAQ</a>
      </nav>

      <section id="getting-started" class="tutorial-section"><span class="eyebrow">GETTING STARTED</span><h3>Masuk ke sistem</h3>
        <div class="tutorial-grid three">
          <article><span>01</span><h4>Login</h4><p>Gunakan username atau email yang terdaftar dan password akun.</p></article>
          <article><span>02</span><h4>Registrasi Internal</h4><p>Email <b>@aruraharja.co.id</b> mendapat OTP. Setelah kode benar, akun aktif dan dapat digunakan.</p></article>
          <article><span>03</span><h4>Registrasi Eksternal</h4><p>Email non-domain masuk antrean approval Administrator/Root sebelum dapat login.</p></article>
          <article><span>04</span><h4>Guest</h4><p>Ticket dapat dibuat tanpa akun. Priority, PIC dan estimasi awal ditentukan tim IT setelah triage.</p></article>
          <article><span>05</span><h4>Lupa Password</h4><p>Masukkan username/email, lalu gunakan kode reset yang dikirim ke email akun.</p></article>
          <article><span>06</span><h4>Profil & Notifikasi</h4><p>Nama, bagian dan kontak dapat diperbarui setelah login. Email dikunci. Notifikasi penting dikirim lewat email.</p></article>
        </div>
      </section>

      <section id="create-ticket-guide" class="tutorial-section"><span class="eyebrow">CREATE TICKET</span><h3>Cara membuat ticket yang mudah ditindaklanjuti</h3>
        <div class="tutorial-grid three">
          <article><span>A</span><h4>Judul spesifik</h4><p>Hindari “error” saja. Contoh lebih baik: “Wi-Fi ruang meeting lantai 8 putus-putus”.</p></article>
          <article><span>B</span><h4>Impact / Tujuan</h4><p>Untuk Kendala, jelaskan siapa/apa yang terdampak. Untuk Permintaan, jelaskan tujuan bisnis/operasionalnya.</p></article>
          <article><span>C</span><h4>Detail & evidence</h4><p>Tuliskan gejala/kebutuhan, langkah yang sudah dicoba, lokasi/asset, lalu lampirkan screenshot/file bila membantu.</p></article>
        </div>
        <div class="tutorial-example"><span>CONTOH</span><p><b>Kendala:</b> “LAN Finance tidak mendapat IP sejak 08.15, 6 PC terdampak, Wi-Fi tetap normal.”<br><b>Permintaan:</b> “Mohon instalasi aplikasi PDF Editor untuk 3 user Finance sebelum onboarding Senin.”</p></div>
      </section>

      <section id="ticket-concept" class="tutorial-section"><span class="eyebrow">TICKET BASICS</span><h3>Kendala, Permintaan dan Area Penanganan</h3>
        <div class="tutorial-split"><div class="tutorial-callout issue"><b>Kendala / Incident</b><p>Sesuatu tidak bekerja seperti seharusnya: internet putus, aplikasi error, printer gagal, perangkat bermasalah.</p></div><div class="tutorial-callout request"><b>Permintaan / Service Request</b><p>Kebutuhan layanan/perubahan: instalasi aplikasi, akun baru, akses folder, onboarding perangkat, penambahan jaringan.</p></div></div>
        <div class="tutorial-note"><strong>Area Penanganan:</strong> pilih <b>IT</b> atau <b>Network</b>. Ini berbeda dengan Jenis Ticket. Area membantu routing ke PIC yang kompeten.</div>
      </section>

      <section id="priority-guide" class="tutorial-section"><span class="eyebrow">PRIORITY</span><h3>Membaca tingkat prioritas</h3>
        <div class="priority-guide-grid">
          <div><b>Critical</b><span>Gangguan luas/operasional utama berhenti atau dampak sangat tinggi.</span></div>
          <div><b>High</b><span>Dampak penting dan butuh penanganan cepat, tetapi operasional masih memiliki workaround terbatas.</span></div>
          <div><b>Medium</b><span>Dampak normal dengan urgensi menengah; mayoritas ticket harian berada di sini.</span></div>
          <div><b>Low</b><span>Permintaan minor, improvement atau pekerjaan yang dapat dijadwalkan.</span></div>
        </div>
        <p class="tutorial-note">Priority bukan “siapa yang paling penting”. Penetapannya mempertimbangkan <b>impact + urgency</b>. Guest dimulai sebagai Unassigned sampai triage.</p>
      </section>

      <section id="workflow" class="tutorial-section"><span class="eyebrow">WORKFLOW</span><h3>Arti status ticket</h3>
        <div class="workflow-guide"><div><b>Open</b><span>Ticket baru, menunggu proses.</span></div><i>→</i><div><b>In Progress</b><span>Sedang dikerjakan PIC.</span></div><i>→</i><div><b>Waiting User</b><span>Menunggu informasi/respons user.</span></div><i>→</i><div><b>Resolved</b><span>Pekerjaan selesai, menunggu konfirmasi.</span></div><i>→</i><div><b>Finished</b><span>Ticket ditutup.</span></div></div>
        <p class="tutorial-note"><b>Reopened</b> berarti hasil perlu ditindaklanjuti lagi. <b>Resolved - Awaiting Confirmation</b> berarti pekerjaan sudah dilakukan tetapi requester belum menyatakan selesai.</p>
      </section>

      <section id="estimate-guide" class="tutorial-section"><span class="eyebrow">ESTIMATION</span><h3>Cara membaca estimasi dan persentase</h3>
        <div class="tutorial-grid three">
          <article><span>A</span><h4>Estimasi Proses</h4><p>Perkiraan waktu untuk mulai/menangani ticket. Ditulis sebagai hari kerja, jam dan menit.</p></article>
          <article><span>B</span><h4>Target Selesai</h4><p>Target operasional indikatif penyelesaian. Sistem menampilkan tanggal target dan sisa/kelebihan waktu.</p></article>
          <article><span>C</span><h4>Aktual vs Target</h4><p>≤100% berarti rata-rata waktu aktual masih di dalam jatah estimasi. >100% berarti rata-rata melewati target.</p></article>
        </div>
        <div class="metric-definition-grid">
          <div><b>Sesuai Estimasi %</b><strong>Ticket on-time ÷ ticket bertarget</strong><p>Contoh 90% = 9 dari 10 ticket bertarget selesai sebelum/tepat target.</p></div>
          <div><b>Aktual / Target %</b><strong>Durasi aktual ÷ target estimasi</strong><p>Contoh 75% = rata-rata pekerjaan menggunakan 75% dari jatah waktu target.</p></div>
          <div><b>Aktif Overdue</b><strong>Ticket aktif yang sudah melewati target</strong><p>Ini backlog yang membutuhkan perhatian, bukan ticket yang sudah selesai.</p></div>
        </div>
        <p class="tutorial-note">Hari kerja saat ini melewati Sabtu/Minggu. Hari libur nasional belum dihitung otomatis. Estimasi adalah target monitoring operasional, bukan jaminan SLA kontraktual.</p>
      </section>

      <section id="resolution-guide" class="tutorial-section"><span class="eyebrow">RESOLUTION & FEEDBACK</span><h3>Dua mode penyelesaian</h3>
        <div class="tutorial-split"><div class="tutorial-callout"><b>User Confirm</b><p>Ticket menjadi Resolved - Awaiting Confirmation. User mengecek hasil, lalu memberi rating 1–5 bintang + feedback atau melakukan Reopen.</p></div><div class="tutorial-callout"><b>Self Confirm</b><p>Ticket langsung Finished. Cocok untuk pekerjaan internal/walk-in/maintenance yang tidak memerlukan validasi requester. Tidak menghasilkan rating.</p></div></div>
        <div class="tutorial-note"><b>Rating tidak mencakup semua ticket.</b> Ketika membaca analytics, lihat juga jumlah feedback agar nilai rating tidak ditafsirkan seolah-olah berasal dari seluruh ticket selesai.</div>
      </section>

      <section id="privacy-guide" class="tutorial-section"><span class="eyebrow">VISIBILITY & PRIVACY</span><h3>Public vs Private</h3>
        <div class="tutorial-split"><div class="tutorial-callout"><b>Public</b><p>Dapat dilihat seluruh user. Informasi kontak sensitif tetap dibatasi oleh API/tampilan sesuai hak akses.</p></div><div class="tutorial-callout"><b>Private</b><p>Hanya requester terkait dan staff yang memiliki akses operasional.</p></div></div>
        <p class="tutorial-note">Evidence sebaiknya relevan dengan pekerjaan dan tidak berisi password, OTP, secret key, atau informasi rahasia yang tidak diperlukan.</p>
      </section>

      <section id="analytics-guide" class="tutorial-section"><span class="eyebrow">ANALYTICS</span><h3>Arti grafik dan angka utama</h3>
        <div class="tutorial-grid three">
          <article><span>VOLUME</span><h4>Status, Jenis, Area, Priority</h4><p>Menjelaskan komposisi ticket. Persentasenya adalah share dari ticket pada filter aktif, bukan skor performa.</p></article>
          <article><span>WORKLOAD</span><h4>PIC & Solver</h4><p>PIC = penanggung jawab ticket. Solver = admin yang melakukan resolve. Workload menunjukkan volume, bukan kualitas.</p></article>
          <article><span>SPEED</span><h4>Rata-rata Selesai</h4><p>Menunjukkan durasi rata-rata penyelesaian. Bandingkan bersama priority/jenis ticket agar konteks tetap adil.</p></article>
          <article><span>TARGET</span><h4>Aktual vs Estimasi</h4><p>Batang aktual yang lebih pendek dari target berarti rata-rata selesai masih di dalam estimasi.</p></article>
          <article><span>CONSISTENCY</span><h4>On-time %</h4><p>Menunjukkan proporsi ticket bertarget yang selesai sesuai estimasi.</p></article>
          <article><span>QUALITY</span><h4>Rating User</h4><p>Menampilkan pengalaman user pada ticket User Confirm. Periksa jumlah feedback sebagai ukuran sampel.</p></article>
        </div>
      </section>

      ${publicRoleOverview}
      ${roleBlock}

      <section id="security-guide" class="tutorial-section"><span class="eyebrow">SECURITY & GOOD PRACTICE</span><h3>Praktik penggunaan yang aman</h3>
        <div class="tutorial-checklist">
          <div><b>Jangan lampirkan</b><span>Password</span><span>OTP</span><span>Secret/API key</span><span>Data sensitif yang tidak relevan</span></div>
          <div><b>Pastikan</b><span>Email akun aktif</span><span>Nomor kontak benar</span><span>Evidence relevan</span><span>Ticket tidak duplikat</span></div>
          <div><b>Untuk staff</b><span>Catatan progress objektif</span><span>Jaga audit trail</span><span>Gunakan visibility tepat</span><span>Resolve dengan mode tepat</span></div>
        </div>
      </section>

      <section id="faq-guide" class="tutorial-section"><span class="eyebrow">FAQ</span><h3>Pertanyaan umum</h3>
        <details><summary>Priority ditentukan dari apa?</summary><p>Dari kombinasi impact dan urgency. Guest dimulai sebagai Unassigned, kemudian ditentukan tim saat triage.</p></details>
        <details><summary>Apa arti sisa waktu estimasi?</summary><p>Sisa waktu dihitung terhadap target estimasi terakhir. Jika target terlewati, ticket aktif ditandai overdue.</p></details>
        <details><summary>Kenapa tidak semua ticket mendapat rating?</summary><p>Rating hanya tersedia pada User Confirm. Self Confirm langsung menutup ticket tanpa rating.</p></details>
        <details><summary>Apakah Public berarti kontak user terlihat semua orang?</summary><p>Tidak. Public berarti isi ticket dapat dilihat user, sedangkan informasi kontak sensitif tetap dibatasi sesuai hak akses.</p></details>
        <details><summary>Apa beda PIC dan Solver?</summary><p>PIC adalah pihak yang ditugaskan menangani. Solver adalah admin yang melakukan final resolve. Keduanya bisa sama atau berbeda.</p></details>
        <details><summary>Apa arti 100% pada grafik?</summary><p>Tergantung grafik. Pada komposisi berarti seluruh data pada filter berada di kategori itu; pada On-time berarti seluruh ticket eligible memenuhi target. Baca judul dan “Cara baca” di bawah grafik.</p></details>
        <details><summary>Siapa yang boleh melihat analytics?</summary><p>Administrator, Root Administrator dan Admin Supervisor. Supervisor bersifat read-only.</p></details>
      </section>
    </div>`;
}
async function renderTutorial(){
  $('#pageContent').innerHTML=commonTutorialHtml(ME?.role||'user');
}
function openPublicHelp(push=true){
  $('#authView')?.classList.add('hidden');
  $('#appView')?.classList.add('hidden');
  const hv=$('#helpView');if(!hv)return;
  hv.classList.remove('hidden');
  $('#publicHelpContent').innerHTML=commonTutorialHtml('public');
  if(push&&location.pathname!='/help')history.pushState({help:true},'', '/help');
  window.scrollTo({top:0,behavior:'smooth'});
}
function closePublicHelp(){
  $('#helpView')?.classList.add('hidden');
  if(ME){showApp();}
  else{$('#authView')?.classList.remove('hidden');$('#appView')?.classList.add('hidden');}
  if(location.pathname==='/help')history.pushState({},'', '/');
}
async function loadDirectory(){if(!isAdmin())return [];const d=await api('/api/admin/directory');DIRECTORY=d.users;return DIRECTORY;}
async function loadPicDirectory(){if(!isAdmin())return [];const d=await api('/api/admin/pics');PIC_DIRECTORY=d.pics||[];return PIC_DIRECTORY;}
function picOptionLabel(p){const team=p.supportType&&p.supportType!=='Both'?` · ${p.supportType}`:' · IT + Network';return p.type==='admin'?`${p.name} — ${p.department||'Admin'}${team}${p.key===`admin:${ME?.id}`?' (Saya sendiri)':''}`:`${p.name} — ${p.contact||'PIC Non-Admin'}${team}`;}
function formatDuration(mins){
  if(mins===null||mins===undefined||!Number.isFinite(Number(mins)))return '-';
  const n=Math.abs(Math.round(Number(mins)));
  if(n<60)return `${n} menit`;
  if(n<1440)return `${Math.floor(n/60)}j ${n%60?`${n%60}m`:''}`.trim();
  return `${Math.floor(n/1440)}h ${Math.floor((n%1440)/60)}j`;
}
function pct(part,total,digits=0){
  const p=Number(part||0),t=Number(total||0);
  if(!t)return 0;
  const v=p/t*100;
  return digits?Number(v.toFixed(digits)):Math.round(v);
}
function topBreakdown(items=[]){
  return [...items].sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0]||null;
}
function chartHelp(title,text,tip=''){
  return `<details class="chart-help"><summary><span>ⓘ</span> Cara baca</summary><div><b>${esc(title)}</b><p>${esc(text)}</p>${tip?`<small>${esc(tip)}</small>`:''}</div></details>`;
}
function analyticsReadingPanel(a,picName){
  const topPriority=topBreakdown(a.priorityDistribution||[]);
  const topStatus=topBreakdown(a.statusBreakdown||[]);
  const usage=a.estimateComparison?.usagePct;
  const onTime=a.onTimePct;
  const completePct=pct(a.completedCount,a.totalTickets);
  const ratingPct=a.avgRating===null?null:Math.round(Number(a.avgRating)/5*100);
  const onTimeLabel=onTime===null?'Belum cukup data':onTime>=90?'Konsisten terhadap target':onTime>=75?'Mayoritas sesuai target':'Perlu ditinjau lebih lanjut';
  const usageLabel=usage===null||usage===undefined?'Belum cukup data':usage<=80?'Rata-rata masih punya buffer':usage<=100?'Rata-rata masih dalam target':'Rata-rata melewati target';
  return `<div class="analytics-reading-panel">
    <div class="analytics-reading-head"><div><span class="eyebrow">CARA BACA CEPAT</span><h4>Ringkasan filter: ${esc(picName)}</h4></div><button type="button" class="btn ghost analytics-guide-btn" id="analyticsTutorialBtn">? Panduan Analytics</button></div>
    <div class="analytics-reading-grid">
      <div><span>Volume selesai</span><strong>${a.completedCount}/${a.totalTickets} · ${completePct}%</strong><small>${topStatus?`Status terbesar: ${topStatus.name} (${pct(topStatus.count,a.totalTickets)}%)`:'Belum ada data status.'}</small></div>
      <div><span>Kepatuhan estimasi</span><strong>${onTime===null?'-':onTime+'%'}</strong><small>${esc(onTimeLabel)}</small></div>
      <div><span>Pemakaian waktu target</span><strong>${usage===null||usage===undefined?'-':usage+'%'}</strong><small>${esc(usageLabel)} · ≤100% berarti masih dalam target rata-rata.</small></div>
      <div><span>Mix pekerjaan</span><strong>${topPriority?`${esc(topPriority.name)} ${pct(topPriority.count,a.totalTickets)}%`:'-'}</strong><small>Komposisi priority membantu memberi konteks saat membandingkan PIC.</small></div>
      <div><span>Feedback user</span><strong>${a.avgRating===null?'-':`${a.avgRating.toFixed(2)}/5 · ${ratingPct}%`}</strong><small>${a.ratingCount} feedback dari ${a.completedCount} resolved.</small></div>
    </div>
    <details class="analytics-howto"><summary>Istilah penting sebelum membandingkan PIC</summary><div class="analytics-howto-grid">
      <p><b>PIC</b><span>Penanggung jawab ticket. Workload PIC menunjukkan volume penugasan, bukan nilai kualitas.</span></p>
      <p><b>Solver</b><span>Admin yang melakukan resolve. PIC dan Solver dapat berbeda.</span></p>
      <p><b>On-time %</b><span>Ticket bertarget yang selesai sebelum/tepat target dibagi seluruh ticket bertarget.</span></p>
      <p><b>Aktual / Target %</b><span>Rata-rata durasi aktual dibanding jatah estimasi. 80% berarti memakai sekitar 80% waktu target.</span></p>
      <p><b>Rating</b><span>Hanya dari User Confirm. Self Confirm tidak menghasilkan rating.</span></p>
      <p><b>Perbandingan adil</b><span>Periksa periode, priority, jenis ticket, area dan jumlah sampel sebelum menyimpulkan.</span></p>
    </div></details>
  </div>`;
}
function countPctLabel(count,total){return `${Number(count||0)} · ${pct(count,total)}%`;}
function normalizeEstimatePartsClient(parts){
  const p=parts&&typeof parts==='object'?parts:{};
  return {days:Math.max(0,Math.floor(Number(p.days)||0)),hours:Math.max(0,Math.min(23,Math.floor(Number(p.hours)||0))),minutes:Math.max(0,Math.min(59,Math.floor(Number(p.minutes)||0)))};
}
function estimatePartsLabelClient(parts){
  const p=normalizeEstimatePartsClient(parts),out=[];
  if(p.days)out.push(`${p.days} hari kerja`);
  if(p.hours)out.push(`${p.hours} jam`);
  if(p.minutes)out.push(`${p.minutes} menit`);
  return out.join(' ')||'TBA';
}
function estimateEditor(prefix,parts,title,help){
  const p=normalizeEstimatePartsClient(parts);
  return `<div class="estimate-editor"><div class="estimate-editor-head"><div><span>${esc(title)}</span><strong id="${prefix}Label">${esc(estimatePartsLabelClient(p))}</strong></div><small>${esc(help)}</small></div><div class="estimate-units"><label>Hari kerja<input id="${prefix}Days" type="number" min="0" max="365" step="1" value="${p.days}"></label><label>Jam<input id="${prefix}Hours" type="number" min="0" max="23" step="1" value="${p.hours}"></label><label>Menit<input id="${prefix}Minutes" type="number" min="0" max="59" step="5" value="${p.minutes}"></label></div></div>`;
}
function readEstimateEditor(prefix){return normalizeEstimatePartsClient({days:$(`#${prefix}Days`)?.value,hours:$(`#${prefix}Hours`)?.value,minutes:$(`#${prefix}Minutes`)?.value});}
function syncEstimateEditor(prefix){const el=$(`#${prefix}Label`);if(el)el.textContent=estimatePartsLabelClient(readEstimateEditor(prefix));}
function estimateStatusHtml(t){
  const due=t.targetDueAt||t.estimateMeta?.targetDueAt;
  const rem=t.estimateMeta?.remainingMinutes ?? (due&&!['Finished','Resolved - Awaiting Confirmation'].includes(t.status)?Math.round((new Date(due)-Date.now())/60000):null);
  if(!due)return '<span class="estimate-chip neutral">Target: TBA</span>';
  if(['Finished','Resolved - Awaiting Confirmation'].includes(t.status)){
    if(!t.resolvedAt)return `<span class="estimate-chip done">Target ${fmtDate(due)}</span>`;
    const delta=Math.round((new Date(t.resolvedAt)-new Date(due))/60000);
    if(delta<=0)return `<span class="estimate-chip done">Selesai ${formatDuration(Math.abs(delta))} lebih cepat</span>`;
    return `<span class="estimate-chip overdue">Selesai lewat ${formatDuration(delta)}</span>`;
  }
  return rem>=0?`<span class="estimate-chip ok">Sisa estimasi ${formatDuration(rem)}</span>`:`<span class="estimate-chip overdue">Lewat estimasi ${formatDuration(rem)}</span>`;
}
function stars(rating=0){const n=Number(rating||0);return `<span class="stars" aria-label="${n} dari 5 bintang">${[1,2,3,4,5].map(i=>i<=n?'★':'☆').join('')}</span>`;}
function analyticsBars(items,valueKey='count',suffix=''){
  const max=Math.max(1,...items.map(x=>Number(x[valueKey]||0)));
  return items.map(x=>`<div class="analytics-bar-row"><div><b>${esc(x.name||x.priority||'-')}</b><span>${esc(String(x[valueKey]??0))}${suffix}</span></div><div class="analytics-track"><i style="width:${Math.max(3,Math.round(Number(x[valueKey]||0)/max*100))}%"></i></div></div>`).join('');
}
function analyticsDurationBars(items){
  const max=Math.max(1,...items.map(x=>Number(x.avgMinutes||0)));
  return items.map(x=>`<div class="analytics-bar-row"><div><b>${esc(x.name||'-')}</b><span>${formatDuration(x.avgMinutes)}</span></div><div class="analytics-track"><i style="width:${Math.max(3,Math.round(Number(x.avgMinutes||0)/max*100))}%"></i></div></div>`).join('');
}
function analyticsBarSvg(items,valueKey='count',formatter=null,opts={}){
  const rows=(items||[]).filter(x=>Number(x[valueKey])>0).slice(0,7);
  if(!rows.length)return '<div class="chart-empty">Belum ada data untuk ditampilkan.</div>';
  const width=560,height=Math.max(138,34+rows.length*24),left=126,right=72,top=12;
  const plotW=width-left-right,max=Math.max(1,...rows.map(x=>Number(x[valueKey])||0));
  const denominator=Number(opts.total)||rows.reduce((sum,x)=>sum+(Number(x[valueKey])||0),0);
  const parts=rows.map((x,i)=>{
    const y=top+i*24,val=Number(x[valueKey])||0,bw=Math.max(3,val/max*plotW);
    let out=formatter?formatter(val):String(val);
    if(opts.showPct)out=`${out} · ${pct(val,denominator)}%`;
    return `<text x="${left-9}" y="${y+13}" text-anchor="end" class="chart-label">${esc(x.name||x.priority||'-')}</text><rect x="${left}" y="${y+3}" width="${plotW}" height="11" rx="5.5" class="chart-track"/><rect x="${left}" y="${y+3}" width="${bw}" height="11" rx="5.5" class="chart-bar"/><text x="${Math.min(width-62,left+bw+8)}" y="${y+13}" class="chart-value">${esc(out)}</text>`;
  }).join('');
  return `<svg class="analytics-svg compact-bars" viewBox="0 0 ${width} ${height}" role="img">${parts}</svg>`;
}
function analyticsPriorityCompareSvg(items){
  const rows=(items||[]).filter(x=>x.priority!=='Unassigned'&&(Number(x.avgComparableActualMinutes||x.avgMinutes)>0||Number(x.avgEstimateMinutes)>0));
  if(!rows.length)return '<div class="chart-empty">Belum ada ticket selesai dengan estimasi.</div>';
  const width=720,height=190,left=62,right=18,top=30,bottom=40,plotW=width-left-right,plotH=height-top-bottom;
  const max=Math.max(1,...rows.flatMap(x=>[Number(x.avgComparableActualMinutes||x.avgMinutes)||0,Number(x.avgEstimateMinutes)||0]));
  const groupW=plotW/rows.length,barW=Math.min(30,groupW*.25);
  const y=v=>top+plotH-(Number(v)||0)/max*plotH;
  const grid=[0,.25,.5,.75,1].map(r=>`<line x1="${left}" y1="${top+plotH*r}" x2="${left+plotW}" y2="${top+plotH*r}" class="chart-grid"/>`).join('');
  const bars=rows.map((x,i)=>{const actual=Number(x.avgComparableActualMinutes||x.avgMinutes)||0,target=Number(x.avgEstimateMinutes)||0,cx=left+groupW*i+groupW/2;const ah=plotH*actual/max,th=plotH*target/max;return `<rect x="${cx-barW-3}" y="${y(actual)}" width="${barW}" height="${ah}" rx="4" class="chart-bar actual"/><rect x="${cx+3}" y="${y(target)}" width="${barW}" height="${th}" rx="4" class="chart-bar target"/><text x="${cx}" y="${height-14}" text-anchor="middle" class="chart-axis">${esc(x.priority)}</text><text x="${cx-barW/2-3}" y="${Math.max(14,y(actual)-5)}" text-anchor="middle" class="chart-mini-value">${esc(formatDuration(actual))}</text><text x="${cx+barW/2+3}" y="${Math.max(14,y(target)-5)}" text-anchor="middle" class="chart-mini-value target">${esc(formatDuration(target))}</text>`;}).join('');
  return `<div class="chart-legend-inline"><span><i class="legend-actual"></i>Aktual</span><span><i class="legend-target"></i>Target estimasi</span></div><svg class="analytics-svg priority-compare-svg" viewBox="0 0 ${width} ${height}" role="img">${grid}${bars}</svg>`;
}
function analyticsPriorityPercentBars(items){
  const rows=(items||[]).filter(x=>x.priority!=='Unassigned'&&x.withinEstimatePct!==null);
  if(!rows.length)return '<div class="chart-empty">Belum ada data persentase estimasi.</div>';
  return `<div class="priority-percent-list">${rows.map(x=>{const pct=Math.max(0,Math.min(100,Number(x.withinEstimatePct)||0));const usage=x.estimateUsagePct;const usageText=usage===null?'':usage<=100?`${usage}% waktu target terpakai`:`${usage}% dari target`;return `<div class="priority-percent-row"><div class="priority-percent-head"><b>${esc(x.priority)}</b><span>${pct}% tepat estimasi</span></div><div class="priority-percent-track"><i style="width:${pct}%"></i></div><small>${x.withinCount||0}/${x.eligibleCount||0} ticket · ${esc(usageText)}</small></div>`;}).join('')}</div>`;
}

function analyticsLineSvg(rows){
  const data=(rows||[]).slice(-31);
  if(!data.length)return '<div class="chart-empty">Belum ada tren aktivitas.</div>';
  const width=760,height=178,left=40,right=22,top=24,bottom=32,plotW=width-left-right,plotH=height-top-bottom;
  const max=Math.max(1,...data.flatMap(x=>[Number(x.created)||0,Number(x.resolved)||0]));
  const x=i=>left+(data.length===1?plotW/2:i/(data.length-1)*plotW),y=v=>top+plotH-(Number(v)||0)/max*plotH;
  const poly=key=>data.map((d,i)=>`${x(i)},${y(d[key])}`).join(' ');
  const grid=[0,.25,.5,.75,1].map(r=>`<line x1="${left}" y1="${top+plotH*r}" x2="${left+plotW}" y2="${top+plotH*r}" class="chart-grid"/>`).join('');
  const labels=data.map((d,i)=>{const show=data.length<=8||i===0||i===data.length-1||i===Math.floor(data.length/2);return show?`<text x="${x(i)}" y="${height-14}" text-anchor="middle" class="chart-axis">${esc(String(d.date).slice(5))}</text>`:'';}).join('');
  return `<svg class="analytics-svg" viewBox="0 0 ${width} ${height}" role="img">${grid}<polyline points="${poly('created')}" fill="none" class="chart-line created"/><polyline points="${poly('resolved')}" fill="none" class="chart-line resolved"/>${data.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d.created)}" r="3.5" class="chart-dot created"/><circle cx="${x(i)}" cy="${y(d.resolved)}" r="3.5" class="chart-dot resolved"/>`).join('')}${labels}<g transform="translate(${left},10)"><circle cx="0" cy="0" r="4" class="chart-dot created"/><text x="9" y="4" class="chart-axis">Dibuat</text><circle cx="80" cy="0" r="4" class="chart-dot resolved"/><text x="89" y="4" class="chart-axis">Resolve</text></g></svg>`;
}
function analyticsDonut(items,centerLabel='ticket'){
  const data=(items||[]).filter(x=>Number(x.count)>0),total=data.reduce((s,x)=>s+Number(x.count||0),0);
  if(!total)return '<div class="chart-empty">Belum ada data untuk ditampilkan.</div>';
  const palette=['#1f6fbd','#14a4c7','#58a77b','#f0a63a','#9b72cf','#d66161'];let at=0;
  const stops=data.map((x,i)=>{const start=at;at+=Number(x.count)/total*100;return `${palette[i%palette.length]} ${start}% ${at}%`;}).join(',');
  return `<div class="donut-layout compact"><div class="donut-chart" style="background:conic-gradient(${stops})"><div><strong>${total}</strong><span>${esc(centerLabel)}</span></div></div><div class="donut-legend">${data.map((x,i)=>`<div><i style="background:${palette[i%palette.length]}"></i><span>${esc(x.name)}</span><b>${Number(x.count)} <small>${pct(x.count,total)}%</small></b></div>`).join('')}</div></div>`;
}


async function renderDashboard(){
  const params=new URLSearchParams({timeframe:DASHBOARD_TIMEFRAME});
  if(isStaffView()&&DASHBOARD_PIC!=='All')params.set('pic',DASHBOARD_PIC);
  const ticketParams=new URLSearchParams({sort:'updated_desc'});
  if(isStaffView()&&DASHBOARD_PIC!=='All')ticketParams.set('pic',DASHBOARD_PIC);
  const jobs=[api('/api/dashboard?'+params.toString()),api('/api/tickets?'+ticketParams.toString()),isStaffView()?api('/api/admin/report-options'):Promise.resolve({pics:[],solvers:[],creators:[]}),isRoot()?api('/api/root/accounts'):Promise.resolve(null)];
  const [d,t,reportOpts,accounts]=await Promise.all(jobs);const s=d.stats,a=d.analytics;
  const pending=accounts?.users?.filter(u=>u.role==='user'&&u.status==='pending_approval').length||0;
  const totalForPct=Math.max(0,Number(s.total||0));
  const cards=[
    ['Total',s.total,ME.role==='user'?'Ticket milik saya + public':'Ticket sesuai filter'],
    ['Open',s.open,`${pct(s.open,totalForPct)}% · menunggu diproses`],
    ['In Progress',s.inProgress,`${pct(s.inProgress,totalForPct)}% · sedang dikerjakan`],
    ['Need Confirm',s.resolved,`${pct(s.resolved,totalForPct)}% · menunggu user`],
    ['Finished',s.finished,`${pct(s.finished,totalForPct)}% · sudah selesai`]
  ];
  if(isRoot())cards.push(['Pending Account',pending,'Butuh approval']);
  const storage=isStaffView()?`<section class="storage-card"><div><span class="eyebrow light">STORAGE EFFICIENCY</span><h3>${fmtBytes(s.savedBytes)} berhasil dihemat</h3><p>${s.evidenceFiles} evidence · original ${fmtBytes(s.originalBytes)} → tersimpan ${fmtBytes(s.storedBytes)}</p></div><div class="storage-ring"><strong>${s.originalBytes?Math.round((s.savedBytes/s.originalBytes)*100):0}%</strong><span>saving</span></div></section>`:'';
  const picFilter=isStaffView()?`<label class="analytics-period">PIC<select id="dashboardPic"><option value="All">Semua PIC</option>${(reportOpts.pics||[]).map(x=>`<option value="${esc(x.key)}" ${DASHBOARD_PIC===x.key?'selected':''}>${esc(x.name)}</option>`).join('')}</select></label>`:'';
  const selectedPicName=DASHBOARD_PIC==='All'?'Semua PIC':(reportOpts.pics||[]).find(x=>x.key===DASHBOARD_PIC)?.name||'PIC terpilih';
  const analytics=a?`<section class="section-card analytics-section compact-analytics">
    <div class="section-head analytics-head">
      <div>
        <span class="eyebrow">SUPERVISOR ANALYTICS</span>
        <h3>Analytics Ticket & Kinerja PIC</h3>
        <p>Ringkas, bisa difilter PIC, dan membedakan <b>Kendala</b> vs <b>Permintaan</b> serta area penanganan IT/Network.</p>
      </div>
      <div class="analytics-filter-row">
        <label class="analytics-period">Periode<select id="dashboardPeriod"><option value="all" ${DASHBOARD_TIMEFRAME==='all'?'selected':''}>Keseluruhan</option><option value="daily" ${DASHBOARD_TIMEFRAME==='daily'?'selected':''}>Hari Ini</option><option value="weekly" ${DASHBOARD_TIMEFRAME==='weekly'?'selected':''}>7 Hari</option><option value="monthly" ${DASHBOARD_TIMEFRAME==='monthly'?'selected':''}>30 Hari</option></select></label>
        ${picFilter}
      </div>
    </div>
    <div class="analytics-context"><b>${esc(selectedPicName)}</b><span> · ${a.totalTickets} ticket pada filter aktif</span></div>
    ${analyticsReadingPanel(a,selectedPicName)}
    <div class="analytics-kpis compact">
      <div><span>Rata-rata Selesai</span><strong>${formatDuration(a.avgResolutionMinutes)}</strong><small>${a.completedCount} resolved · ${pct(a.completedCount,a.totalTickets)}% dari ticket</small></div>
      <div><span>Sesuai Estimasi</span><strong>${a.onTimePct===null?'-':a.onTimePct+'%'}</strong><small>${a.estimateComparison?.usagePct!==null&&a.estimateComparison?.usagePct!==undefined?`${a.estimateComparison.usagePct}% waktu target terpakai`:`${a.estimateComparison?.eligible||0} bertarget`}</small></div>
      <div><span>Rating User</span><strong>${a.avgRating===null?'-':a.avgRating.toFixed(2)+' / 5'}</strong><small>${a.avgRating===null?'-':`${Math.round(a.avgRating/5*100)}% score`} · ${a.ratingCount} feedback (${pct(a.ratingCount,a.completedCount)}%)</small></div>
      <div><span>Aktif Overdue</span><strong>${a.overdueActive}</strong><small>${pct(a.overdueActive,Math.max(0,a.totalTickets-a.completedCount))}% dari ticket aktif · ${a.overdueProcessStart||0} telat mulai</small></div>
      <div><span>Kendala</span><strong>${a.requestKinds?.find(x=>x.name==='Kendala')?.count||0}</strong><small>${pct(a.requestKinds?.find(x=>x.name==='Kendala')?.count||0,a.totalTickets)}% · incident/problem</small></div>
      <div><span>Permintaan</span><strong>${a.requestKinds?.find(x=>x.name==='Permintaan')?.count||0}</strong><small>${pct(a.requestKinds?.find(x=>x.name==='Permintaan')?.count||0,a.totalTickets)}% · service request</small></div>
    </div>

    <div class="analytics-visual-grid dense">
      <div class="analytics-card chart-card trend-card"><div class="chart-title"><div><h4>Tren Ticket</h4><p class="muted">Dibuat vs selesai per hari.</p></div></div>${analyticsLineSvg(a.activityTrend||[])}${chartHelp('Tren Ticket','Garis Dibuat menunjukkan ticket masuk per hari; garis Resolve menunjukkan ticket yang selesai. Jika ticket masuk terus lebih tinggi daripada resolve, backlog berpotensi bertambah.','Gunakan tren bersama jumlah Open/In Progress, bukan garis ini saja.')}</div>
      <div class="analytics-card chart-card"><h4>Status Ticket</h4><p class="muted">Nilai dan persentase tiap status.</p>${analyticsDonut(a.statusBreakdown||[])}${chartHelp('Status Ticket','Persentase menunjukkan porsi ticket pada filter yang berada di tiap status. Finished tinggi berarti banyak ticket sudah ditutup; Open/In Progress menunjukkan antrean aktif.','Ini komposisi status, bukan skor performa.')}</div>
      <div class="analytics-card chart-card"><h4>Jenis Ticket</h4><p class="muted">Kendala vs permintaan layanan.</p>${analyticsDonut(a.requestKinds||[])}${chartHelp('Jenis Ticket','Menunjukkan share Kendala/Incident dan Permintaan/Service Request. Komposisi ini membantu membaca beban kerja karena sifat pekerjaannya berbeda.','Jangan membandingkan durasi PIC tanpa melihat mix jenis ticket.')}</div>
      <div class="analytics-card chart-card"><h4>Area Penanganan</h4><p class="muted">Pembagian IT dan Network.</p>${analyticsDonut(a.issueTypes||[])}${chartHelp('Area Penanganan','Persentase menunjukkan pembagian ticket IT dan Network pada filter. Area ini dipakai untuk routing PIC dan memberi konteks ke workload.','PIC Network dan IT sebaiknya dibandingkan pada pekerjaan yang sebanding.')}</div>
      <div class="analytics-card chart-card"><h4>Priority</h4><p class="muted">Nilai dan persentase tingkat prioritas.</p>${analyticsDonut(a.priorityDistribution||[])}${chartHelp('Priority','Menunjukkan berapa persen ticket Critical, High, Medium dan Low. Priority memberi konteks tingkat urgensi/impact, bukan nilai kualitas PIC.','PIC dengan mix Critical/High lebih besar dapat memiliki rata-rata durasi berbeda.')}</div>
      <div class="analytics-card chart-card priority-compare-card"><h4>Rata-rata Selesai vs Estimasi per Priority</h4><p class="muted">Membandingkan rata-rata aktual sejak estimasi ditetapkan dengan target tiap priority.</p>${analyticsPriorityCompareSvg(a.byPriority||[])}${chartHelp('Aktual vs Estimasi','Biru tua = rata-rata waktu aktual; biru muda = rata-rata target. Jika batang aktual lebih pendek dari target, rata-rata selesai masih di dalam estimasi.','Lihat jumlah ticket per priority pada tabel detail agar sample size jelas.')}</div>
      <div class="analytics-card chart-card"><h4>Sesuai Estimasi per Priority</h4><p class="muted">Persentase ticket yang selesai sebelum / tepat target.</p>${analyticsPriorityPercentBars(a.byPriority||[])}${chartHelp('Sesuai Estimasi','100% berarti seluruh ticket bertarget pada priority tersebut selesai sebelum/tepat target. Angka di bawah bar menunjukkan jumlah on-time/eligible dan pemakaian waktu target.','Persentase tinggi dengan 1 ticket berbeda makna dengan persentase sama dari puluhan ticket.')}</div>
      <div class="analytics-card chart-card"><h4>Visibility</h4><p class="muted">Ticket public dan private.</p>${analyticsDonut(a.visibilityBreakdown||[])}${chartHelp('Visibility','Menunjukkan share ticket Public dan Private. Public dapat dilihat semua user; Private dibatasi ke requester terkait dan staff.','Visibility tidak menunjukkan performa.')}</div>
      <div class="analytics-card chart-card"><h4>Workload PIC</h4><p class="muted">Nilai + persentase seluruh ticket pada filter.</p>${analyticsBarSvg(a.picWorkload||[],'count',null,{showPct:true,total:a.totalTickets})}${chartHelp('Workload PIC','Jumlah dan share ticket yang ditugaskan ke masing-masing PIC. Ini berguna untuk melihat pembagian beban kerja.','Workload lebih tinggi tidak otomatis berarti performa lebih baik atau buruk.')}</div>
      <div class="analytics-card chart-card"><h4>Kecepatan per PIC</h4><p class="muted">Rata-rata durasi ticket selesai.</p>${analyticsBarSvg(a.picWorkload||[],'avgMinutes',v=>formatDuration(v))}${chartHelp('Kecepatan per PIC','Menampilkan rata-rata durasi ticket yang sudah selesai. Secara umum durasi lebih kecil berarti lebih cepat, tetapi harus dibaca bersama priority, jenis ticket, area dan jumlah ticket.','Gunakan filter PIC atau tabel detail untuk validasi konteks.')}</div>
      <div class="analytics-card chart-card"><h4>Kepatuhan Estimasi per PIC</h4><p class="muted">On-time % dan pemakaian waktu target per PIC.</p><div class="priority-percent-list">${(a.picWorkload||[]).filter(x=>x.eligibleCount>0).slice(0,7).map(x=>`<div class="priority-percent-row"><div class="priority-percent-head"><b>${esc(x.name)}</b><span>${x.withinEstimatePct}% on-time</span></div><div class="priority-percent-track"><i style="width:${Math.max(0,Math.min(100,x.withinEstimatePct||0))}%"></i></div><small>${x.withinCount}/${x.eligibleCount} tepat target · ${x.estimateUsagePct===null?'-':x.estimateUsagePct+'%'} waktu target terpakai</small></div>`).join('')||'<div class="chart-empty">Belum ada PIC dengan ticket selesai bertarget.</div>'}</div>${chartHelp('Kepatuhan per PIC','On-time % menunjukkan konsistensi memenuhi target. Pemakaian waktu target menunjukkan rata-rata porsi estimasi yang digunakan.','Bandingkan jumlah eligible serta mix priority agar interpretasi PIC lebih adil.')}</div>
      <div class="analytics-card chart-card"><h4>Solver / Penyelesai</h4><p class="muted">Nilai + persentase dari ticket resolved.</p>${analyticsBarSvg(a.solverWorkload||[],'count',null,{showPct:true,total:a.completedCount})}${chartHelp('Solver / Penyelesai','Menunjukkan siapa yang melakukan final resolve. Solver bisa berbeda dari PIC apabila penyelesaian/final check dilakukan admin lain yang berwenang.','Gunakan bersama Workload PIC untuk melihat ownership vs final resolution.')}</div>
      <div class="analytics-card chart-card"><h4>Rating User</h4><p class="muted">Distribusi feedback 1–5 bintang.</p>${analyticsDonut(a.ratingDistribution||[],'rating')}${chartHelp('Rating User','Distribusi 1–5 bintang hanya berasal dari ticket yang ditutup dengan User Confirm dan benar-benar diberi feedback.','Selalu lihat jumlah feedback; Self Confirm tidak masuk rating.')}</div>
      <div class="analytics-card chart-card"><h4>Kesehatan Estimasi</h4><p class="muted">On-time, terlambat, dan aktif overdue.</p>${analyticsDonut(a.estimateHealth||[])}${chartHelp('Kesehatan Estimasi','Membedakan ticket selesai sesuai target, selesai terlambat, dan ticket aktif yang sudah overdue. Aktif overdue adalah backlog yang masih perlu perhatian.','Ticket tanpa target tidak dihitung sebagai on-time/late.')}</div>
      <div class="analytics-card chart-card"><h4>Mode Penyelesaian</h4><p class="muted">User Confirm vs Self Confirm.</p>${analyticsDonut(a.resolutionModes||[])}${chartHelp('Mode Penyelesaian','User Confirm menunggu validasi requester dan dapat menghasilkan rating. Self Confirm langsung Finished dan tidak menghasilkan rating.','Share Self Confirm tinggi dapat membuat jumlah feedback lebih sedikit.')}</div>
    </div>

    <details class="analytics-details">
      <summary>Lihat tabel detail performance</summary>
      <div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th>Priority</th><th>Ticket Selesai</th><th>% dari Selesai</th><th>Rata-rata Selesai</th><th>Rata-rata Target</th><th>Aktual / Target</th><th>Sesuai Estimasi</th></tr></thead><tbody>${(a.byPriority||[]).map(x=>`<tr><td>${badgePriority(x.priority)}</td><td>${x.count}</td><td>${pct(x.count,a.completedCount)}%</td><td>${x.count?formatDuration(x.avgMinutes):'-'}</td><td>${x.avgEstimateMinutes?formatDuration(x.avgEstimateMinutes):'-'}</td><td>${x.estimateUsagePct===null?'-':`${x.estimateUsagePct}%${x.estimateUsagePct<=100?' ✓':' ⚠'}`}</td><td>${x.withinEstimatePct===null?'-':`${x.withinEstimatePct}% (${x.withinCount}/${x.eligibleCount})`}</td></tr>`).join('')}</tbody></table></div>
      <div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th>PIC</th><th>Total Handle</th><th>Share</th><th>Resolved</th><th>Completion %</th><th>Rata-rata Selesai</th><th>On-time %</th><th>Aktual / Target</th><th>Rating User</th></tr></thead><tbody>${(a.picWorkload||[]).slice(0,12).map(x=>`<tr><td><b>${esc(x.name)}</b></td><td>${x.count}</td><td>${pct(x.count,a.totalTickets)}%</td><td>${x.resolvedCount??0}</td><td>${x.completionPct??0}%</td><td>${x.avgMinutes?formatDuration(x.avgMinutes):'-'}</td><td>${x.withinEstimatePct===null?'-':x.withinEstimatePct+'%'}</td><td>${x.estimateUsagePct===null?'-':x.estimateUsagePct+'%'}</td><td>${x.avgRating===null?'-':`${stars(Math.round(x.avgRating))} ${x.avgRating.toFixed(2)} / 5 · ${Math.round(x.avgRating/5*100)}% (${x.ratingCount})`}</td></tr>`).join('')}</tbody></table></div>
    </details>
  </section>`:'';
  const quick=ME.role==='supervisor'?'':`<button class="btn light" id="quickTicket">＋ Buat Ticket</button>`;
  $('#pageContent').innerHTML=`<section class="welcome-card"><div><span class="eyebrow light">SERVICE DESK OVERVIEW</span><h2>Halo, ${esc(ME.name)}.</h2><p>${ME.role==='user'?'Pantau ticket sendiri, ticket public, estimasi pengerjaan, dan konfirmasi hasil pekerjaan dari sini.':ME.role==='supervisor'?'Pantau workload, performa penyelesaian, estimasi, rating user, dan distribusi PIC secara read-only.':'Kelola antrean, PIC, estimasi, evidence, solver, dan reporting dari satu dashboard.'}</p></div>${quick}</section><div class="stats-grid">${cards.map(c=>`<div class="stat-card"><span>${c[0]}</span><strong>${c[1]}</strong><small>${c[2]}</small></div>`).join('')}</div>${analytics}${storage}<section class="section-card"><div class="section-head"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>Ticket Terbaru${isStaffView()&&DASHBOARD_PIC!=='All'?` · ${esc(selectedPicName)}`:''}</h3></div><button class="btn secondary" id="seeAll">Lihat Semua</button></div><div class="ticket-list">${renderTicketCards(t.tickets.slice(0,6))||'<div class="empty-state"><h3>Belum ada ticket</h3><p>Ticket baru akan tampil di sini.</p></div>'}</div></section>`;
  if($('#quickTicket'))$('#quickTicket').onclick=()=>navigate('new');$('#seeAll').onclick=()=>navigate('tickets');bindTicketButtons();
  if($('#dashboardPeriod'))$('#dashboardPeriod').onchange=e=>{DASHBOARD_TIMEFRAME=e.target.value;renderDashboard();};
  if($('#dashboardPic'))$('#dashboardPic').onchange=e=>{DASHBOARD_PIC=e.target.value;renderDashboard();};
  if($('#analyticsTutorialBtn'))$('#analyticsTutorialBtn').onclick=async()=>{await navigate('tutorial');setTimeout(()=>$('#analytics-guide')?.scrollIntoView({behavior:'smooth',block:'start'}),50);};
}
function renderTicketCards(list){
  return list.map(t=>`<article class="ticket-card"><div class="ticket-main"><div class="ticket-topline"><strong>${esc(t.id)}</strong>${badgePriority(t.priority)}${badgeStatus(t.status)}<span class="badge ${t.requestKind==='Request'?'purple':'gray'}">${esc(requestKindLabel(t.requestKind))}</span><span class="badge ${t.issueType==='Network'?'orange':'blue'}">${esc(t.issueType||'IT')}</span><span class="badge ${t.isPublic?'green':'gray'}">${t.isPublic?'Public':'Private'}</span></div><h4>${esc(t.title)}</h4><p>${esc(t.requester?.name||'-')} · ${esc(t.requester?.department||'-')} · ${esc(t.category)}</p><div class="ticket-meta"><span>👤 PIC: ${esc(t.assignedTo?.name||'Belum ditentukan')}</span><span>⏱ Estimasi proses: ${esc(t.estimatedProcessing||'TBA')}</span><span>🏁 Target estimasi selesai: ${esc(t.estimatedCompletion||'TBA')}</span><span>${estimateStatusHtml(t)}</span><span>📎 ${(t.evidence||[]).length+(t.resolutionEvidence||[]).length} file</span>${t.feedback?.rating?`<span>${stars(t.feedback.rating)}</span>`:''}</div></div><div class="ticket-side"><small>Update</small><b>${fmtDate(t.updatedAt||t.createdAt)}</b><button class="btn secondary detail-btn" data-id="${esc(t.id)}">Detail</button></div></article>`).join('');
}
function bindTicketButtons(){$$('.detail-btn').forEach(b=>b.onclick=()=>showTicket(b.dataset.id));}

async function renderTickets(){
  let opts={pics:[],solvers:[],creators:[]};
  if(isStaffView())opts=await api('/api/admin/report-options');
  const advanced=isStaffView()?`<select id="tPic"><option value="All">Semua PIC</option>${opts.pics.map(x=>`<option value="${esc(x.key)}">PIC: ${esc(x.name)}</option>`).join('')}</select><select id="tCreator"><option value="All">Semua Created By</option>${opts.creators.map(x=>`<option value="${esc(x.key)}">Creator: ${esc(x.name)}</option>`).join('')}</select><select id="tSolver"><option value="All">Semua Solver</option>${opts.solvers.map(x=>`<option value="${esc(x.key)}">Solver: ${esc(x.name)}</option>`).join('')}</select><select id="tKind"><option value="All">Semua Jenis Ticket</option><option value="Issue">Kendala</option><option value="Request">Permintaan</option></select><select id="tIssue"><option value="All">Semua Area</option><option>IT</option><option>Network</option></select><select id="tVisibility"><option value="All">Semua Visibility</option><option value="Public">Public</option><option value="Private">Private</option></select><label class="date-filter">Dari<input id="tFrom" type="date"></label><label class="date-filter">Sampai<input id="tTo" type="date"></label>`:`<select id="tKind"><option value="All">Semua Jenis Ticket</option><option value="Issue">Kendala</option><option value="Request">Permintaan</option></select>`;
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">TICKET MONITORING</span><h3>${ME.role==='user'?'Ticket Saya & Ticket Public':'Semua Ticket'}</h3><p>${ME.role==='user'?'Ticket private hanya terlihat oleh pemilik dan staff. Ticket public dapat dilihat semua user.':'Pencarian mencakup ID, requester, creator, PIC, solver, judul, deskripsi, email, dan nomor telepon.'}</p></div></div><div class="filter-grid${isStaffView()?' advanced-filter':''}"><input id="tQ" placeholder="Cari ticket, user, PIC, solver..."><select id="tTime"><option value="all">Keseluruhan</option><option value="daily">Hari Ini</option><option value="weekly">7 Hari</option></select><select id="tStatus"><option>All</option>${STATUSES.map(x=>`<option>${x}</option>`)}</select><select id="tPriority"><option>All</option>${ALL_PRIORITIES.map(x=>`<option>${x}</option>`)}</select><select id="tCategory"><option>All</option>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select><select id="tSort"><option value="updated_desc">Update Terbaru</option><option value="created_desc">Dibuat Terbaru</option><option value="created_asc">Paling Lama</option><option value="priority_desc">Priority Tertinggi</option></select>${advanced}</div><div id="ticketCount" class="result-count"></div><div id="ticketsList" class="ticket-list"></div></section>`;
  let timer;
  async function load(){
    const params={q:$('#tQ').value,timeframe:$('#tTime').value,status:$('#tStatus').value,priority:$('#tPriority').value,category:$('#tCategory').value,sort:$('#tSort').value,requestKind:$('#tKind').value};
    if(isStaffView())Object.assign(params,{pic:$('#tPic').value,creator:$('#tCreator').value,solver:$('#tSolver').value,issueType:$('#tIssue').value,visibility:$('#tVisibility').value,dateFrom:$('#tFrom').value,dateTo:$('#tTo').value});
    const d=await api('/api/tickets?'+new URLSearchParams(params));$('#ticketCount').textContent=`${d.tickets.length} ticket ditemukan`;$('#ticketsList').innerHTML=renderTicketCards(d.tickets)||'<div class="empty-state"><h3>Tidak ada ticket</h3><p>Coba ubah filter atau kata pencarian.</p></div>';bindTicketButtons();
  }
  const ids=['tTime','tStatus','tPriority','tCategory','tSort','tKind',...(isStaffView()?['tPic','tCreator','tSolver','tIssue','tVisibility','tFrom','tTo']:[])];ids.forEach(id=>$(`#${id}`).onchange=load);$('#tQ').oninput=()=>{clearTimeout(timer);timer=setTimeout(load,250);};await load();
}

async function renderNewTicket(){
  if(ME.role==='supervisor')throw new Error('Admin Supervisor bersifat read-only dan tidak dapat membuat ticket.');
  if(isAdmin()){await loadDirectory();await loadPicDirectory();}
  const activeUsers=DIRECTORY.filter(u=>u.role==='user'&&u.status==='active');createQueue=[];
  const picOptions=PIC_DIRECTORY.map(p=>`<option value="${esc(p.key)}" data-support="${esc(p.supportType||'Both')}" ${p.key===`admin:${ME.id}`?'selected':''}>${esc(picOptionLabel(p))}</option>`).join('');
  $('#pageContent').innerHTML=`<div class="ticket-create-grid"><section class="section-card"><div class="section-head"><div><span class="eyebrow">CREATE TICKET</span><h3>Detail Ticket</h3><p>Ticket dapat berupa <b>Kendala</b> atau <b>Permintaan</b>. Area penanganan tetap dibagi menjadi <b>IT</b> atau <b>Network</b> untuk routing PIC.</p></div></div><form id="ticketForm" class="form-grid two">
    ${isAdmin()?`<label class="span-2">Requester<select id="requesterMode" name="requesterUserId"><option value="">Walk-in / Manual</option><option value="__self__">Saya sendiri — ${esc(ME.department||'-')}</option>${activeUsers.map(u=>`<option value="${u.id}">${esc(u.name)} — ${esc(u.department)}</option>`)}</select><small>Created By tetap tercatat sebagai ${esc(ME.name)}.</small></label><div id="manualRequester" class="span-2 form-grid two"><label>Nama Requester<input name="manualName" placeholder="Nama user yang datang langsung"></label><label>Bagian<input name="manualDepartment"></label><label>Email<input name="manualEmail" type="email"></label><label>No. Telepon<input name="manualPhone"></label></div>`:''}
    <label>Jenis Ticket<select name="requestKind" id="requestKindSelect"><option value="Issue">Kendala / Incident</option><option value="Request">Permintaan / Service Request</option></select><small>Kendala = sesuatu bermasalah; Permintaan = kebutuhan layanan/perubahan.</small></label>
    <label>Area Penanganan<select name="issueType" id="issueTypeSelect"><option value="IT">IT</option><option value="Network">Network</option></select><small>Menentukan tim/PIC yang dapat menangani.</small></label>
    <label>Kategori<select name="category" required>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select></label>
    ${isAdmin()?`<label class="span-2">PIC Awal<select name="assignedPicKey" id="newTicketPic"><option value="">Belum ditentukan</option>${picOptions}</select><small id="picRoutingHint">PIC yang tidak sesuai area penanganan akan disembunyikan untuk Admin biasa. Root Admin dapat override.</small></label><label class="span-2 checkbox-card"><input type="checkbox" name="isPublic" value="true"><span><b>Ticket Public</b><small>Jika aktif, semua user dapat melihat ticket ini. Kontak requester tetap disembunyikan untuk user lain.</small></span></label>`:''}
    <label class="span-2">Judul Ticket<input name="title" id="ticketTitleInput" required placeholder="Contoh: Tidak dapat mengakses Wi-Fi kantor"></label><label>Priority<select name="priority" id="prioritySelect">${PRIORITIES.map(x=>`<option ${x==='Medium'?'selected':''}>${x}</option>`)}</select></label><label>Lokasi / Area<input name="location" placeholder="Lantai, ruang, lokasi kerja"></label><label>Perangkat / Asset<input name="asset" placeholder="Hostname / asset tag (opsional)"></label><label class="span-2">Impact / Tujuan<input name="impact" id="ticketImpactInput" placeholder="Contoh: 5 user terdampak / kebutuhan onboarding user baru"></label><label class="span-2">Detail Ticket<textarea name="description" id="ticketDescriptionInput" rows="6" required placeholder="Jelaskan kendala atau kebutuhan secara singkat dan jelas."></textarea></label>
    <div class="span-2 estimate-panel"><div><span>Estimasi waktu mulai/proses</span><strong id="estProcess">1 hari kerja</strong><small>Perkiraan waktu untuk mulai/menangani proses.</small></div><div><span>Target estimasi penyelesaian</span><strong id="estCompletion">2 hari kerja</strong><small>Target indikatif sejak estimasi ditetapkan, bukan jaminan SLA kontraktual.</small></div><small class="estimate-note">Estimasi disimpan sebagai angka terstruktur <b>hari kerja + jam + menit</b>. Hari kerja menjadi satuan utama dan melewati Sabtu/Minggu; jam/menit dipakai untuk target yang lebih presisi. Sistem menampilkan target waktu, sisa estimasi, serta aktual vs target.</small></div>
    <div class="span-2"><div class="upload-zone" id="uploadZone"><input type="file" id="evidenceInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><div class="upload-icon">⇧</div><strong>Drop file di sini atau pilih hingga 10 file</strong><span>5 MB/file · dapat memilih file beberapa kali · gambar dikompres otomatis di server</span></div><div id="fileQueue" class="file-queue"></div></div>
    <button class="btn primary span-2 large">Kirim Ticket</button></form></section><aside class="side-info"><div class="mini-card"><span class="eyebrow">ROUTING</span><h4>Jenis & Area Ticket</h4><p>Kendala dan permintaan sama-sama dapat diarahkan ke area Network atau IT. Ticket Network diarahkan ke PIC Network, sedangkan ticket IT ke PIC IT. Root Admin dapat override bila diperlukan.</p></div><div class="mini-card"><span class="eyebrow">VISIBILITY</span><h4>Public atau Private</h4><p>Admin dapat membuat ticket public agar dapat dilihat semua user. Ticket private hanya untuk requester dan staff.</p></div><div class="mini-card"><span class="eyebrow">ESTIMATION</span><h4>Target lebih jelas</h4><p>Estimasi dibandingkan dengan waktu aktual agar supervisor dapat melihat performa penyelesaian.</p></div></aside></div>`;
  if(isAdmin()){const mode=$('#requesterMode'),manual=$('#manualRequester');const sync=()=>manual.classList.toggle('hidden',!!mode.value);mode.onchange=sync;sync();}
  const syncEst=()=>{const d=DEFAULTS[$('#prioritySelect').value];$('#estProcess').textContent=estimatePartsLabelClient(d.processing);$('#estCompletion').textContent=estimatePartsLabelClient(d.completion);};$('#prioritySelect').onchange=syncEst;syncEst();
  const syncPicRouting=()=>{
    if(!isAdmin())return;
    const issue=$('#issueTypeSelect').value;const select=$('#newTicketPic');
    [...select.options].forEach((o,i)=>{if(i===0)return;const support=o.dataset.support||'Both';o.hidden=!isRoot()&&support!=='Both'&&support!==issue;});
    const current=select.selectedOptions[0];if(current?.hidden)select.value='';
  };
  $('#issueTypeSelect').onchange=syncPicRouting;syncPicRouting();
  const syncRequestKindCopy=()=>{
    const isRequest=$('#requestKindSelect')?.value==='Request';
    if($('#ticketTitleInput'))$('#ticketTitleInput').placeholder=isRequest?'Contoh: Permintaan instalasi aplikasi untuk user baru':'Contoh: Tidak dapat mengakses Wi-Fi kantor';
    if($('#ticketImpactInput'))$('#ticketImpactInput').placeholder=isRequest?'Contoh: Dibutuhkan untuk onboarding / operasional':'Contoh: 5 user terdampak / pekerjaan terhenti';
    if($('#ticketDescriptionInput'))$('#ticketDescriptionInput').placeholder=isRequest?'Jelaskan layanan/perubahan yang dibutuhkan, tujuan, dan deadline bila ada.':'Jelaskan gejala, error, sejak kapan terjadi, dan langkah yang sudah dicoba.';
  };
  $('#requestKindSelect')?.addEventListener('change',syncRequestKindCopy);syncRequestKindCopy();
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

function contactEmail(p){const direct=String(p?.email||'').trim();if(direct)return direct;const c=String(p?.contact||'').trim();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)?c:'';}
function contactPhone(p){const direct=String(p?.phone||'').trim();if(direct)return direct;const c=String(p?.contact||'').trim();return c&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)?c:'';}
function personContactHtml(p){return `<small class="contact-line"><b>Email:</b> ${esc(contactEmail(p)||'-')}</small><small class="contact-line"><b>No:</b> ${esc(contactPhone(p)||'-')}</small>`;}

async function showTicket(id){
  const d=await api('/api/tickets/'+encodeURIComponent(id));const t=d.ticket;if(isAdmin()){await loadDirectory();await loadPicDirectory();}
  const allEvidence=[...(t.evidence||[]).map(x=>({...x,group:'Evidence Awal'})),...(t.resolutionEvidence||[]).map(x=>({...x,group:'Evidence Penyelesaian'}))];
  const canConfirm=Boolean(t.permissions?.canConfirm)||(ME.role==='user'&&t.requester?.userId===ME.id&&t.status==='Resolved - Awaiting Confirmation'&&t.resolutionMode==='user_confirm');
  const rem=t.estimateMeta?.remainingMinutes;
  const estimateState=!t.targetDueAt?'<b>TBA</b>':['Finished','Resolved - Awaiting Confirmation'].includes(t.status)?`<b>Target: ${fmtDate(t.targetDueAt)}</b>`:rem>=0?`<b class="text-good">Sisa ${formatDuration(rem)}</b>`:`<b class="text-danger">Lewat ${formatDuration(rem)}</b>`;
  const ratingBlock=t.feedback?.rating?`<div class="detail-section feedback-box"><span class="eyebrow">USER FEEDBACK</span><h4>${stars(t.feedback.rating)} ${t.feedback.rating}/5</h4><p>${esc(t.feedback.comment||'Tidak ada komentar tambahan.')}</p><small>${fmtDate(t.feedback.at)}</small></div>`:'';
  const estimateComparison=(()=>{
    if(!t.targetDueAt)return 'Belum dapat dibandingkan';
    if(!t.resolvedAt)return rem>=0?`Masih dalam target · sisa ${formatDuration(rem)}`:`Melewati target · ${formatDuration(Math.abs(rem))}`;
    const delta=Math.round((new Date(t.resolvedAt)-new Date(t.targetDueAt))/60000);
    return delta<=0?`Sesuai estimasi · ${formatDuration(Math.abs(delta))} lebih cepat`:`Melewati estimasi · ${formatDuration(delta)}`;
  })();
  const management=isAdmin()?(t.permissions?.canManage!==false?adminTicketControls(t):`<div class="detail-section locked-control"><span class="eyebrow">TICKET LOCKED</span><h4>Ditangani oleh PIC lain</h4><p>Anda dapat melihat ticket ini, tetapi tidak dapat mengubah pekerjaan atau resolve karena PIC aktif adalah <b>${esc(t.assignedTo?.name||'-')}</b>. Root Admin dapat override assignment.</p>${t.permissions?.canChangeVisibility?`<div class="visibility-only-control"><label>Visibility<select id="lockedVisibility"><option value="private" ${!t.isPublic?'selected':''}>Private</option><option value="public" ${t.isPublic?'selected':''}>Public · terlihat semua user</option></select></label><button class="btn secondary" id="saveLockedVisibility">Simpan Visibility</button><small>Mengubah visibility tidak dianggap sebagai intervensi pekerjaan PIC.</small></div>`:''}</div>`):'';
  openModal(`<div class="ticket-detail-head"><div><span class="eyebrow">${esc(t.id)}</span><h2>${esc(t.title)}</h2><div class="inline-badges">${badgePriority(t.priority)}${badgeStatus(t.status)}<span class="badge ${t.requestKind==='Request'?'purple':'gray'}">${esc(requestKindLabel(t.requestKind))}</span><span class="badge ${t.issueType==='Network'?'orange':'blue'}">${esc(t.issueType||'IT')}</span><span class="badge ${t.isPublic?'green':'gray'}">${t.isPublic?'Public':'Private'}</span></div></div><div class="detail-date"><span>Dibuat</span><strong>${fmtDate(t.createdAt)}</strong></div></div>
  <div class="detail-kpis"><div><span>Requester</span><strong>${esc(t.requester?.name||'-')}</strong><small>${esc(t.requester?.department||'-')}</small>${personContactHtml(t.requester)}</div><div><span>Created By</span><strong>${esc(t.createdBy?.name||'-')}</strong><small>${esc(roleLabel(t.createdBy?.role||'user'))}</small>${isStaffView()?personContactHtml(t.createdBy):''}</div><div><span>PIC</span><strong>${esc(t.assignedTo?.name||'Belum ditentukan')}</strong><small>${esc(t.assignedTo?.department||t.assignedTo?.label||'-')}</small>${isStaffView()?personContactHtml(t.assignedTo):''}</div><div><span>Solver</span><strong>${esc(t.resolvedBy?.name||'Belum selesai')}</strong><small>${t.resolvedAt?fmtDate(t.resolvedAt):'-'}</small>${isStaffView()?personContactHtml(t.resolvedBy):''}</div></div>
  <div class="detail-section"><div class="info-grid"><div><span>Jenis Ticket</span><b>${esc(requestKindLabel(t.requestKind))}</b></div><div><span>Area Penanganan</span><b>${esc(t.issueType||'IT')}</b></div><div><span>Kategori</span><b>${esc(t.category)}</b></div><div><span>Lokasi</span><b>${esc(t.location||'-')}</b></div><div><span>Asset</span><b>${esc(t.asset||'-')}</b></div><div><span>Impact / Tujuan</span><b>${esc(t.impact||'-')}</b></div><div><span>Visibility</span><b>${t.isPublic?'Public · semua user':'Private · requester + staff'}</b></div></div><div class="description-box"><span>Detail Ticket</span><p>${esc(t.description||'-')}</p></div></div>
  <div class="detail-section estimate-detail"><div class="section-head compact"><div><span class="eyebrow">ESTIMASI & TARGET</span><h4>Perbandingan waktu pengerjaan</h4></div>${estimateStatusHtml(t)}</div><div class="info-grid"><div><span>Estimasi Proses</span><b>${esc(t.estimatedProcessing||'TBA')}</b><small>Disimpan numerik sebagai hari kerja, jam, dan menit.</small></div><div><span>Target Mulai Proses</span><b>${t.processTargetAt?fmtDate(t.processTargetAt):'TBA'}</b><small>Indikator respons awal sebelum ticket mulai ditangani.</small></div><div><span>Target Estimasi Selesai</span><b>${esc(t.estimatedCompletion||'TBA')}</b><small>Hari kerja adalah satuan utama; jam/menit memberi presisi tambahan.</small></div><div><span>Target Waktu Selesai</span>${estimateState}<small>${t.targetDueAt?fmtDate(t.targetDueAt):'Belum ada target terhitung.'}</small></div><div><span>Durasi Aktual</span><b>${t.resolvedAt?formatDuration(t.estimateMeta?.elapsedMinutes):'Masih berjalan'}</b><small>Dihitung dari ticket dibuat sampai resolve.</small></div><div><span>Aktual vs Estimasi</span><b>${esc(estimateComparison)}</b><small>Membandingkan waktu resolve aktual dengan target estimasi completion.</small></div></div><p class="estimate-disclaimer">Estimasi adalah target operasional indikatif untuk monitoring. Hari kerja melewati Sabtu/Minggu; hari libur nasional belum dihitung otomatis.</p></div>
  ${t.resolutionNote?`<div class="detail-section"><div class="description-box resolution"><span>Catatan Penyelesaian · ${t.resolutionMode==='self_confirm'?'Self Confirm':'User Confirm'}</span><p>${esc(t.resolutionNote)}</p></div></div>`:''}
  ${ratingBlock}
  <div class="detail-section"><div class="section-head compact"><div><span class="eyebrow">EVIDENCE</span><h4>${allEvidence.length} file tersimpan</h4></div></div><div class="evidence-grid">${allEvidence.length?renderEvidence(allEvidence):'<div class="empty-inline">Tidak ada evidence.</div>'}</div></div>
  <div class="detail-section"><div class="section-head compact"><div><span class="eyebrow">ACTIVITY</span><h4>Timeline Ticket</h4></div></div><div class="timeline">${(t.timeline||[]).slice().reverse().map(x=>`<div class="timeline-item"><i></i><div><strong>${esc(x.by||'System')}</strong><p>${esc(x.note||x.type)}</p><span>${fmtDate(x.at)}</span></div></div>`).join('')}</div></div>
  ${management}${canConfirm?`<div class="confirm-panel"><h4>Apakah pekerjaan sudah sesuai?</h4><p>Konfirmasi selesai disertai rating 1–5 bintang, atau buka kembali bila hasil belum sesuai atau masih membutuhkan tindak lanjut.</p><div class="action-row"><button class="btn success" id="confirmDone">★ Konfirmasi + Beri Rating</button><button class="btn danger-soft" id="reopenBtn">↻ Masih Bermasalah</button></div></div>`:''}`,true);
  if(isAdmin()&&t.permissions?.canManage!==false)bindAdminTicketControls(t);
  if(isAdmin()&&t.permissions?.canManage===false&&$('#saveLockedVisibility')){
    $('#saveLockedVisibility').onclick=async()=>{
      try{await api(`/api/admin/tickets/${encodeURIComponent(t.id)}`,{method:'PATCH',body:JSON.stringify({isPublic:$('#lockedVisibility').value==='public'})});toast('Visibility ticket diperbarui tanpa mengubah pekerjaan PIC.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}
    };
  }
  if(canConfirm){
    $('#confirmDone').onclick=()=>feedbackConfirmModal(t);
    $('#reopenBtn').onclick=async()=>{const note=await uiPrompt({tone:'warning',icon:'↻',title:'Buka kembali ticket?',message:'Ticket akan kembali ke proses penanganan dan PIC akan menerima notifikasi tindak lanjut.',confirmText:'Reopen Ticket',field:{label:'Apa yang masih perlu ditindaklanjuti?',type:'textarea',rows:5,required:true,minLength:3,placeholder:'Contoh: koneksi masih putus setiap beberapa menit setelah perbaikan.'},note:'Tuliskan kondisi terbaru agar PIC tidak perlu menebak masalah yang tersisa.'});if(note===null)return;try{await api(`/api/tickets/${encodeURIComponent(t.id)}/reopen`,{method:'POST',body:JSON.stringify({note})});toast('Ticket dibuka kembali dan PIC diberi notifikasi.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
  }
}
function feedbackConfirmModal(t){
  openModal(`<span class="eyebrow">KONFIRMASI USER</span><h2>Nilai hasil pekerjaan</h2><p class="muted">Rating hanya tersedia untuk ticket yang menggunakan mode menunggu konfirmasi user.</p><form id="feedbackForm" class="stack-form"><label>Rating 1–5 Bintang<select name="rating" required><option value="">Pilih rating</option><option value="5">★★★★★ · Sangat Baik</option><option value="4">★★★★☆ · Baik</option><option value="3">★★★☆☆ · Cukup</option><option value="2">★★☆☆☆ · Kurang</option><option value="1">★☆☆☆☆ · Sangat Kurang</option></select></label><label>Saran / Feedback<textarea name="feedback" rows="4" placeholder="Opsional: ceritakan pengalaman atau saran untuk tim IT."></textarea></label><label>Catatan Konfirmasi<textarea name="note" rows="2" placeholder="Opsional"></textarea></label><button class="btn success">✓ Konfirmasi Selesai</button></form>`);
  $('#feedbackForm').onsubmit=async e=>{e.preventDefault();try{const f=Object.fromEntries(new FormData(e.target));f.rating=Number(f.rating);await api(`/api/tickets/${encodeURIComponent(t.id)}/confirm`,{method:'POST',body:JSON.stringify(f)});toast('Terima kasih. Ticket selesai dan feedback tersimpan.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
}
function renderEvidence(files){return files.map(f=>{const isImg=String(f.mimetype||'').startsWith('image/')||String(f.url||'').endsWith('.webp');const saved=Number(f.savedBytes||0)>0?` · hemat ${fmtBytes(f.savedBytes)}`:'';return isImg?`<a class="evidence-card image" href="${esc(f.url)}" target="_blank"><img src="${esc(f.url)}" alt="${esc(f.name)}"><div><strong>${esc(f.group||'Evidence')}</strong><span>${esc(f.name)} · ${fmtBytes(f.size)}${saved}</span></div></a>`:`<a class="evidence-card" href="${esc(f.url)}" target="_blank"><div class="doc-icon">DOC</div><div><strong>${esc(f.group||'Evidence')}</strong><span>${esc(f.name)} · ${fmtBytes(f.size)}</span></div></a>`;}).join('');}
function adminTicketControls(t){
  const currentKey=t.assignedTo?.key||(t.assignedTo?.userId?`admin:${t.assignedTo.userId}`:(t.assignedTo?.picId?`external:${t.assignedTo.picId}`:''));
  const picOptions=PIC_DIRECTORY.filter(p=>isRoot()||!p.supportType||p.supportType==='Both'||p.supportType===t.issueType).map(p=>`<option value="${esc(p.key)}" ${currentKey===p.key?'selected':''}>${esc(picOptionLabel(p))}</option>`).join('');
  return `<div class="detail-section admin-controls"><div class="section-head compact"><div><span class="eyebrow">ADMIN CONTROL</span><h4>Kelola Ticket</h4></div></div><div class="form-grid two">
    <label>Status<select id="editStatus">${[...new Set([t.status,'Open','In Progress','Waiting User','Reopened'])].map(x=>`<option ${x===t.status?'selected':''}>${x}</option>`).join('')}</select><small>Status selesai hanya melalui tombol Resolve agar mode konfirmasi tercatat.</small></label>
    <label>Priority<select id="editPriority">${ALL_PRIORITIES.map(x=>`<option ${x===t.priority?'selected':''}>${x}</option>`)}</select></label>
    <label>Jenis Ticket<select id="editRequestKind"><option value="Issue" ${t.requestKind!=='Request'?'selected':''}>Kendala</option><option value="Request" ${t.requestKind==='Request'?'selected':''}>Permintaan</option></select><small>Boleh dikoreksi sesuai nature ticket.</small></label>
    <label>Area Penanganan<select id="editIssueType" ${isRoot()?'':'disabled'}><option value="IT" ${t.issueType==='IT'?'selected':''}>IT</option><option value="Network" ${t.issueType==='Network'?'selected':''}>Network</option></select><small>${isRoot()?'Root dapat override routing.':'Hanya Root Admin dapat mengubah area IT/Network.'}</small></label>
    <label>Visibility<select id="editVisibility"><option value="private" ${!t.isPublic?'selected':''}>Private</option><option value="public" ${t.isPublic?'selected':''}>Public · terlihat semua user</option></select></label>
    <label class="span-2">PIC<select id="editPic"><option value="">Belum ditentukan</option>${picOptions}</select><small>Admin biasa hanya dapat memilih PIC yang sesuai area ${esc(t.issueType||'IT')}. Jika PIC internal sudah ditetapkan, admin lain tidak dapat intervene. Root Admin dapat override.</small></label>
    <div class="span-2 estimate-editor-grid">
      ${estimateEditor('procEst',t.processingEstimate,'Estimasi Proses','Perkiraan waktu mulai/proses penanganan. Hari kerja menjadi satuan utama; 0 semua = TBA.')}
      ${estimateEditor('compEst',t.completionEstimate,'Target Estimasi Selesai','Target operasional sampai pekerjaan selesai. 0 semua = TBA; perubahan menghitung ulang target dan sisa waktu.')}
    </div>
    <button class="btn ghost span-2" id="applyPriorityDefault">↺ Gunakan Default Priority</button>
    <button class="btn secondary span-2" id="saveTicketChanges">Simpan Perubahan & Kirim Email</button>
  </div><div class="divider"><span>penyelesaian</span></div><button class="btn primary wide" id="resolveTicketBtn">✓ Resolve Ticket + Pilih Mode Konfirmasi</button>
  ${isRoot()?`<div class="divider"><span>root admin</span></div><button class="btn danger-action wide" id="deleteTicketBtn">🗑 Hapus Ticket Permanen</button><small class="muted" style="display:block;margin-top:8px">Khusus Root Administrator. Ticket, histori di database V5.5, dan file evidence ticket akan dihapus permanen.</small>`:''}</div>`;
}
function bindAdminTicketControls(t){
  const setEstimateValues=(prefix,p)=>{const v=normalizeEstimatePartsClient(p);$(`#${prefix}Days`).value=v.days;$(`#${prefix}Hours`).value=v.hours;$(`#${prefix}Minutes`).value=v.minutes;syncEstimateEditor(prefix);};
  const setDefaults=()=>{const d=DEFAULTS[$('#editPriority').value]||{processing:{},completion:{}};setEstimateValues('procEst',d.processing);setEstimateValues('compEst',d.completion);};
  $('#applyPriorityDefault').onclick=setDefaults;$('#editPriority').addEventListener('change',setDefaults);
  ['procEstDays','procEstHours','procEstMinutes','compEstDays','compEstHours','compEstMinutes'].forEach(id=>$(`#${id}`)?.addEventListener('input',()=>syncEstimateEditor(id.startsWith('proc')?'procEst':'compEst')));
  $('#saveTicketChanges').onclick=async()=>{try{await api(`/api/admin/tickets/${encodeURIComponent(t.id)}`,{method:'PATCH',body:JSON.stringify({status:$('#editStatus').value,priority:$('#editPriority').value,assignedPicKey:$('#editPic').value,processingEstimate:readEstimateEditor('procEst'),completionEstimate:readEstimateEditor('compEst'),requestKind:$('#editRequestKind').value,issueType:$('#editIssueType').value,isPublic:$('#editVisibility').value==='public'})});toast('Perubahan disimpan. Jenis ticket, target estimasi, sisa waktu, dan visibility ikut diperbarui.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
  $('#resolveTicketBtn').onclick=()=>resolveModal(t);

  if(isRoot()&&$('#deleteTicketBtn')){
    $('#deleteTicketBtn').onclick=async()=>{
      const typed=await uiPrompt({
        tone:'danger',
        icon:'🗑',
        title:`Hapus ticket ${t.id}?`,
        message:'Aksi ini permanen. Ticket akan hilang dari monitoring, analytics, report, serta evidence yang tersimpan untuk ticket ini akan dibersihkan dari server.',
        confirmText:'Hapus Permanen',
        field:{
          label:'Ketik ID ticket untuk konfirmasi',
          type:'text',
          required:true,
          minLength:3,
          placeholder:t.id,
          help:`Ketik persis: ${t.id}`
        },
        note:'Gunakan hanya untuk ticket salah input, duplikat, data uji, atau ticket yang memang harus dihapus. Untuk pekerjaan valid yang selesai, gunakan Resolve.'
      });
      if(typed===null)return;
      if(typed!==t.id){
        toast(`Konfirmasi tidak cocok. Ketik persis ${t.id}.`,'error');
        return;
      }
      try{
        const d=await api(`/api/root/tickets/${encodeURIComponent(t.id)}`,{method:'DELETE'});
        toast(`${d.message||'Ticket berhasil dihapus.'}${Number(d.removedFiles)>0?` ${d.removedFiles} file evidence dibersihkan.`:''}`);
        closeModal();
        navigate(currentPage);
      }catch(err){toast(err.message,'error');}
    };
  }
}

function resolveModal(t){
  resolutionQueue=[];
  const canUserConfirm=Boolean(t.requester?.userId);
  openModal(`<span class="eyebrow">RESOLUTION</span><h2>Selesaikan ${esc(t.id)}</h2><p class="muted">Pilih cara penutupan. <b>User Confirm</b> meminta requester mengonfirmasi dan memberi rating. <b>Self Confirm</b> langsung Finished dan tidak menghasilkan rating.</p><form id="resolveForm" class="stack-form">
    <label>Mode Penyelesaian<select name="resolutionMode" id="resolutionMode"><option value="user_confirm" ${canUserConfirm?'':'disabled'}>Menunggu Konfirmasi User + Rating</option><option value="self_confirm" ${canUserConfirm?'':'selected'}>Self Confirm · langsung selesai, tanpa rating</option></select></label>
    <div class="resolution-mode-help" id="resolutionModeHelp"></div>
    <label>Catatan Penyelesaian<textarea name="resolutionNote" rows="6" placeholder="Jelaskan tindakan yang dilakukan dan hasil pengecekan."></textarea></label>
    <div><div class="upload-zone compact-upload" id="resolutionUploadZone"><input type="file" id="resolutionEvidenceInput" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"><div class="upload-icon">⇧</div><strong>Tambah evidence penyelesaian</strong><span>Maks. 10 file total · 5 MB/file · gambar dikompres otomatis</span></div><div id="resolutionQueue" class="file-queue"></div></div>
    <button class="btn primary">Resolve Ticket & Kirim Notifikasi</button></form>`);
  const syncHelp=()=>{$('#resolutionModeHelp').innerHTML=$('#resolutionMode').value==='user_confirm'?'<b>User Confirm:</b> status menjadi Resolved - Awaiting Confirmation. User dapat konfirmasi, memberi 1–5 bintang + feedback, atau reopen.':'<b>Self Confirm:</b> status langsung Finished. Cocok untuk ticket internal, walk-in, maintenance, atau case yang tidak membutuhkan validasi user. Tidak ada rating.';};
  $('#resolutionMode').onchange=syncHelp;syncHelp();
  const input=$('#resolutionEvidenceInput'),zone=$('#resolutionUploadZone');const draw=()=>drawQueue('#resolutionQueue',resolutionQueue,draw);
  input.onchange=e=>{addFilesToQueue([...e.target.files],resolutionQueue,draw);input.value='';};['dragenter','dragover'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.add('drag');}));['dragleave','drop'].forEach(ev=>zone.addEventListener(ev,e=>{e.preventDefault();zone.classList.remove('drag');}));zone.addEventListener('drop',e=>addFilesToQueue([...e.dataTransfer.files],resolutionQueue,draw));draw();
  $('#resolveForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);for(const f of resolutionQueue)fd.append('resolutionEvidence',f);try{await api(`/api/admin/tickets/${encodeURIComponent(t.id)}/resolve`,{method:'POST',body:fd});toast($('#resolutionMode').value==='user_confirm'?'Ticket menunggu konfirmasi user dan rating.':'Ticket selesai menggunakan Self Confirm.');closeModal();navigate(currentPage);}catch(err){toast(err.message,'error');}};
}


async function renderPicDirectory(){
  const d=await api('/api/admin/pics');let external=d.external||[];const admins=(d.pics||[]).filter(p=>p.type==='admin');let query='';
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">PIC DIRECTORY</span><h3>Daftar PIC</h3><p>Admin dan Root Administrator otomatis menjadi PIC internal. Setiap PIC memiliki area penanganan <b>IT</b>, <b>Network</b>, atau <b>Both</b> untuk routing ticket.</p></div><button class="btn primary" id="addPicBtn">＋ Tambah PIC Non-Admin</button></div><input id="picSearch" class="wide-search" placeholder="Cari nama, kontak, atau tim PIC..."><div class="pic-section-title">PIC Internal · Admin Aktif</div><div class="account-grid">${admins.map(p=>`<article class="account-card"><div class="account-card-head"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(p.name)}${p.key===`admin:${ME.id}`?' · Saya':''}</h4><p>${esc(p.department||'Administrator')}</p></div><span class="badge blue">${esc(p.supportType||'Both')}</span></div><div class="account-details"><span>Kontak<b>${esc(p.contact||'-')}</b></span><span>Label<b>${esc(p.label||'-')}</b></span><span>Tim Penanganan<b>${esc(p.supportType||'Both')}</b></span></div></article>`).join('')}</div><div class="pic-section-title">PIC Non-Admin</div><div id="externalPicGrid" class="account-grid"></div></section>`;
  function draw(){const q=query.trim().toLowerCase();const list=external.filter(p=>!q||[p.name,p.contact,p.supportType].some(v=>String(v||'').toLowerCase().includes(q)));$('#externalPicGrid').innerHTML=list.map(p=>`<article class="account-card"><div class="account-card-head"><div class="avatar">${esc(p.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(p.name)}</h4><p>PIC Non-Admin</p></div><span class="badge gray">${esc(p.supportType||'Both')}</span></div><div class="account-details"><span>Kontak<b>${esc(p.contact)}</b></span><span>Tim Penanganan<b>${esc(p.supportType||'Both')}</b></span><span>Dibuat<b>${fmtDate(p.createdAt)}</b></span></div><div class="account-actions"><button class="btn secondary edit-pic" data-id="${p.id}">Edit</button><button class="btn danger-soft delete-pic" data-id="${p.id}">Delete</button></div></article>`).join('')||'<div class="empty-state"><h3>Belum ada PIC non-admin</h3><p>Tambahkan vendor, teknisi, atau personel support lain bila diperlukan.</p></div>';
    $$('.edit-pic').forEach(b=>b.onclick=()=>picEditor(external.find(x=>x.id===b.dataset.id),refresh));
    $$('.delete-pic').forEach(b=>b.onclick=async()=>{const x=external.find(p=>p.id===b.dataset.id);const ok=await uiConfirm({tone:'danger',icon:'×',title:`Hapus ${x.name} dari PIC Directory?`,message:'PIC akan hilang dari pilihan assignment baru. Ticket historis tetap menyimpan snapshot nama dan kontak PIC.',confirmText:'Ya, Hapus PIC',note:'Aksi ini tidak menghapus histori ticket yang pernah ditangani PIC tersebut.'});if(!ok)return;try{await api(`/api/admin/pics/${x.id}`,{method:'DELETE'});toast('PIC dihapus dari directory.');await refresh();}catch(err){toast(err.message,'error');}});
  }
  async function refresh(){const x=await api('/api/admin/pics');external=x.external||[];PIC_DIRECTORY=x.pics||[];draw();}
  $('#picSearch').oninput=e=>{query=e.target.value;draw();};$('#addPicBtn').onclick=()=>picEditor(null,refresh);draw();
}
function picEditor(pic,onDone){
  openModal(`<span class="eyebrow">PIC DIRECTORY</span><h2>${pic?'Edit':'Tambah'} PIC Non-Admin</h2><p class="muted">Nama dan kontak tetap sederhana, ditambah area penanganan untuk routing IT/Network.</p><form id="picForm" class="stack-form"><label>Nama PIC<input name="name" value="${esc(pic?.name||'')}" required></label><label>Kontak<input name="contact" value="${esc(pic?.contact||'')}" placeholder="0812..., ext. 123, atau email" required></label><label>Tim Penanganan<select name="supportType"><option value="IT" ${pic?.supportType==='IT'?'selected':''}>IT</option><option value="Network" ${pic?.supportType==='Network'?'selected':''}>Network</option><option value="Both" ${!pic?.supportType||pic?.supportType==='Both'?'selected':''}>Both · IT + Network</option></select></label><button class="btn primary">${pic?'Simpan Perubahan':'Tambah PIC'}</button></form>`);
  $('#picForm').onsubmit=async e=>{e.preventDefault();try{const data=Object.fromEntries(new FormData(e.target));await api(pic?`/api/admin/pics/${pic.id}`:'/api/admin/pics',{method:pic?'PATCH':'POST',body:JSON.stringify(data)});toast(pic?'PIC diperbarui.':'PIC berhasil ditambahkan.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}


async function renderApprovals(){
  const d=await api('/api/admin/users');
  const users=d.users||[];
  const pending=users.filter(u=>u.status==='pending_approval');
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">USER APPROVAL</span><h3>Registrasi Eksternal</h3><p>Email non-@aruraharja.co.id langsung masuk antrean approval admin. Setelah disetujui, user dapat login dengan akun yang didaftarkan.</p></div><span class="count-pill">${pending.length} menunggu</span></div><div class="account-grid" id="approvalGrid">${pending.map(u=>`<article class="account-card pending"><div class="account-card-head"><div class="avatar">${esc(u.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(u.name)}</h4><p>@${esc(u.username)} · ${esc(u.department||'-')}</p></div>${badgeRole(u.role)}</div><div class="account-details"><span>Email<b>${esc(u.email)}</b></span><span>Telepon<b>${esc(u.phone||'-')}</b></span><span>Metode Aktivasi<b>${u.emailVerified?'Email Verified ✓':'Admin Approval'}</b></span><span>Didaftarkan<b>${fmtDate(u.createdAt)}</b></span></div><div class="account-actions"><button class="btn success approve-user" data-id="${u.id}">Approve</button><button class="btn danger-soft reject-user" data-id="${u.id}">Reject</button></div></article>`).join('')||'<div class="empty-state"><h3>Tidak ada approval tertunda</h3><p>Tidak ada registrasi eksternal yang menunggu persetujuan.</p></div>'}</div></section>`;
  $$('.approve-user').forEach(b=>b.onclick=async()=>{const ok=await uiConfirm({tone:'info',icon:'✓',title:'Setujui registrasi user?',message:'Akun akan diaktifkan dan user akan menerima notifikasi aktivasi melalui email.',confirmText:'Setujui User'});if(!ok)return;try{await api(`/api/admin/users/${b.dataset.id}/approve`,{method:'POST'});toast('User disetujui dan email aktivasi dikirim.');renderApprovals();}catch(err){toast(err.message,'error')}});
  $$('.reject-user').forEach(b=>b.onclick=async()=>{const reason=await uiPrompt({tone:'danger',icon:'!',title:'Tolak registrasi user?',message:'User akan menerima email bahwa registrasinya ditolak beserta alasan yang Anda tulis.',confirmText:'Tolak Registrasi',field:{label:'Alasan penolakan',type:'textarea',rows:4,required:true,minLength:3,value:'Data belum dapat diverifikasi.',placeholder:'Jelaskan alasan penolakan secara singkat dan profesional.'}});if(reason===null)return;try{await api(`/api/admin/users/${b.dataset.id}/reject`,{method:'POST',body:JSON.stringify({reason})});toast('Registrasi ditolak dan user diberi notifikasi email.');renderApprovals();}catch(err){toast(err.message,'error')}});
}

async function renderAccounts(){
  if(!isRoot())throw new Error('Akses root administrator diperlukan.');
  const d=await api('/api/root/accounts');let users=d.users;let query='';let role='all';let status='all';
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">ROOT ACCOUNT CONTROL</span><h3>Account Management</h3><p>Hanya root administrator yang dapat membuat, mengubah, reset password, approve/reject, dan menghapus user/admin/supervisor.</p></div><button class="btn primary" id="createAccountBtn">＋ Buat Akun</button></div><div class="filter-grid account-filter"><input id="accQ" placeholder="Cari nama, username, email, bagian..."><select id="accRole"><option value="all">Semua Role</option><option value="user">User</option><option value="admin">Admin</option><option value="supervisor">Admin Supervisor</option><option value="root_admin">Root Admin</option></select><select id="accStatus"><option value="all">Semua Status</option><option value="active">Active</option><option value="pending_approval">Pending Approval</option><option value="pending_verification">Pending Verification</option><option value="rejected">Rejected</option><option value="disabled">Disabled</option></select></div><div id="accountSummary"></div><div id="accountsGrid" class="account-grid"></div></section>`;
  function draw(){
    const q=query.trim().toLowerCase();const list=users.filter(u=>(role==='all'||u.role===role)&&(status==='all'||u.status===status)&&(!q||[u.name,u.username,u.email,u.department,u.phone,u.label].some(v=>String(v||'').toLowerCase().includes(q))));
    const pending=users.filter(u=>u.role==='user'&&u.status==='pending_approval').length;const admins=users.filter(u=>u.role==='admin').length;const supervisors=users.filter(u=>u.role==='supervisor').length;const activeUsers=users.filter(u=>u.role==='user'&&u.status==='active').length;
    $('#accountSummary').innerHTML=`<div class="account-summary"><div><span>User Aktif</span><b>${activeUsers}</b></div><div><span>Admin</span><b>${admins}</b></div><div><span>Supervisor</span><b>${supervisors}</b></div><div><span>Pending Approval</span><b>${pending}</b></div><div><span>Ditampilkan</span><b>${list.length}</b></div></div>`;
    $('#accountsGrid').innerHTML=list.map(u=>`<article class="account-card ${u.status==='pending_approval'?'pending':''}"><div class="account-card-head"><div class="avatar">${esc(u.name.slice(0,1).toUpperCase())}</div><div><h4>${esc(u.name)}</h4><p>@${esc(u.username)} · ${esc(u.department||'-')}</p></div>${badgeRole(u.role)}</div><div class="account-details"><span>Email<b>${esc(u.email)}</b></span><span>Telepon<b>${esc(u.phone||'-')}</b></span><span>Status<b>${esc(statusLabel(u.status))}</b></span><span>Label<b>${esc(u.label||'-')}</b></span>${u.role==='admin'||u.role==='root_admin'?`<span>Tim Penanganan<b>${esc(u.supportType||'Both')}</b></span>`:''}</div><div class="account-flags"><span>${u.emailVerified?'✓ Email verified':'○ Belum verified'}</span><span>Dibuat ${fmtDate(u.createdAt)}</span></div>${u.role==='root_admin'?`<div class="account-actions"><button class="btn secondary edit-account" data-id="${u.id}">Edit Profil Root</button></div>`:`<div class="account-actions">${u.status==='pending_approval'?`<button class="btn success approve-account" data-id="${u.id}">Approve</button><button class="btn danger-soft reject-account" data-id="${u.id}">Reject</button>`:''}<button class="btn secondary edit-account" data-id="${u.id}">Edit</button><button class="btn ghost reset-account" data-id="${u.id}">Reset Password</button><button class="btn danger-soft delete-account" data-id="${u.id}">Delete</button></div>`}</article>`).join('')||'<div class="empty-state"><h3>Tidak ada akun</h3><p>Coba ubah filter pencarian.</p></div>';
    bindAccountActions();
  }
  async function refresh(){const x=await api('/api/root/accounts');users=x.users;draw();}
  function bindAccountActions(){
    $$('.approve-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);const ok=await uiConfirm({tone:'info',icon:'✓',title:`Aktifkan akun ${u?.name||'user'}?`,message:'Status akun akan menjadi aktif dan email aktivasi akan dikirim.',confirmText:'Aktifkan Akun'});if(!ok)return;try{await api(`/api/admin/users/${b.dataset.id}/approve`,{method:'POST'});toast('User disetujui dan email aktivasi dikirim.');await refresh();}catch(err){toast(err.message,'error');}});
    $$('.reject-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);const reason=await uiPrompt({tone:'danger',icon:'!',title:`Tolak akun ${u?.name||'user'}?`,message:'Akun tidak akan diaktifkan dan alasan penolakan akan dikirim melalui email.',confirmText:'Tolak Akun',field:{label:'Alasan penolakan',type:'textarea',rows:4,required:true,minLength:3,value:'Tidak memenuhi ketentuan akses.',placeholder:'Tuliskan alasan penolakan.'}});if(reason===null)return;try{await api(`/api/admin/users/${b.dataset.id}/reject`,{method:'POST',body:JSON.stringify({reason})});toast('Registrasi ditolak dan user diberi email.');await refresh();}catch(err){toast(err.message,'error');}});
    $$('.edit-account').forEach(b=>b.onclick=()=>editAccountModal(users.find(u=>u.id===b.dataset.id),refresh));
    $$('.reset-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);const pw=await uiPrompt({tone:'warning',icon:'🔑',title:`Reset password ${u.name}`,message:`Buat password baru sementara untuk @${u.username}. User akan menerima notifikasi keamanan setelah reset.`,confirmText:'Reset Password',field:{label:'Password baru',type:'password',required:true,minLength:8,placeholder:'Minimal 8 karakter',help:'Gunakan password sementara yang kuat dan jangan kirim melalui kanal publik.'}});if(!pw)return;try{await api(`/api/root/accounts/${u.id}/reset-password`,{method:'POST',body:JSON.stringify({newPassword:pw})});toast('Password direset dan notifikasi keamanan dikirim.');}catch(err){toast(err.message,'error');}});
    $$('.delete-account').forEach(b=>b.onclick=async()=>{const u=users.find(x=>x.id===b.dataset.id);const ok=await uiConfirm({tone:'danger',icon:'×',title:`Hapus akun ${u.name}?`,message:`Akun @${u.username} tidak dapat login lagi. Histori ticket tetap disimpan untuk audit.`,confirmText:'Ya, Hapus Akun',note:'Pastikan akun memang tidak lagi diperlukan. Penghapusan akun berbeda dengan menghapus histori ticket.'});if(!ok)return;try{await api(`/api/root/accounts/${u.id}`,{method:'DELETE'});toast('Akun dihapus. Histori ticket tetap aman.');await refresh();}catch(err){toast(err.message,'error');}});
  }
  $('#accQ').oninput=e=>{query=e.target.value;draw();};$('#accRole').onchange=e=>{role=e.target.value;draw();};$('#accStatus').onchange=e=>{status=e.target.value;draw();};$('#createAccountBtn').onclick=()=>createAccountModal(refresh);draw();
}
function createAccountModal(onDone){
  openModal(`<span class="eyebrow">ROOT ONLY</span><h2>Buat Akun Baru</h2><p class="muted">Supervisor bersifat read-only. Administrator dapat menjadi PIC; tentukan tim IT, Network, atau Both.</p><form id="createAccountForm" class="form-grid two"><label>Role<select name="role" id="newAccountRole"><option value="user">User</option><option value="admin">Administrator</option><option value="supervisor">Admin Supervisor</option></select></label><label>Nama<input name="name" required></label><label>Username<input name="username" required></label><label>Email<input name="email" type="email" required></label><label>No. Telepon<input name="phone"></label><label>Bagian<input name="department" required></label><label class="span-2" id="newSupportTypeWrap">Tim Penanganan<select name="supportType"><option>IT</option><option>Network</option><option selected>Both</option></select><small>Dipakai hanya jika role Administrator.</small></label><label class="span-2">Label / Jabatan<input name="label" placeholder="Contoh: IT Support Engineer / Supervisor / Finance Staff"></label><label class="span-2">Password Awal<input name="password" type="password" minlength="8" required></label><button class="btn primary span-2">Buat Akun</button></form>`);
  const sync=()=>$('#newSupportTypeWrap').classList.toggle('hidden',$('#newAccountRole').value!=='admin');$('#newAccountRole').onchange=sync;sync();
  $('#createAccountForm').onsubmit=async e=>{e.preventDefault();try{await api('/api/root/accounts',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});toast('Akun berhasil dibuat dan email notifikasi dikirim.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}
function editAccountModal(u,onDone){
  const root=u.role==='root_admin';
  openModal(`<span class="eyebrow">ACCOUNT EDITOR</span><h2>Edit ${esc(u.name)}</h2><form id="editAccountForm" class="form-grid two"><label>Role<select name="role" id="editAccountRole" ${root?'disabled':''}><option value="user" ${u.role==='user'?'selected':''}>User</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrator</option><option value="supervisor" ${u.role==='supervisor'?'selected':''}>Admin Supervisor</option><option value="root_admin" ${root?'selected':''}>Root Administrator</option></select></label><label>Status<select name="status" ${root?'disabled':''}><option value="active" ${u.status==='active'?'selected':''}>Active</option><option value="pending_approval" ${u.status==='pending_approval'?'selected':''}>Pending Approval</option><option value="rejected" ${u.status==='rejected'?'selected':''}>Rejected</option><option value="disabled" ${u.status==='disabled'?'selected':''}>Disabled</option></select></label><label>Nama<input name="name" value="${esc(u.name)}" required></label><label>Username<input name="username" value="${esc(u.username)}" required></label><label>Email<input name="email" type="email" value="${esc(u.email)}" required></label><label>No. Telepon<input name="phone" value="${esc(u.phone||'')}"></label><label>Bagian<input name="department" value="${esc(u.department||'')}" required></label><label>Label / Jabatan<input name="label" value="${esc(u.label||'')}"></label><label class="span-2" id="editSupportTypeWrap">Tim Penanganan<select name="supportType"><option value="IT" ${u.supportType==='IT'?'selected':''}>IT</option><option value="Network" ${u.supportType==='Network'?'selected':''}>Network</option><option value="Both" ${!u.supportType||u.supportType==='Both'?'selected':''}>Both · IT + Network</option></select><small>Dipakai untuk routing PIC Administrator. Root selalu dapat override.</small></label><button class="btn primary span-2">Simpan Perubahan</button></form>`);
  const sync=()=>$('#editSupportTypeWrap').classList.toggle('hidden',!root&&$('#editAccountRole').value!=='admin');if($('#editAccountRole'))$('#editAccountRole').onchange=sync;sync();
  $('#editAccountForm').onsubmit=async e=>{e.preventDefault();const f=Object.fromEntries(new FormData(e.target));if(root){f.role='root_admin';f.status='active';f.supportType=u.supportType||'Both';}try{const d=await api(`/api/root/accounts/${u.id}`,{method:'PATCH',body:JSON.stringify(f)});if(u.id===ME.id){ME=d.user;renderNav();}toast('Data akun diperbarui dan notifikasi email dikirim.');closeModal();await onDone();}catch(err){toast(err.message,'error');}};
}

async function renderReports(){
  let opts={pics:[],solvers:[],creators:[]};if(isStaffView())opts=await api('/api/admin/report-options');
  const advanced=isStaffView()?`<div class="report-divider span-2"><span>Pembagian Kerja / Audit</span></div><label>PIC<select id="rPic"><option value="All">Semua PIC</option>${opts.pics.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}${x.contact?` · ${esc(x.contact)}`:''}</option>`).join('')}</select></label><label>Created By<select id="rCreator"><option value="All">Semua Creator/Admin</option>${opts.creators.map(x=>`<option value="${esc(x.key)}">${esc(x.name)} · ${esc(roleLabel(x.role))}</option>`).join('')}</select></label><label>Solver<select id="rSolver"><option value="All">Semua Solver</option>${opts.solvers.map(x=>`<option value="${esc(x.key)}">${esc(x.name)}</option>`).join('')}</select></label><label>Jenis Ticket<select id="rKind"><option value="All">Semua Jenis</option><option value="Issue">Kendala</option><option value="Request">Permintaan</option></select></label><label>Area Penanganan<select id="rIssue"><option value="All">Semua Area</option><option>IT</option><option>Network</option></select></label><label>Visibility<select id="rVisibility"><option value="All">Semua</option><option value="Public">Public</option><option value="Private">Private</option></select></label><label>Quick Periode<select id="rTime"><option value="all">Keseluruhan</option><option value="daily">Hari Ini</option><option value="weekly">7 Hari</option></select></label><label>Tanggal Mulai<input id="rFrom" type="date"></label><label>Tanggal Akhir<input id="rTo" type="date"></label>`:`<label>Periode<select id="rTime"><option value="all">Keseluruhan</option><option value="daily">Harian / Hari Ini</option><option value="weekly">Mingguan / 7 Hari</option></select></label>`;
  $('#pageContent').innerHTML=`<section class="section-card"><div class="section-head"><div><span class="eyebrow">EXCEL REPORT</span><h3>Export Ticket (.xlsx)</h3><p>${ME.role==='user'?'Export tetap hanya berisi ticket milik akun kamu, bukan ticket public milik user lain.':'Admin, Root, dan Supervisor dapat export seluruh data sesuai filter untuk monitoring pembagian kerja dan performa.'}</p></div></div><div class="form-grid two">${advanced}<label>Kategori<select id="rCat"><option>All</option>${CATEGORIES.map(x=>`<option>${x}</option>`)}</select></label><label>Priority<select id="rPri"><option>All</option>${ALL_PRIORITIES.map(x=>`<option>${x}</option>`)}</select></label><label>Status<select id="rStat"><option>All</option>${STATUSES.map(x=>`<option>${x}</option>`)}</select></label><label class="${ME.role==='user'?'':'span-2'}">Search Optional<input id="rQ" placeholder="Nama, ID, judul, PIC, solver..."></label><button id="exportBtn" class="btn primary span-2 large">↓ Download Excel + Ringkasan Analytics</button></div><div class="report-note"><b>Workbook:</b> Ringkasan pembagian PIC/creator/solver + detail ticket. V5.4 menambahkan Jenis Ticket Kendala/Permintaan, Dashboard Grafik yang lebih kaya, estimasi numerik hari/jam/menit, aktual vs target, workload PIC, rating, dan feedback.</div></section>`;
  $('#exportBtn').onclick=()=>{const params={timeframe:$('#rTime').value,category:$('#rCat').value,priority:$('#rPri').value,status:$('#rStat').value,q:$('#rQ').value};if(isStaffView())Object.assign(params,{pic:$('#rPic').value,creator:$('#rCreator').value,solver:$('#rSolver').value,requestKind:$('#rKind').value,issueType:$('#rIssue').value,visibility:$('#rVisibility').value,dateFrom:$('#rFrom').value,dateTo:$('#rTo').value});location.href='/api/tickets-export.xlsx?'+new URLSearchParams(params);};
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
$('#publicHelpBtn')?.addEventListener('click',()=>openPublicHelp(true));
$('#helpBackBtn')?.addEventListener('click',closePublicHelp);
window.addEventListener('popstate',()=>{if(location.pathname==='/help')openPublicHelp(false);else if(!ME){$('#helpView')?.classList.add('hidden');$('#authView')?.classList.remove('hidden');}else{$('#helpView')?.classList.add('hidden');$('#appView')?.classList.remove('hidden');}});
boot();
