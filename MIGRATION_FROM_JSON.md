# Migrasi V4.3 JSON ke V5 MySQL

Migrasi bersifat opsional.

## Data yang dapat dimigrasikan

- users.json → users
- pics.json → pics
- tickets.json → tickets + ticket_evidence + ticket_timeline
- email_tokens.json → email_tokens

Password hash bcrypt lama dipertahankan sehingga user tidak perlu mengganti password hanya karena migrasi.

## Langkah

1. Import `database/aru_ticketing_mysql.sql`.
2. Isi koneksi MySQL pada `.env`.
3. Jalankan `npm run db:test`.
4. Copy JSON V4.3 ke `legacy-data/`.
5. Copy folder `uploads/` dari project lama ke project V5.
6. Jalankan:

```powershell
npm run migrate:json
```

7. Jalankan `npm start` dan cek jumlah akun/ticket dari dashboard.

Jangan hapus backup project lama sampai data dan evidence sudah diverifikasi.
