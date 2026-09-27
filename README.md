# ARU IT Ticketing V5.4

V5.4 memperluas ticket agar tidak hanya berisi kendala. Ticket sekarang dapat diklasifikasikan sebagai **Kendala / Incident** atau **Permintaan / Service Request**, sementara routing PIC tetap menggunakan **Area Penanganan IT / Network**. Dashboard analytics dibuat lebih compact dan menampilkan lebih banyak grafik tanpa menambah library frontend.

## Highlight V5.4
- Jenis Ticket: Kendala atau Permintaan.
- Area Penanganan: IT atau Network tetap dipakai untuk routing PIC.
- Dashboard Supervisor lebih compact dengan filter PIC dan 12 visual analytics.
- Grafik tambahan: status, jenis ticket, area, priority, visibility, workload PIC, kecepatan per PIC, solver, rating, health estimasi, mode penyelesaian, dan tren.
- Tabel analytics detail tetap tersedia dalam panel yang bisa dibuka/tutup.
- Excel Dashboard Grafik mendapat grafik Jenis Ticket, Area Penanganan, Rating, dan Mode Penyelesaian.
- Tidak memerlukan perubahan schema MySQL; field tambahan tetap tersimpan di payload JSON MySQL.

---

# ARU IT Ticketing V5 - MySQL

Versi ini memindahkan data utama ARU IT Ticketing dari file JSON ke **MySQL**, sambil mempertahankan workflow V4.3: Root/Admin sebagai PIC internal, PIC non-admin terpisah, PIC dan Solver berbeda, advanced filter, dan export Excel.

## Penyimpanan

- **MySQL:** user, admin, ticket, PIC directory, OTP/reset token, session login.
- **Filesystem `uploads/`:** evidence ticket dan evidence penyelesaian.
- Tidak ada lagi `users.json`, `tickets.json`, `pics.json`, atau `email_tokens.json`.
- Evidence gambar tetap hemat space: resize + WebP hanya bila hasil akhirnya lebih kecil. File original gambar tidak disimpan ganda.

## 1. Persiapan database

Buat satu database MySQL, misalnya:

```text
aru_ticketing
```

Di XAMPP/localhost bisa melalui `http://localhost/phpmyadmin`. Di server HestiaCP buat database dan user MySQL dari panel Hestia terlebih dahulu.

Setelah database dibuat, pilih database tersebut lalu **Import**:

```text
sql/01_schema.sql
```

Aplikasi juga menjalankan `CREATE TABLE IF NOT EXISTS` saat startup sebagai safety net, tetapi database dan user MySQL tetap harus sudah tersedia.

## 2. Tambahkan MySQL ke .env lama

Jangan buang `.env` lama karena konfigurasi SMTP, root admin, dan setting upload masih dipakai. Tambahkan saja:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=aru_ticketing
DB_USER=ISI_USERNAME_MYSQL
DB_PASSWORD=ISI_PASSWORD_MYSQL
DB_CONNECTION_LIMIT=5
```

Template copy-paste tersedia di `ENV_MYSQL_TAMBAHAN.txt`.

Untuk local XAMPP, sesuaikan dengan username/password MySQL lokal. Untuk HestiaCP, gunakan nama database dan username persis seperti yang dibuat oleh Hestia (sering memiliki prefix akun).

## 3. Install dan jalankan

```powershell
cd C:\xampp\htdocs\ARU_Ticketing
npm install
npm start
```

Lalu buka:

```text
http://localhost:3000
```

Jika koneksi database salah, server tidak akan start dan console akan meminta pengecekan `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, dan `DB_PASSWORD`.

## 4. Data demo lengkap

Untuk test sebelum go-live, import setelah schema:

```text
sql/02_demo_data.sql
```

Demo ini sengaja mencakup semua kategori sistem:

- Hardware
- Software / Aplikasi
- Network / Wi-Fi
- Printer / Scanner
- Email / Account
- Server / System
- Access / Permission
- Website
- Data / Report
- Other

Isi demo:

- 1 akun Administrator demo
- 3 akun User demo
- 3 PIC non-admin demo
- 21 ticket demo
- variasi priority: Unassigned, Low, Medium, High, Critical
- variasi status: Open, In Progress, Waiting User, Reopened, Resolved - Awaiting Confirmation, Finished
- contoh PIC admin, PIC vendor/non-admin, ticket tanpa PIC, guest ticket, serta Solver
- tanggal tersebar 1-20 September 2026 agar filter From-To dan report dapat dites

Akun test menggunakan email `example.invalid`, jadi tidak diarahkan ke mailbox orang asli.

### Login demo

Semua akun demo menggunakan password:

```text
Demo12345!
```

Username:

```text
demo.admin
demo.rina
demo.budi
demo.sinta
```

**Hapus seluruh akun/data demo sebelum production.**

## 5. PIC dan penyelesaian ticket

Root Administrator dan Administrator biasa otomatis muncul sebagai PIC internal. Admin dapat memilih dirinya sendiri, admin lain, atau PIC non-admin.

PIC non-admin dikelola melalui **PIC Directory**, cukup:

```text
Nama
Kontak
```

Saat admin menekan Resolve:

- admin tersebut dicatat sebagai **Solver**;
- PIC yang sudah ada tidak diganti;
- bila ticket belum mempunyai PIC, admin yang resolve otomatis dijadikan PIC.

Dengan demikian report dapat membedakan **Created By**, **PIC**, dan **Solver**.

## 6. Filter dan Excel

Root dan Admin mempunyai hak export yang sama. Filter meliputi:

- Dari Tanggal - Sampai Tanggal
- Hari Ini / 7 Hari / Keseluruhan
- PIC
- Solver
- Created By
- Kategori
- Priority
- Status
- Search

