# ARU IT Ticketing V5 — MySQL

Versi ini memindahkan persistence utama dari file JSON ke **MySQL**. Frontend dan workflow V4.3 tetap dipertahankan: registrasi internal OTP, approval email eksternal, Guest Mode, ticket lifecycle, PIC Directory, admin/root sebagai PIC, solver, evidence, notifikasi email, filter lanjutan, dan export Excel.

## Arsitektur penyimpanan

- **MySQL**: user, role, ticket, PIC, timeline, metadata evidence, OTP token, dan session.
- **Filesystem `uploads/`**: file evidence aktual. File tidak dimasukkan sebagai BLOB ke MySQL agar database tetap ringan.
- **Sharp**: JPG/JPEG/PNG/WEBP otomatis di-resize maksimal 1600x1600 dan dikonversi ke WebP quality 68 **hanya jika hasilnya lebih kecil**. Original tidak ditulis ke disk jika versi terkompresi dipakai.
- PDF/DOC/XLS/PPT/TXT disimpan apa adanya agar tidak rusak.

## 1. Import database

Pastikan MySQL aktif. Untuk XAMPP, nyalakan module **MySQL**, lalu buka phpMyAdmin.

Import file:

```text
database/aru_ticketing_mysql.sql
```

SQL tersebut membuat database:

```text
aru_ticketing
```

beserta tabel:

```text
users
pics
tickets
ticket_evidence
ticket_timeline
email_tokens
ticket_sequences
sessions
app_meta
```

Jika user MySQL Anda tidak punya izin `CREATE DATABASE`, buat database `aru_ticketing` secara manual dari panel/phpMyAdmin, kemudian pilih database itu dan import schema utama. Bila perlu hapus dua baris `CREATE DATABASE` dan `USE` dari file SQL sebelum import.

## 2. Isi `.env`

File `.env` sudah tersedia. Konfigurasi sebelumnya dipertahankan dan bagian MySQL sudah ditambahkan.

Yang paling penting untuk diisi:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=aru_ticketing
DB_USER=ISI_USERNAME_MYSQL
DB_PASSWORD=ISI_PASSWORD_MYSQL
```

Contoh pada XAMPP lokal **hanya jika memang konfigurasi MySQL Anda seperti itu**:

```env
DB_USER=root
DB_PASSWORD=
```

Jangan menganggap contoh di atas selalu benar untuk server production.

## 3. Install dependency

Buka project di VS Code lalu PowerShell/Terminal:

```powershell
npm install
```

Versi MySQL menambahkan:

```text
mysql2
express-mysql-session
```

Session login sekarang juga tersimpan di MySQL; tidak ada lagi folder JSON session.

## 4. Tes koneksi database

```powershell
npm run db:test
```

Jika benar, output kurang lebih:

```text
MySQL connection: OK
Database: aru_ticketing
Schema version: 5.0.0
```

Jika gagal, periksa MySQL service, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, dan pastikan SQL sudah diimport.

## 5. Jalankan aplikasi

```powershell
npm start
```

Buka:

```text
http://localhost:3000
```

Root administrator akan otomatis dibuat saat startup **hanya jika tabel users belum memiliki root administrator**. Credential root dibaca dari `.env`.

## Workflow yang tetap tersedia

### Registrasi

- `@aruraharja.co.id` → OTP email → verifikasi → akun aktif → auto-login.
- Email eksternal → pending approval → Admin atau Root dapat approve/reject.
- Forgot Password → OTP email.
- Change Password → current password + password baru.

### Role

**User**
- Buat dan lihat ticket miliknya.
- Upload evidence.
- Confirm Finished / Reopen setelah resolve.
- Export ticket sendiri.

**Administrator**
- Kelola semua ticket.
- Bisa menjadi PIC dirinya sendiri.
- Assign admin lain atau PIC non-admin.
- Create/Edit/Delete PIC non-admin.
- Approve/reject registrasi eksternal.
- Resolve ticket sebagai Solver.
- Export Excel dengan filter lengkap.
- Tidak dapat CRUD akun user/admin.

**Root Administrator**
- Semua kemampuan Administrator.
- CRUD user dan admin.
- Reset password user/admin.
- Tidak dapat menghapus root administrator.

### PIC

PIC dapat berupa:

```text
1. Root Administrator
2. Administrator
3. PIC non-admin dari PIC Directory
```

PIC non-admin hanya menyimpan:

```text
Nama
Kontak
```

Snapshot PIC tersimpan di ticket sehingga histori tetap terbaca walaupun PIC/account kemudian dihapus.

### Solver

Solver adalah **admin/root yang menekan Resolve Ticket**. PIC dan Solver dapat berbeda.

Jika ticket belum mempunyai PIC ketika admin menekan Resolve, PIC otomatis diisi admin yang menyelesaikan ticket.

## Estimasi default

| Priority | Estimasi Proses | Estimasi Completion |
|---|---|---|
| Critical | 1-2 jam | Hari ini / secepatnya |
| High | 2-4 jam | 1 hari kerja |
| Medium | 1 hari kerja | 2 hari kerja |
| Low | 1-2 hari kerja | 3-5 hari kerja |
| Unassigned | TBA | TBA |

Admin/root dapat override kedua nilai tersebut secara manual, termasuk mengisi `TBA`.

## Excel Report

Admin dan Root mempunyai hak export yang sama. Filter yang tersedia:

```text
Quick Period: Hari Ini / 7 Hari / Keseluruhan
Tanggal Mulai
Tanggal Akhir
PIC
Created By
Solver
Kategori
Priority
Status
Search
```

Jika `Tanggal Mulai/Akhir` diisi, range tersebut mengalahkan Quick Period.

Workbook memiliki:

```text
Sheet Ringkasan
- total ticket
- pembagian per PIC
- pembagian per Created By
- pembagian per Solver

