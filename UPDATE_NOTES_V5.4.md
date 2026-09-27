# Update Notes V5.4

## Ticket tidak hanya kendala
Ticket memiliki dua dimensi yang berbeda:
- **Jenis Ticket:** Kendala / Incident atau Permintaan / Service Request.
- **Area Penanganan:** IT atau Network, untuk routing PIC.

Ticket lama otomatis diklasifikasikan saat startup. Tidak ada ALTER TABLE yang diperlukan.

## Analytics lebih compact
Dashboard Supervisor dibuat lebih padat dengan KPI kecil dan grid grafik 3 kolom pada layar lebar. Filter PIC dan periode tetap tersedia. Tabel detail performance dipindahkan ke panel expand/collapse.

Visual yang tersedia antara lain tren ticket, status, jenis ticket, area penanganan, priority, visibility, workload PIC, rata-rata waktu selesai per PIC, solver, rating user, kesehatan estimasi, dan mode penyelesaian.

## Excel
Sheet Dashboard Grafik ditambah visual untuk Jenis Ticket, Area Penanganan, distribusi Rating, dan Mode Penyelesaian. Sheet Tickets memiliki kolom Jenis Ticket dan Area Penanganan.

## Database
Tidak ada perubahan schema MySQL. Data V5.3 tetap kompatibel.
