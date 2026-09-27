# ARU IT Ticketing V5.4.2

## Percentage-rich analytics
- Semua donut analytics menampilkan **nilai + persentase** pada legend: status, jenis ticket, area, priority, visibility, rating, kesehatan estimasi, dan mode penyelesaian.
- KPI dashboard menambahkan persentase yang relevan: completion share, rating score %, feedback coverage, overdue share, Kendala %, dan Permintaan %.
- Top status cards menampilkan persentase terhadap total ticket aktif pada filter.
- Workload PIC dan Solver menampilkan nilai + persentase.
- Ditambahkan **Kepatuhan Estimasi per PIC**: on-time %, jumlah tepat target, dan rata-rata penggunaan waktu target.
- Tabel detail PIC sekarang memuat share workload, completion %, on-time %, actual/target %, dan rating score.
- Excel Ringkasan dan grafik distribusi juga menampilkan nilai + persentase untuk distribusi yang relevan.

## Tutorial / Help Center
- Semua role login memiliki menu **Tutorial** tersendiri.
- Isi tutorial menyesuaikan role User, Administrator, Root Administrator, atau Admin Supervisor.
- Halaman login memiliki tombol **Butuh bantuan?** yang membuka Help Center lengkap tanpa harus login.
- URL `/help` dapat dibuka langsung dan tetap menampilkan tutorial publik.
- Tutorial mencakup registrasi/login/guest/reset password, Kendala vs Permintaan, IT vs Network, workflow status, estimasi, Public vs Private, rating, dan FAQ.

## Compatibility
- Tidak ada perubahan schema MySQL.
- Tidak ada dependency npm baru.
- Update kompatibel dengan data V5.4.1.