Sheet Tickets
- detail lengkap setiap ticket
```

## Hemat storage

Evidence tidak disimpan di database sebagai binary. MySQL hanya menyimpan metadata seperti:

```text
nama file
path/url
ukuran original
ukuran setelah kompresi
saved bytes
mimetype
waktu upload
```

File aktual tetap berada di:

```text
uploads/tickets/
uploads/resolutions/
```

Untuk membersihkan file orphan yang tidak memiliki record di MySQL dan sudah berumur minimal 24 jam:

```powershell
npm run storage:cleanup
```

Script ini **tidak menghapus evidence yang masih direferensikan database**.

## Migrasi data JSON V4.3 (opsional)

Jika ingin mempertahankan data V4.3:

1. Backup project lama.
2. Jika memakai **UPDATE ONLY** di folder project V4.3 yang sama, folder `data/` lama boleh dibiarkan: migration script akan mendeteksinya otomatis. Jika memakai project baru, copy file berikut dari folder `data` lama ke folder `legacy-data` V5:

```text
users.json
tickets.json
pics.json
email_tokens.json
```

3. Copy isi folder upload lama ke:

```text
uploads/tickets/
uploads/resolutions/
```

4. Setelah schema MySQL sudah diimport dan `.env` DB benar, jalankan:

```powershell
npm run migrate:json
```

Script memakai `INSERT IGNORE` untuk akun/PIC/token dan melewati Ticket ID yang sudah ada, sehingga lebih aman jika dijalankan ulang. Tetap lakukan backup sebelum migrasi.

## Production melalui Nginx / HestiaCP

Setelah domain dan HTTPS siap, ubah:

```env
APP_BASE_URL=https://ticketing.domain-anda.co.id
TRUST_PROXY=true
SESSION_COOKIE_SECURE=true
NODE_ENV=production
```

Reverse proxy diarahkan ke port Node, misalnya:

```text
127.0.0.1:3000
```

Jangan expose port Node langsung ke internet bila sudah berada di belakang Nginx.

## Catatan keamanan

- `.env` ada di `.gitignore`.
- Password tersimpan sebagai bcrypt hash.
- OTP tersimpan sebagai hash HMAC dan punya expiry/attempt limit.
- Session tersimpan di MySQL.
- Evidence file tidak boleh diberi execute permission.
- Sebelum benar-benar production, ganti `SESSION_SECRET` menjadi random panjang dan rotasi credential SMTP yang pernah dibagikan di luar server.
