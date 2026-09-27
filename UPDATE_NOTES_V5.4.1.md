# Update Notes V5.4.1

## Priority performance lebih jelas
Dashboard sekarang menampilkan dua visual baru:
- **Rata-rata Selesai vs Estimasi per Priority**: Actual vs target estimasi untuk Critical, High, Medium, dan Low.
- **Sesuai Estimasi per Priority**: persentase ticket yang selesai di dalam target untuk setiap priority.

KPI **Sesuai Estimasi** juga menampilkan persentase rata-rata waktu target yang terpakai. Tabel detail Priority ditambah kolom **Aktual / Target** dan jumlah ticket yang memenuhi target.

## Perbandingan yang adil
Untuk grafik Actual vs Target, durasi actual dihitung dari saat estimasi terakhir ditetapkan (`estimateSetAt`) sampai ticket di-resolve. Ini menghindari membandingkan target baru dengan waktu sebelum estimasi tersebut ditetapkan.

## Excel
Dashboard Grafik Excel sekarang menambahkan grafik **Sesuai Estimasi per Priority (%)** di samping grafik Actual vs Target. Ringkasan export juga menampilkan **Rata-rata Aktual / Target**.

## Database
Tidak ada perubahan schema MySQL dan tidak ada dependency baru.
