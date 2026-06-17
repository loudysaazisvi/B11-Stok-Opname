const { test, expect } = require('@playwright/test');

// Simpan ID barang yang dibuat untuk digunakan di skenario selanjutnya
let testItemId;
let testItemCode;

test.describe('Facultyware E2E Tests - Modul Inventori', () => {

  // Skenario 1: Autentikasi & Login
  test('1. Skenario Login - Validasi & Keberhasilan', async ({ page }) => {
    // Akses halaman login
    await page.goto('/login');
    await expect(page).toHaveTitle(/Login/);

    // Gagal login dengan password salah
    await page.fill('#username', 'admin');
    await page.fill('#password', 'salahpassword');
    await page.click('button[type="submit"]');

    // Verifikasi pesan error muncul
    const errorBox = page.locator('.error-box');
    await expect(errorBox).toBeVisible();
    await expect(errorBox).toContainText(/Username atau password salah/i);

    // Test fungsionalitas toggle eye icon password visibility
    const pwInput = page.locator('#password');
    const eyeToggle = page.locator('#toggle-pw');
    await expect(pwInput).toHaveAttribute('type', 'password');
    await eyeToggle.click();
    await expect(pwInput).toHaveAttribute('type', 'text');
    await eyeToggle.click();
    await expect(pwInput).toHaveAttribute('type', 'password');

    // Login dengan data yang benar
    await page.fill('#username', 'admin');
    await page.fill('#password', 'password');
    await page.click('button[type="submit"]');

    // Verifikasi redirect ke halaman Laporan Stok
    await expect(page).toHaveURL(/\/inventory\/stock/);
    await expect(page.locator('main header')).toContainText('Laporan Stok Barang');
  });

  // Skenario 2: Master Data Barang (Dinda)
  test('2. Skenario Master Barang - Tambah, Edit, Nonaktifkan', async ({ page }) => {
    // Login terlebih dahulu
    await page.goto('/login');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'password');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/inventory\/stock/);
    
    // Navigasi ke halaman Master Data Barang
    await page.goto('/inventory/items');

    // Klik tombol Tambah Barang Baru
    // Tombol di layout diposisikan sebagai link dengan icon tambah
    await page.click('a[href="/inventory/items/create"]');
    await expect(page).toHaveURL(/\/inventory\/items\/create/);

    // Isi formulir tambah barang
    const uniqueName = `Tes Playwright ${Date.now()}`;
    await page.fill('#nama-barang', uniqueName);
    await page.fill('#satuan-barang', 'Pcs');
    await page.fill('#stok-minimal', '10');
    await page.fill('#deskripsi-barang', 'Barang hasil pengujian otomatis Playwright');
    
    // Kirim formulir
    await page.click('#form-tambah-barang button[type="submit"]');

    // Verifikasi redirect kembali ke list dengan success alert
    await expect(page).toHaveURL(/\/inventory\/items/);
    const successAlert = page.locator('.alert-success');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(/Barang berhasil ditambahkan/i);

    // Cari barang yang baru saja dibuat lewat kolom pencarian agar terlihat (menghindari pagination)
    await page.fill('#search-barang', uniqueName);
    await page.click('#btn-cari-barang');

    // Dapatkan ID barang yang baru saja dibuat dari DOM (button Edit/Nonaktif menggunakan id)
    // Kita cari baris tabel yang mengandung nama unik barang
    const row = page.locator('tr', { hasText: uniqueName });
    await expect(row).toBeVisible();

    const editBtn = row.locator('a[id^="btn-edit-"]');
    await expect(editBtn).toBeVisible();
    const editBtnId = await editBtn.getAttribute('id');
    testItemId = editBtnId.replace('btn-edit-', '');
    
    const codeSpan = row.locator('.code-chip');
    testItemCode = await codeSpan.innerText();

    console.log(`Created Test Item ID: ${testItemId}, Code: ${testItemCode}`);

    // Klik edit barang
    await editBtn.click();
    await expect(page).toHaveURL(new RegExp(`/inventory/items/${testItemId}/edit`));

    // Edit nama barang
    const updatedName = `${uniqueName} Updated`;
    await page.fill('#edit-nama', updatedName);
    await page.click('#form-edit-barang button[type="submit"]');

    // Verifikasi perubahan nama tersimpan di list
    await expect(page).toHaveURL(/\/inventory\/items/);
    
    // Cari barang yang telah diedit lewat kolom pencarian
    await page.fill('#search-barang', updatedName);
    await page.click('#btn-cari-barang');
    await expect(page.locator('tr', { hasText: updatedName })).toBeVisible();

    // Menonaktifkan barang
    // Konfirmasi dialog browser disetujui secara otomatis oleh Playwright
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Nonaktifkan barang ini?');
      await dialog.accept();
    });
    await page.click(`#btn-nonaktif-${testItemId}`);

    // Verifikasi barang tidak ada lagi di daftar aktif (sesudah pencarian juga)
    await expect(page.locator('tr', { hasText: updatedName })).not.toBeVisible();

    // Aktifkan kembali barang via filter nonaktif
    await page.goto('/inventory/items?status=nonaktif');
    await page.fill('#search-barang', updatedName);
    await page.click('#btn-cari-barang');
    await expect(page.locator('tr', { hasText: updatedName })).toBeVisible();
    await page.click(`#btn-aktifkan-${testItemId}`);

    // Verifikasi barang kembali aktif
    await page.goto('/inventory/items');
    await page.fill('#search-barang', updatedName);
    await page.click('#btn-cari-barang');
    await expect(page.locator('tr', { hasText: updatedName })).toBeVisible();
  });

  // Skenario 3: Stok & Laporan (Loudysa)
  test('3. Skenario Stok & Laporan - Opname, Riwayat, Cetak Laporan', async ({ page }) => {
    // Pastikan kita sudah memiliki ID barang dari tes sebelumnya
    expect(testItemId).toBeDefined();

    // Login terlebih dahulu
    await page.goto('/login');
    await page.fill('#username', 'admin');
    await page.fill('#password', 'password');
    await page.click('button[type="submit"]');

    // Navigasi ke halaman Laporan Stok
    await page.goto('/inventory/stock');
    await expect(page.locator('main header')).toContainText('Laporan Stok Barang');

    // Cari item yang tadi kita buat menggunakan input pencarian (menghindari pagination)
    await page.fill('input[name="search"]', testItemCode);
    await page.click('button[type="submit"]');

    // Cari item yang tadi kita buat dan klik Opname
    const row = page.locator('tr', { hasText: testItemCode });
    await expect(row).toBeVisible();
    
    // Klik tombol Opname
    const opnameLink = row.locator('a', { hasText: 'Opname' });
    await opnameLink.click();
    await expect(page).toHaveURL(new RegExp(`/inventory/stock/${testItemId}/adjustment`));

    // Lakukan Opname (Ubah stok menjadi 15)
    await page.fill('#quantity', '15');
    await page.fill('#notes', 'Opname E2E Playwright');
    await page.click('#adjustForm button[type="submit"]');

    // Verifikasi sukses dan berada di halaman Riwayat Transaksi Barang
    await expect(page).toHaveURL(new RegExp(`/inventory/stock/${testItemId}/history`));
    const successAlert = page.locator('.alert-success');
    await expect(successAlert).toBeVisible();
    await expect(successAlert).toContainText(/Stok berhasil diperbarui/i);

    // Verifikasi log transaksi tercatat
    const txRow = page.locator('tr').nth(1); // Baris pertama data transaksi
    await expect(txRow).toContainText('+15');
    await expect(txRow).toContainText('Opname E2E Playwright');

    // Akses pembuatan Laporan Periodik
    await page.goto('/inventory/stock/report');
    await expect(page.locator('main header')).toContainText('Laporan Stok Opname');

    // Generate laporan periode hari ini
    const today = new Date().toISOString().split('T')[0];
    await page.fill('input[name="start"]', today);
    await page.fill('input[name="end"]', today);
    await page.click('button[type="submit"]');

    // Verifikasi data opname kita tercatat di tabel laporan
    const reportTable = page.locator('.data-table');
    await expect(reportTable).toContainText(testItemCode);
    await expect(reportTable).toContainText('+15');

    // Navigasi ke Riwayat Laporan untuk memverifikasi log cetak laporan tersimpan
    await page.goto('/inventory/stock/report/history');
    await expect(page.locator('main header')).toContainText('Riwayat Laporan');

    // Verifikasi riwayat laporan hari ini tercatat
    const periodString = `${today} s/d ${today}`;
    await expect(page.locator('.data-table')).toContainText(periodString);
  });
});
