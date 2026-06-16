const db = require('../../lib/db');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// ─── Helper Validasi ───────────────────────────────────────────
function validateItem(body) {
  const errors = [];
  if (!body.name || body.name.trim() === '')
    errors.push('Nama barang wajib diisi');
  if (!body.code || body.code.trim() === '')
    errors.push('Kode barang wajib diisi');
  if (!body.unit || body.unit.trim() === '')
    errors.push('Satuan wajib diisi');
  if (body.minimal_quantity === '' || body.minimal_quantity === undefined)
    errors.push('Stok minimal wajib diisi');
  else if (isNaN(body.minimal_quantity) || Number(body.minimal_quantity) < 0)
    errors.push('Stok minimal harus angka positif');
  return errors;
}

// ─── Fitur 1: List & Filter Barang ────────────────────────────
const index = async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const showInactive = req.query.status === 'nonaktif';
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    // Barang nonaktif ditandai dengan minimal_quantity = -1
    let statusFilter = showInactive
      ? 'i.minimal_quantity = -1'
      : 'i.minimal_quantity != -1';

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM items i
       WHERE ${statusFilter} AND (i.name LIKE ? OR i.code LIKE ?)`,
      [`%${search}%`, `%${search}%`]
    );

    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${statusFilter} AND (i.name LIKE ? OR i.code LIKE ?)
       ORDER BY i.name ASC
       LIMIT ? OFFSET ?`,
      [`%${search}%`, `%${search}%`, limit, offset]
    );

    res.render('inventory/items/index', {
      title: 'Master Data Barang',
      user: req.session.username,
      items,
      search,
      showInactive,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalData: total,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) { next(err); }
};

// ─── Fitur 2: Tambah Barang ────────────────────────────────────
const createForm = (req, res) => {
  res.render('inventory/items/create', {
    title: 'Tambah Barang',
    user: req.session.username,
    errors: [],
    old: {}
  });
};

const store = async (req, res, next) => {
  const errors = validateItem(req.body);
  if (errors.length > 0) {
    return res.render('inventory/items/create', {
      title: 'Tambah Barang',
      user: req.session.username,
      errors,
      old: req.body
    });
  }
  try {
    const { name, code, unit, minimal_quantity, description } = req.body;
    // Cek duplikat kode
    const [exist] = await db.query('SELECT id FROM items WHERE code = ?', [code.trim()]);
    if (exist.length > 0) {
      return res.render('inventory/items/create', {
        title: 'Tambah Barang',
        user: req.session.username,
        errors: ['Kode barang sudah digunakan, gunakan kode lain'],
        old: req.body
      });
    }
    const [result] = await db.query(
      `INSERT INTO items (name, code, unit, minimal_quantity, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [name.trim(), code.trim(), unit.trim(), Number(minimal_quantity), description || '']
    );
    // Inisialisasi stok 0 di tabel inventories
    await db.query(
      `INSERT INTO inventories (item_id, quantity, created_at, updated_at) VALUES (?, 0, NOW(), NOW())`,
      [result.insertId]
    );
    res.redirect('/inventory/items?success=Barang berhasil ditambahkan');
  } catch (err) { next(err); }
};

// ─── Fitur 3: Edit Barang ──────────────────────────────────────
const editForm = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.redirect('/inventory/items?error=Barang tidak ditemukan');
    res.render('inventory/items/edit', {
      title: 'Edit Barang',
      user: req.session.username,
      item: rows[0],
      errors: []
    });
  } catch (err) { next(err); }
};

const update = async (req, res, next) => {
  const errors = validateItem(req.body);
  if (errors.length > 0) {
    const [rows] = await db.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    return res.render('inventory/items/edit', {
      title: 'Edit Barang',
      user: req.session.username,
      item: { ...rows[0], ...req.body },
      errors
    });
  }
  try {
    const { name, code, unit, minimal_quantity, description } = req.body;
    // Cek duplikat kode (kecuali item sendiri)
    const [exist] = await db.query(
      'SELECT id FROM items WHERE code = ? AND id != ?', [code.trim(), req.params.id]
    );
    if (exist.length > 0) {
      const [rows] = await db.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
      return res.render('inventory/items/edit', {
        title: 'Edit Barang',
        user: req.session.username,
        item: { ...rows[0], ...req.body },
        errors: ['Kode barang sudah digunakan barang lain']
      });
    }
    await db.query(
      `UPDATE items SET name=?, code=?, unit=?, minimal_quantity=?, description=?, updated_at=NOW() WHERE id=?`,
      [name.trim(), code.trim(), unit.trim(), Number(minimal_quantity), description || '', req.params.id]
    );
    res.redirect('/inventory/items?success=Barang berhasil diperbarui');
  } catch (err) { next(err); }
};

// ─── Fitur 4: Nonaktifkan & Aktifkan Barang ───────────────────
// Menggunakan minimal_quantity = -1 sebagai flag nonaktif (tanpa tambah kolom baru)
const deactivate = async (req, res, next) => {
  try {
    const [rows] = await db.query('SELECT minimal_quantity FROM items WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.redirect('/inventory/items?error=Barang tidak ditemukan');
    if (rows[0].minimal_quantity === -1) return res.redirect('/inventory/items?error=Barang sudah nonaktif');
    await db.query(
      `UPDATE items SET minimal_quantity = -1, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );
    res.redirect('/inventory/items?success=Barang berhasil dinonaktifkan');
  } catch (err) { next(err); }
};

