# ARU IT Ticketing V5.0 — MySQL

Perubahan utama dari V4.3:

- JSON persistence dihapus dari runtime aplikasi.
- users/pics/tickets/timeline/evidence metadata/OTP/session menggunakan MySQL.
- Evidence tetap berupa file di disk agar database hemat space.
- Session memakai express-mysql-session.
- SQL schema siap import disertakan.
- Migration helper dari V4.3 JSON disertakan.
- Orphan upload cleanup helper disertakan.
- API frontend V4.3 dipertahankan agar UI/fitur tetap kompatibel.