Workbook mempunyai sheet `Ringkasan` dan `Tickets`, termasuk rekap jumlah ticket per PIC, creator, dan solver.

## 7. Membersihkan demo sebelum go-live

### Cara paling aman

Stop Node terlebih dahulu agar cache aplikasi tidak menulis ulang data demo:

```text
Ctrl + C
```

Di phpMyAdmin:

1. Pilih database ARU Ticketing.
2. Masuk tab **Import**.
3. Import `sql/03_cleanup_demo.sql`.
4. Buka tabel `aru_tickets`, `aru_users`, dan `aru_pics`; pastikan tidak ada ID `DEMO`.
5. Start kembali aplikasi dengan `npm start`.

`03_cleanup_demo.sql` hanya menghapus row demo (`is_demo=1` / ID demo), sehingga data asli tetap aman.

### Kalau ingin menghapus SELURUH data ticketing tetapi akun tetap ada

Gunakan:

```text
sql/04_reset_all_ticketing_data_KEEP_ACCOUNTS.sql
```

Ini menghapus seluruh:

- ticket
- OTP/reset token
- PIC non-admin
- session login

Tetapi mempertahankan akun User/Admin/Root pada `aru_users`.

**Jangan jalankan file reset ini pada production tanpa backup.**

## 8. Hapus manual tanpa file SQL

Jika ingin dilakukan manual dari tab **SQL** phpMyAdmin, untuk demo saja:

```sql
DELETE FROM aru_tickets WHERE is_demo = 1 OR id LIKE 'ARU-DEMO-%';
DELETE FROM aru_email_tokens WHERE user_id LIKE 'USR-DEMO-%';
DELETE FROM aru_pics WHERE is_demo = 1 OR id LIKE 'PIC-DEMO-%';
DELETE FROM aru_sessions;
DELETE FROM aru_users WHERE is_demo = 1 OR id LIKE 'USR-DEMO-%';
```

Untuk melihat dulu sebelum delete:

```sql
SELECT id, title, status, priority FROM aru_tickets WHERE is_demo = 1;
SELECT id, username, role FROM aru_users WHERE is_demo = 1;
SELECT id, name, contact FROM aru_pics WHERE is_demo = 1;
```

## 9. Backup sebelum cleanup

Di phpMyAdmin pilih database -> **Export** -> Quick -> SQL. Simpan backup sebelum menjalankan cleanup/reset. Untuk server, backup database reguler tetap direkomendasikan.

## 10. SMTP

Konfigurasi SMTP tetap memakai `.env` versi sebelumnya. Bila console menampilkan `535 Incorrect authentication data`, aplikasi masih dapat membuka halaman dan menggunakan MySQL, tetapi OTP, forgot password, serta notifikasi email tidak akan bekerja sampai kredensial mailbox benar.

Jangan commit `.env` atau password database/SMTP ke GitHub.

## V5.3 - Supervisor & Service Analytics

V5.3 menambahkan rating user, dashboard analytics, role Admin Supervisor read-only, ticket Public/Private, routing IT/Network, PIC specialization, dua mode resolve, serta tracking target estimasi vs durasi aktual. Tidak ada perubahan schema MySQL wajib; field tambahan tersimpan di payload tabel existing. Lihat `UPDATE_NOTES_V5.3.md`.

### Tambahan V5.3 monitoring

- Analytics dapat dilihat untuk Keseluruhan, Hari Ini, 7 Hari, atau 30 Hari.
- Setelah ticket resolved, sistem membandingkan durasi aktual dengan target estimasi dan menampilkan selisih lebih cepat/terlambat.
- Admin yang bukan PIC tidak dapat mengubah pekerjaan atau resolve ticket milik PIC admin lain, tetapi tetap dapat mengubah visibility Public/Private.
- Ticket public dapat dibaca seluruh user, namun data kontak personal pada ticket public milik user lain disanitasi dari response API.


## V5.3 Analytics & Structured Estimate
Lihat `UPDATE_NOTES_V5.3.md`. Versi ini menambahkan filter PIC di dashboard, grafik web, estimasi numerik hari kerja/jam/menit, target mulai proses, dan sheet Dashboard Grafik pada export Excel. Tidak ada perubahan schema MySQL.

## V5.4.2 - Percentage Analytics & Tutorial
Dashboard analytics sekarang menampilkan nilai sekaligus persentase untuk distribusi yang relevan, termasuk status, priority, jenis ticket, area, visibility, rating, workload PIC, solver, dan kesehatan estimasi. Detail PIC juga mencakup completion %, on-time %, penggunaan waktu target, dan rating score.

Semua role memiliki menu **Tutorial**. Sebelum login, tombol **Butuh bantuan?** membuka Help Center publik lengkap yang juga dapat diakses melalui `/help`.

## V5.5 - Guided UX & Supervisor Analytics

V5.5 memperbaiki pengalaman penggunaan tanpa mengubah schema MySQL:

- browser `prompt()` / `confirm()` diganti dialog in-app yang konsisten untuk reopen, approve/reject, reset password, delete PIC, dan delete account;
- dashboard analytics mempunyai panel **Cara Baca Cepat**, definisi PIC/Solver, On-time %, Aktual/Target %, rating, serta catatan fairness perbandingan;
- setiap grafik memiliki bagian **Cara baca** yang dapat dibuka tanpa memenuhi layar;
- Supervisor mendapatkan tutorial khusus yang menjelaskan urutan membaca dashboard, arti metrik, cara membandingkan PIC secara adil, sample size, rating, estimasi, dan export Excel;
- Help Center publik diperluas dengan pembuatan ticket, priority, status, estimasi, resolution mode, visibility, analytics, role, keamanan, contoh, dan FAQ.

Tidak ada `ALTER TABLE`, dependency baru, atau perubahan `.env`.