const activate = async (req, res, next) => {
  try {
    await db.query(
      `UPDATE items SET minimal_quantity = 0, updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );
    res.redirect('/inventory/items?success=Barang berhasil diaktifkan kembali');
  } catch (err) { next(err); }
};

// ─── Fitur 5: Ekspor & Impor Massal Excel ─────────────────────
const exportItems = async (req, res, next) => {
  try {
    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE i.minimal_quantity != -1
       ORDER BY i.name ASC`
    );
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data Barang');
    sheet.columns = [
      { header: 'No', key: 'no', width: 5 },
      { header: 'Kode', key: 'code', width: 15 },
      { header: 'Nama Barang', key: 'name', width: 30 },
      { header: 'Satuan', key: 'unit', width: 10 },
      { header: 'Stok Minimal', key: 'minimal_quantity', width: 15 },
      { header: 'Stok Saat Ini', key: 'stock', width: 15 },
      { header: 'Deskripsi', key: 'description', width: 30 },
    ];
    sheet.getRow(1).font = { bold: true };
    items.forEach((item, i) => {
      sheet.addRow({ no: i + 1, ...item });
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="data-barang.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
};

const importItems = [
  upload.single('file'),
  async (req, res, next) => {
    if (!req.file) return res.redirect('/inventory/items?error=File tidak ditemukan');
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
      const sheet = workbook.worksheets[0];
      
      // Deteksi Header Dinamis
      const headerRow = sheet.getRow(1);
      let colIndices = {
        code: -1,
        name: -1,
        unit: -1,
        minimal_quantity: -1,
        description: -1
      };

      headerRow.eachCell((cell, colNumber) => {
        const text = String(cell.value || '').toLowerCase().trim();
        if (text.includes('kode')) colIndices.code = colNumber;
        else if (text.includes('nama')) colIndices.name = colNumber;
        else if (text.includes('satuan') || text.includes('unit')) colIndices.unit = colNumber;
        else if (text.includes('min') || text.includes('minimal')) colIndices.minimal_quantity = colNumber;
        else if (text.includes('deskripsi') || text.includes('keterangan') || text.includes('description')) colIndices.description = colNumber;
      });

      // Validasi kolom wajib minimal harus ada kode dan nama barang
      if (colIndices.code === -1 || colIndices.name === -1) {
        return res.redirect('/inventory/items?error=Format Excel tidak valid. Kolom Kode Barang dan Nama Barang wajib ada.');
      }

      const rowsToProcess = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header
        
        // Ambil value berdasarkan indeks dinamis
        const code = colIndices.code !== -1 ? row.getCell(colIndices.code).value : null;
        const name = colIndices.name !== -1 ? row.getCell(colIndices.name).value : null;
        const unit = colIndices.unit !== -1 ? row.getCell(colIndices.unit).value : 'pcs';
        const minimal_quantity = colIndices.minimal_quantity !== -1 ? row.getCell(colIndices.minimal_quantity).value : 0;
        const description = colIndices.description !== -1 ? row.getCell(colIndices.description).value : '';

        // Kumpulkan baris yang valid (kode & nama terisi)
        if (code && name) {
          rowsToProcess.push({
            code: String(code).trim(),
            name: String(name).trim(),
            unit: String(unit).trim(),
            minimal_quantity: isNaN(Number(minimal_quantity)) ? 0 : Number(minimal_quantity),
            description: description ? String(description).trim() : ''
          });
        }
      });

      let imported = 0;
      let skipped = 0;

      // Proses Asinkron yang Benar
      for (const rowData of rowsToProcess) {
        try {
          // Cek duplikat kode
          const [exist] = await db.query('SELECT id FROM items WHERE code = ?', [rowData.code]);
          if (exist.length > 0) {
            skipped++;
            continue;
          }

          // Insert ke tabel items
          const [result] = await db.query(
            `INSERT INTO items (name, code, unit, minimal_quantity, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
            [rowData.name, rowData.code, rowData.unit, rowData.minimal_quantity, rowData.description]
          );

          // Inisialisasi stok 0 di tabel inventories
          await db.query(
            `INSERT INTO inventories (item_id, quantity, created_at, updated_at)
             VALUES (?, 0, NOW(), NOW())`,
            [result.insertId]
          );

          imported++;
        } catch (err) {
          skipped++;
        }
      }

      res.redirect(`/inventory/items?success=${imported} barang berhasil diimpor, ${skipped} dilewati`);
    } catch (err) { next(err); }
  }
];

// ─── Fitur 6: QR Code per Barang ──────────────────────────────
const qrcode = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE i.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.redirect('/inventory/items?error=Barang tidak ditemukan');
    const item = rows[0];
    const qrData = JSON.stringify({ id: item.id, code: item.code, name: item.name });
    const qrImage = await QRCode.toDataURL(qrData);
    res.render('inventory/items/qrcode', {
      title: 'QR Code Barang',
      user: req.session.username,
      item,
      qrImage
    });
  } catch (err) { next(err); }
};

// ─── REST API: Daftar Barang (JSON) ───────────────────────────
const apiList = async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM items WHERE (name LIKE ? OR code LIKE ?) AND minimal_quantity != -1`,
      [`%${search}%`, `%${search}%`]
    );
    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE (i.name LIKE ? OR i.code LIKE ?) AND i.minimal_quantity != -1
       ORDER BY i.name ASC LIMIT ? OFFSET ?`,
      [`%${search}%`, `%${search}%`, limit, offset]
    );
    res.json({
      success: true,
      data: items,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) { next(err); }
};

// ─── Fitur 2b: Unduh Template Impor Excel ─────────────────────
const downloadTemplate = async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Template Impor Barang');
    
    sheet.columns = [
      { header: 'Kode Barang', key: 'code', width: 20 },
      { header: 'Nama Barang', key: 'name', width: 35 },
      { header: 'Satuan', key: 'unit', width: 15 },
      { header: 'Stok Minimal', key: 'minimal_quantity', width: 15 },
      { header: 'Deskripsi', key: 'description', width: 40 }
    ];

    // Format headers
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.height = 20;

    // Add dummy/example data
    sheet.addRow({
      code: 'BRG-001',
      name: 'Kertas HVS A4 80gr',
      unit: 'rim',
      minimal_quantity: 10,
      description: 'Kertas HVS merek SIDU untuk cetak dokumen'
    });
    sheet.addRow({
      code: 'BRG-002',
      name: 'Spidol Boardmarker Hitam',
      unit: 'pcs',
      minimal_quantity: 5,
      description: 'Spidol Snowman warna hitam untuk papan tulis'
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template-impor-barang.xlsx"');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
};

module.exports = {
  index, createForm, store, editForm, update,
  deactivate, activate, exportItems, importItems,
  qrcode, apiList, downloadTemplate
};
