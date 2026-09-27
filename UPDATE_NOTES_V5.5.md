# ARU IT Ticketing V5.5 - Guided UX & Supervisor Analytics

## 1. Dialog in-app menggantikan pop-up browser

Aksi yang sebelumnya memakai `prompt()` / `confirm()` sekarang menggunakan dialog ARU yang terintegrasi dengan desain aplikasi:

- Reopen ticket + alasan tindak lanjut
- Approve user
- Reject user + alasan
- Delete PIC non-admin
- Reset password akun + input password tersembunyi / show-hide
- Delete account

Dialog menampilkan konteks, konsekuensi aksi, tombol Cancel/Confirm, validasi field, dan tampilan danger/warning/info yang konsisten.

## 2. Analytics lebih mudah dibaca Supervisor

Dashboard menambahkan panel **Cara Baca Cepat** untuk filter yang aktif, berisi:

- volume selesai dan completion %
- On-time / Sesuai Estimasi %
- Aktual / Target %
- mix priority dominan
- rating + coverage feedback

Setiap grafik memiliki `Cara baca` yang menjelaskan apa arti nilai/persentase dan apa yang tidak boleh disimpulkan dari grafik tersebut.

Contoh:

- Workload PIC = pembagian volume, bukan skor kualitas.
- Solver = admin yang resolve; dapat berbeda dari PIC.
- Rating hanya berasal dari User Confirm.
- Kecepatan PIC perlu dibaca bersama priority, jenis ticket, area, dan jumlah sampel.
- Aktual / Target <= 100% berarti rata-rata waktu aktual masih berada di dalam target estimasi.

## 3. Tutorial diperluas

Help Center sekarang mencakup:

- Login, registrasi internal/external, Guest, reset password, profile
- Cara membuat ticket yang jelas + contoh
- Kendala vs Permintaan
- IT vs Network
- Priority
- Workflow/status
- Estimasi dan persentase
- User Confirm vs Self Confirm
- Public vs Private
- Analytics glossary
- Role & access
- Security / good practice
- FAQ

### Tutorial khusus Supervisor

Supervisor mendapatkan bagian khusus dengan:

- urutan membaca dashboard
- definisi metrik operasional
- cara membaca On-time %, Actual/Target %, workload, solver, rating
- contoh interpretasi satu PIC
- cara membandingkan PIC secara lebih fair
- warning untuk sample kecil / mix priority berbeda
- penggunaan export Excel untuk review

## 4. Compatibility

- Tidak ada perubahan schema MySQL.
- Tidak ada dependency baru.
- Tidak ada perubahan `.env`.
- V5.4.2 data tetap kompatibel.
