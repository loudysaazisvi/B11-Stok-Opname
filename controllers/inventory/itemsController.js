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

    const [[counts]] = await db.query(
      `SELECT 
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) >= i.minimal_quantity AND COALESCE(inv.quantity, 0) > 0 THEN 1 END) as normal,
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) < i.minimal_quantity AND COALESCE(inv.quantity, 0) > 0 THEN 1 END) as low,
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) = 0 THEN 1 END) as empty_stock
       FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${statusFilter} AND (i.name LIKE ? OR i.code LIKE ?)`,
      [`%${search}%`, `%${search}%`]
    );

    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${statusFilter} AND (i.name LIKE ? OR i.code LIKE ?)
       ORDER BY i.code ASC
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
      normalCount: counts.normal,
      lowCount: counts.low,
      emptyCount: counts.empty_stock,
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
    const { name, unit, minimal_quantity, description } = req.body;

    // Auto-generate kode barang berikutnya: BRG-001, BRG-002, dst.
    const [[maxCodeRow]] = await db.query(
      `SELECT code FROM items WHERE code REGEXP '^BRG-[0-9]+$' ORDER BY CAST(SUBSTRING(code, 5) AS UNSIGNED) DESC LIMIT 1`
    );
    let nextNum = 1;
    if (maxCodeRow && maxCodeRow.code) {
      const match = maxCodeRow.code.match(/^BRG-(\d+)$/);
      if (match) nextNum = parseInt(match[1]) + 1;
    }
    const autoCode = `BRG-${String(nextNum).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO items (name, code, unit, minimal_quantity, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
      [name.trim(), autoCode, unit.trim(), Number(minimal_quantity), description || '']
    );
    // Inisialisasi stok 0 di tabel inventories
    await db.query(
      `INSERT INTO inventories (item_id, quantity, created_at, updated_at) VALUES (?, 0, NOW(), NOW())`,
      [result.insertId]
    );
    res.redirect(`/inventory/items?success=Barang berhasil ditambahkan dengan kode ${autoCode}`);
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
       ORDER BY i.code ASC`
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
        name: -1,
        unit: -1,
        minimal_quantity: -1,
        description: -1
      };

      headerRow.eachCell((cell, colNumber) => {
        const text = String(cell.value || '').toLowerCase().trim();
        if (text.includes('nama')) colIndices.name = colNumber;
        else if (text.includes('satuan') || text.includes('unit')) colIndices.unit = colNumber;
        else if (text.includes('min') || text.includes('minimal')) colIndices.minimal_quantity = colNumber;
        else if (text.includes('deskripsi') || text.includes('keterangan') || text.includes('description')) colIndices.description = colNumber;
      });

      // Validasi kolom wajib: hanya Nama Barang
      if (colIndices.name === -1) {
        return res.redirect('/inventory/items?error=Format Excel tidak valid. Kolom Nama Barang wajib ada.');
      }

      const getValStr = (cell) => {
        if (!cell) return '';
        const val = cell.value;
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') {
          if (val.richText) return val.richText.map(t => t.text || '').join('');
          if (val.text) return String(val.text);
          if (val.result !== undefined) return String(val.result);
          return '';
        }
        return String(val);
      };

      const rowsToProcess = [];
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header

        const rawName = colIndices.name !== -1 ? getValStr(row.getCell(colIndices.name)) : '';
        const rawUnit = colIndices.unit !== -1 ? getValStr(row.getCell(colIndices.unit)) : 'pcs';
        const rawMinQty = colIndices.minimal_quantity !== -1 ? row.getCell(colIndices.minimal_quantity).value : 0;
        const rawDesc = colIndices.description !== -1 ? getValStr(row.getCell(colIndices.description)) : '';

        const name = rawName.trim();
        const unit = rawUnit.trim() || 'pcs';
        let minimal_quantity = 0;
        if (typeof rawMinQty === 'object' && rawMinQty && rawMinQty.result !== undefined) {
          minimal_quantity = isNaN(Number(rawMinQty.result)) ? 0 : Number(rawMinQty.result);
        } else {
          minimal_quantity = isNaN(Number(rawMinQty)) ? 0 : Number(rawMinQty);
        }

        // Kumpulkan baris yang valid (nama terisi)
        if (name) {
          rowsToProcess.push({
            name,
            unit,
            minimal_quantity,
            description: rawDesc.trim()
          });
        }
      });

      // Ambil kode BRG-XXX tertinggi dari database untuk auto-generate
      const [[maxCodeRow]] = await db.query(
        `SELECT code FROM items WHERE code REGEXP '^BRG-[0-9]+$' ORDER BY CAST(SUBSTRING(code, 5) AS UNSIGNED) DESC LIMIT 1`
      );
      let nextNum = 1;
      if (maxCodeRow && maxCodeRow.code) {
        const match = maxCodeRow.code.match(/^BRG-(\d+)$/);
        if (match) nextNum = parseInt(match[1]) + 1;
      }

      let imported = 0;
      let skipped = 0;

      // Proses Asinkron yang Benar
      for (const rowData of rowsToProcess) {
        try {
          // Cek apakah nama barang sudah ada (case-insensitive) → update
          const [exist] = await db.query(
            'SELECT id FROM items WHERE LOWER(name) = LOWER(?)',
            [rowData.name]
          );
          if (exist.length > 0) {
            await db.query(
              `UPDATE items SET unit = ?, minimal_quantity = ?, description = ?, updated_at = NOW() WHERE id = ?`,
              [rowData.unit, rowData.minimal_quantity, rowData.description, exist[0].id]
            );
            imported++;
            continue;
          }

          // Auto-generate kode barang berikutnya: BRG-001, BRG-002, dst.
          const autoCode = `BRG-${String(nextNum).padStart(3, '0')}`;
          nextNum++;

          // Insert ke tabel items
          const [result] = await db.query(
            `INSERT INTO items (name, code, unit, minimal_quantity, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
            [rowData.name, autoCode, rowData.unit, rowData.minimal_quantity, rowData.description]
          );

          // Inisialisasi stok 0 di tabel inventories
          await db.query(
            `INSERT INTO inventories (item_id, quantity, created_at, updated_at)
             VALUES (?, 0, NOW(), NOW())`,
            [result.insertId]
          );

          imported++;
        } catch (err) {
          console.error('Import error for row:', rowData, err);
          skipped++;
        }
      }

      res.redirect(`/inventory/items?success=${imported} barang berhasil diimpor/diperbarui, ${skipped} dilewati`);
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
       ORDER BY i.code ASC LIMIT ? OFFSET ?`,
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
      { header: 'Nama Barang', key: 'name', width: 35 },
      { header: 'Satuan', key: 'unit', width: 15 },
      { header: 'Stok Minimal', key: 'minimal_quantity', width: 15 },
      { header: 'Deskripsi', key: 'description', width: 40 }
    ];

    // Format headers
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } };
    headerRow.height = 22;
    headerRow.alignment = { vertical: 'middle' };

    // Add contoh data
    sheet.addRow({
      name: 'Kertas HVS A4 80gr',
      unit: 'rim',
      minimal_quantity: 10,
      description: 'Kertas HVS merek SIDU untuk cetak dokumen'
    });
    sheet.addRow({
      name: 'Spidol Boardmarker Hitam',
      unit: 'pcs',
      minimal_quantity: 5,
      description: 'Spidol Snowman warna hitam untuk papan tulis'
    });

    // Style contoh data rows
    [2, 3].forEach(r => {
      const row = sheet.getRow(r);
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
      row.alignment = { vertical: 'middle' };
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
