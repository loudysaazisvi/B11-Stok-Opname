# FacultyWare - Modul Logistik & Inventori (Kelompok B11)
Sistem informasi logistik berbasis web modern yang dirancang untuk mengelola data master barang, pencatatan persediaan fisik, monitoring riwayat transaksi barang, pelaksanaan stok opname, serta pelaporan logistik terintegrasi secara dinamis, aman, dan interaktif bagi pengelola logistik fakultas.

👤 Identitas Mahasiswa
* Nama: Loudysa Azisvi Angelia (NIM: 2411523024)
* Nama: Dinda Nathasya Putri (NIM: 2411523032)

🚀 Fitur Utama
* **Daftar Stok Terkini**: Dashboard monitoring persediaan barang secara real-time.
* **Melakukan Stok Opname**: Penyesuaian kuantitas stok fisik dengan stok tercatat secara berkala dari sistem (Form Adjustment).
* **Memeriksa Riwayat Transaksi Barang**: Log rekam aktivitas alur keluar masuk barang dan catatan penyesuaian stok opname secara terperinci.
* **Membuat Laporan Periodik**: Menghasilkan rekapitulasi data mutasi stok dengan filter rentang tanggal tertentu.
* **Ekspor Dokumen ke PDF dan Excel**: Mengunduh rekapitulasi laporan logistik dalam format dokumen resmi PDF dan spreadsheet Excel.
* **Memeriksa Riwayat Dokumen**: Catatan digital log riwayat cetakan laporan yang pernah dibuat di dalam sistem.

🛠️ Tech Stack (Teknologi yang Digunakan)
### Backend (Server-Side)
* **Runtime**: Node.js
* **Framework**: Express.js
* **Database Driver**: mysql2 (dengan fitur connection pooling dan Promise-based queries)
* **Session Management**: express-session & express-mysql-session (untuk persistence login di database)

### Frontend (Client-Side)
* **Template Engine**: EJS (Embedded JavaScript templates)
* **Styling & Components**: Basecoat (Vanilla CSS + JS components untuk UI modern bergaya shadcn/ui)
* **Interactivity**: HTMX (untuk pembaruan konten parsial tanpa memuat ulang seluruh halaman, membuat navigasi secepat Single Page Application/SPA)

📂 Struktur Proyek
```text
B11-Stok-Opname/
├── bin/
│   └── www                  # Entry point server HTTP
├── controllers/
│   └── inventory/
│       ├── itemsController.js # Logika data master barang & QR Code (Dinda)
│       └── stockController.js # Logika stok opname, transaksi, & laporan (Loudysa)
├── lib/
│   └── db.js                 # Konfigurasi koneksi MySQL Pool
├── middlewares/
│   ├── acl.js                # Middleware Access Control List (ACL)
│   ├── auth.js               # Middleware verifikasi session login
│   └── error.js              # Middleware penanganan error
├── public/
│   ├── assets/               # Berkas CSS & JS Basecoat, HTMX, dan Gambar
│   │   ├── css/
│   │   │   └── basecoat.min.css # Framework CSS Basecoat
│   │   ├── js/
│   │   │   └── basecoat.js   # Framework JS Basecoat
│   │   └── images/
│   │       ├── login_artwork.png # Ilustrasi halaman login
│   │       └── logo_fti.png      # Logo FTI Universitas Andalas
│   └── stylesheets/
│       └── style.css         # CSS Kustom (Glow, Cards, Grid, Aksen)
├── routes/
│   ├── index.js              # Router autentikasi utama
│   ├── inventory.js          # Rute logistik, opname, & laporan
│   └── users.js              # Rute data pengguna
├── scripts/
│   └── init_db.js            # Script inisialisasi user admin
├── tests/
│   └── inventory.spec.js     # Script testing otomatis E2E Playwright (Loudysa)
├── views/
│   ├── error.ejs             # Halaman error universal
│   ├── home.ejs              # Halaman Dashboard utama
│   ├── index.ejs             # Halaman portal utama
│   ├── login.ejs             # Halaman login
│   └── inventory/
│       ├── sidebar.ejs       # Komponen navigasi logistik
│       ├── items/            # Halaman master data barang (Dinda)
│       └── stock/            # Halaman stok opname & laporan (Loudysa)
├── app.js                    # Konfigurasi middleware utama Express
├── package.json              # Daftar ketergantungan (dependencies)
└── .env                      # Konfigurasi variabel lingkungan (environment variables)
```

⚙️ Panduan Inisialisasi & Instalasi
Ikuti langkah-langkah berikut untuk menjalankan aplikasi B11-Stok-Opname di komputer lokal Anda:

### 1. Clone Repositori
```bash
git clone https://github.com/loudysaazisvi/B11-Stok-Opname.git
cd B11-Stok-Opname
```

### 2. Instal Ketergantungan (Dependencies)
```bash
npm install
```

### 3. Konfigurasi Variabel Lingkungan (.env)
Buat berkas bernama `.env` di direktori utama proyek Anda dan isi dengan konfigurasi database MySQL Anda:
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=password_mysql_anda
DB_NAME=facultyware
SESSION_SECRET=rahasia123
PORT=3000
```

### 4. Siapkan Database
* Buat database baru bernama `facultyware` di MySQL server lokal Anda.
* Impor berkas database `db_tb_pweb_v2 (2).sql` yang berada di root proyek untuk membuat skema tabel dan mengisi data awal.
* Jalankan script inisialisasi user uji coba:
```bash
node scripts/init_db.js
```

### 5. Jalankan Aplikasi
Mode Produksi:
```bash
npm start
```
Mode Pengembangan (dengan Auto-Reload):
```bash
npm run dev
```
Buka peramban (browser) Anda dan akses alamat `http://localhost:3000`.

🔑 Hak Akses & Akun Uji Coba
Berdasarkan inisialisasi database dan script `init_db.js`, Anda dapat masuk ke sistem menggunakan akun uji coba berikut:

* **Role**: admin_logistik
* **Username**: `admin`
* **Password**: `password`

🛡️ Sistem Otorisasi (ACL)
Proyek ini dilengkapi dengan Role-Based Access Control (RBAC) / Access Control List (ACL) yang membatasi akses rute halaman berdasarkan permissions pengguna.
* Tabel terkait: `roles`, `permissions`, `role_has_permissions`, dan `model_has_roles`.
* Rute dilindungi menggunakan middleware `checkPermission` pada rute `routes/inventory.js` yang merujuk pada berkas `middlewares/acl.js`.

🧪 Pengujian E2E (End-to-End Testing)
Proyek ini telah dilengkapi dengan unit test otomatis berbasis **Playwright** untuk memverifikasi seluruh alur sistem (login, daftar stok, form stok opname, riwayat transaksi, hingga cetak laporan).

Untuk menjalankan pengujian otomatis:
1. Pastikan server lokal Anda aktif (`npm start`).
2. Jalankan perintah berikut di terminal:
```bash
npx playwright test
```
*Laporan hasil pengetesan interaktif dapat dibuka melalui `npx playwright show-report`.*
