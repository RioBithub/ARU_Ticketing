# ARU IT Ticketing V5.2

V5.2 menambah fitur operasional dan supervisor tanpa mengubah schema MySQL utama. Data baru disimpan di payload JSON pada tabel MySQL yang sudah ada.

## Fitur baru

- Rating 1-5 bintang + feedback user pada alur User Confirm.
- Jika user melakukan Reopen setelah resolve, attempt resolusi sebelumnya disimpan di `resolutionHistory` dan analytics menunggu hasil resolve final agar durasi tidak salah dihitung.
- Dua mode resolve: User Confirm (menunggu user + rating) dan Self Confirm (langsung Finished, tanpa rating).
- Dashboard analytics untuk Admin, Root Admin, dan Admin Supervisor (periode keseluruhan / hari ini / 7 hari / 30 hari):
  - rata-rata waktu penyelesaian;
  - rata-rata penyelesaian per priority;
  - perbandingan target estimasi vs aktual;
  - persentase selesai sesuai estimasi;
  - active ticket yang melewati estimasi;
  - workload PIC;
  - jumlah resolve per solver;
  - rating rata-rata dan jumlah feedback;
  - distribusi IT vs Network;
  - Public vs Private.
- Role `supervisor`: read-only, tidak dapat create/update/resolve ticket, tetapi dapat melihat semua ticket, analytics, dan export Excel.
- Ticket visibility `Public` / `Private`.
  - Public dapat dilihat semua user.
  - Private hanya requester + staff.
  - Kontak requester/creator/PIC/solver tidak dibuka kepada user lain pada ticket public.
  - Admin non-PIC tetap dapat mengubah Public/Private tanpa mengintervensi pekerjaan PIC.
- Ticket type `IT` / `Network`.
- PIC memiliki `supportType`: IT, Network, atau Both.
- Non-root Admin hanya dapat menangani ticket sesuai timnya dan tidak dapat mengubah/resolve ticket yang sedang dipegang admin PIC lain.
- Root Admin dapat override tipe dan assignment PIC lintas tim.
- Estimasi diperjelas menjadi Estimasi Proses dan Target Estimasi Selesai.
- Target waktu dan sisa/lewat estimasi ditampilkan di list dan detail. Setelah resolve, detail menunjukkan apakah selesai lebih cepat atau melewati target beserta selisih waktunya.
- Range estimasi memakai batas atas. Estimasi berformat hari kerja melewati Sabtu/Minggu; hari libur nasional belum dihitung otomatis.
- Excel menambah tipe kendala, visibility, target due, actual duration, estimate result, resolution mode, rating, dan feedback.

## Database

Tidak ada ALTER TABLE wajib untuk V5 -> V5.2. Tabel yang sama tetap digunakan. Field baru tersimpan di kolom `payload` yang sudah ada.

Saat startup V5.2, ticket lama akan dimigrasikan secara kompatibel di payload:
- `issueType` diinfer dari kategori/judul;
- `isPublic` default `false`;
- target estimasi dibuat dari estimasi existing jika memungkinkan;
- admin lama tanpa `supportType` default `Both` agar tidak langsung terblokir.

Setelah aplikasi stabil, Root Admin dapat mengubah masing-masing Admin menjadi tim IT / Network / Both melalui Account Management.
