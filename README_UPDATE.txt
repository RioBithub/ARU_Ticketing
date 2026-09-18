ARU RAHARJA IT TICKETING - EVIDENCE UPDATE
===========================================

Update ini TIDAK menyertakan folder data/ atau uploads/, sehingga ticket dan lampiran lama tidak perlu ditimpa.

FITUR BARU
- Maksimal 10 foto/dokumen per ticket.
- Maksimal 5 MB untuk SETIAP file.
- Format: JPG, JPEG, PNG, WEBP, PDF, DOC, DOCX, XLS, XLSX, TXT.
- Preview file yang dipilih sebelum submit.
- Foto evidence langsung tampil sebagai thumbnail di Ticket Monitoring.
- Klik thumbnail untuk preview besar.
- Dokumen tampil sebagai file card dan dapat dibuka.
- Tracking ticket ikut menampilkan evidence.
- Dashboard admin menampilkan preview evidence langsung di daftar ticket.
- Detail admin menampilkan gallery semua evidence.
- Ticket lama dengan format attachment tunggal tetap kompatibel.
- Tampilan user/admin diperhalus dan dibuat lebih responsive.

CARA PASANG
1. Stop server dengan Ctrl + C.
2. Copy server.js dan folder public/ dari ZIP ini ke folder project:
   C:\xampp\htdocs\ARU_Ticketing\
3. Pilih Replace saat Windows menanyakan file yang sama.
4. JANGAN hapus/timpa folder data/ dan uploads/ yang lama.
5. Jalankan kembali:
   npm start
6. Refresh browser dengan Ctrl + F5.

Tidak perlu npm install ulang karena tidak ada dependency baru.
