# ARU IT Ticketing V5.3

Fokus versi ini adalah analytics supervisor yang lebih visual dan estimasi yang terstruktur.

## Perubahan utama
- Dashboard analytics memiliki filter PIC selain filter periode.
- Grafik web tanpa dependency frontend tambahan: tren created vs resolved, workload PIC, solver, distribusi status, dan tipe kendala.
- Estimasi admin tidak lagi bebas berupa string. Nilai disimpan sebagai Hari Kerja + Jam + Menit.
- Default priority tetap tersedia dan kini mengisi field numerik.
- Detail ticket menampilkan target absolut, sisa waktu / overdue, durasi aktual, serta aktual vs estimasi.
- Data lama dimigrasikan otomatis dari teks estimasi lama ke format terstruktur.
- Excel memiliki sheet `Dashboard Grafik` berisi visual workload PIC, distribusi status, dan aktual vs target per priority.
- Sheet `Tickets` menambahkan kolom numerik hari/jam/menit untuk estimasi proses dan target selesai.
- Tidak ada perubahan schema MySQL dan tidak ada dependency baru.

## Default estimasi
- Critical: proses 2 jam, target selesai 8 jam.
- High: proses 4 jam, target selesai 1 hari kerja.
- Medium: proses 1 hari kerja, target selesai 2 hari kerja.
- Low: proses 2 hari kerja, target selesai 5 hari kerja.

Hari kerja melewati Sabtu/Minggu. Jam dan menit ditambahkan setelah komponen hari kerja. Hari libur nasional belum dihitung otomatis.
