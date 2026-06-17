const db = require('../../lib/db');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

// Validasi adjustment
function validateAdjustment(body) {
  const errors = [];
  if (body.quantity === undefined || body.quantity === '')
    errors.push('Jumlah fisik stok wajib diisi');
  else if (!Number.isInteger(Number(body.quantity)) || Number(body.quantity) < 0)
    errors.push('Jumlah stok harus berupa angka bulat non-negatif');
  if (!body.notes || body.notes.trim() === '')
    errors.push('Alasan perubahan wajib diisi');
  return errors;
}

// Fitur 1 - daftar stok terkini
const index = async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const filter = req.query.filter || ''; // 'low' untuk stok di bawah minimal
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    let where = '(i.name LIKE ? OR i.code LIKE ?)';
    let params = [`%${search}%`, `%${search}%`];
    if (filter === 'low') {
      where += ' AND COALESCE(inv.quantity, 0) < i.minimal_quantity AND i.minimal_quantity >= 0';
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id WHERE ${where}`,
      params
    );

    const [[counts]] = await db.query(
      `SELECT 
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) >= i.minimal_quantity AND COALESCE(inv.quantity, 0) > 0 THEN 1 END) as normal,
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) < i.minimal_quantity AND COALESCE(inv.quantity, 0) > 0 THEN 1 END) as low,
        COUNT(CASE WHEN COALESCE(inv.quantity, 0) = 0 THEN 1 END) as empty_stock
       FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE (i.name LIKE ? OR i.code LIKE ?)`,
      [`%${search}%`, `%${search}%`]
    );

    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${where}
       ORDER BY i.code ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.render('inventory/stock/index', {
      title: 'Laporan Stok Barang',
      user: req.session.username,
      items,
      search,
      filter,
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

// Fitur 2 - riwayat stok per barang
const history = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const filterType = req.query.type || '';
    const filterStart = req.query.start || '';
    const filterEnd = req.query.end || '';

    const [itemRows] = await db.query('SELECT * FROM items WHERE id = ?', [req.params.id]);
    if (itemRows.length === 0) return res.redirect('/inventory/stock?error=Barang tidak ditemukan');

    let where = 'item_id = ?';
    let params = [req.params.id];
    if (filterType) { where += ' AND type = ?'; params.push(filterType); }
    if (filterStart) { where += ' AND transaction_date >= ?'; params.push(filterStart); }
    if (filterEnd) { where += ' AND transaction_date <= ?'; params.push(filterEnd); }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM inventory_transactions WHERE ${where}`, params
    );
    const [transactions] = await db.query(
      `SELECT * FROM inventory_transactions WHERE ${where}
       ORDER BY transaction_date DESC, created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[stockRow]] = await db.query(
      'SELECT COALESCE(quantity, 0) as stock FROM inventories WHERE item_id = ?', [req.params.id]
    );

    res.render('inventory/stock/history', {
      title: 'Riwayat Stok',
      user: req.session.username,
      item: itemRows[0],
      currentStock: stockRow ? stockRow.stock : 0,
      transactions,
      filterType,
      filterStart,
      filterEnd,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalData: total,
      formatDateOnlyIndo,
      success: req.query.success || null,
      error: req.query.error || null
    });
  } catch (err) { next(err); }
};

// Fitur 3 - form adjustment
const adjustmentForm = async (req, res, next) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id WHERE i.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.redirect('/inventory/stock?error=Barang tidak ditemukan');
    res.render('inventory/stock/adjustment', {
      title: 'Update Stok Opname',
      user: req.session.username,
      item: rows[0],
      errors: [],
      old: {}
    });
  } catch (err) { next(err); }
};

// Fitur 3 - proses adjustment
const adjustment = async (req, res, next) => {
  const errors = validateAdjustment(req.body);
  if (errors.length > 0) {
    const [rows] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id WHERE i.id = ?`,
      [req.params.id]
    );
    return res.render('inventory/stock/adjustment', {
      title: 'Update Stok Opname',
      user: req.session.username,
      item: rows[0],
      errors,
      old: req.body
    });
  }
  try {
    const { quantity, notes } = req.body;
    const newQty = Number(quantity);
    const [[currentRow]] = await db.query(
      'SELECT COALESCE(quantity, 0) as qty FROM inventories WHERE item_id = ?', [req.params.id]
    );
    const currentQty = currentRow ? currentRow.qty : 0;
    const selisih = newQty - currentQty;

    await db.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity, transaction_date, reference, notes, created_at, updated_at)
       VALUES (?, 'ADJUSTMENT', ?, CURDATE(), NULL, ?, NOW(), NOW())`,
      [req.params.id, selisih, notes.trim()]
    );

    const [invExist] = await db.query('SELECT id FROM inventories WHERE item_id = ?', [req.params.id]);
    if (invExist.length > 0) {
      await db.query('UPDATE inventories SET quantity = ?, updated_at = NOW() WHERE item_id = ?', [newQty, req.params.id]);
    } else {
      await db.query('INSERT INTO inventories (item_id, quantity, created_at, updated_at) VALUES (?, ?, NOW(), NOW())', [req.params.id, newQty]);
    }

    res.redirect(`/inventory/stock/${req.params.id}/history?success=Stok berhasil diperbarui`);
  } catch (err) { next(err); }
};

// Fitur 4 - laporan per periode
const report = async (req, res, next) => {
  try {
    const start = req.query.start || '';
    const end = req.query.end || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    let data = [];
    let total = 0;
    let errors = [];

    if (start && end) {
      if (new Date(start) > new Date(end)) {
        errors.push('Tanggal mulai tidak boleh lebih dari tanggal akhir');
      } else {
        const [[{ cnt }]] = await db.query(
          `SELECT COUNT(*) as cnt FROM inventory_transactions it
           WHERE it.type = 'ADJUSTMENT' AND it.transaction_date BETWEEN ? AND ?`,
          [start, end]
        );
        total = cnt;
        const [rows] = await db.query(
          `SELECT it.*, i.name as item_name, i.code as item_code, i.unit
           FROM inventory_transactions it
           JOIN items i ON it.item_id = i.id
           WHERE it.type = 'ADJUSTMENT' AND it.transaction_date BETWEEN ? AND ?
           ORDER BY it.transaction_date DESC, it.id DESC LIMIT ? OFFSET ?`,
          [start, end, limit, offset]
        );
        data = rows;

        // Tulis log ke riwayat laporan jika ada data dan di halaman pertama
        if (data.length > 0 && page === 1) {
          const refPeriod = `${start} s/d ${end}`;
          const [existingLog] = await db.query(
            `SELECT id FROM inventory_transactions WHERE type = 'report' AND reference = ?`,
            [refPeriod]
          );
          if (existingLog.length === 0) {
            await db.query(
              `INSERT INTO inventory_transactions (item_id, type, quantity, transaction_date, reference, notes, created_at, updated_at)
               VALUES (NULL, 'report', 0, CURDATE(), ?, ?, NOW(), NOW())`,
              [refPeriod, `Laporan opname digenerate oleh ${req.session.username || 'Admin'}`]
            );
          }
        }
      }
    }

    res.render('inventory/stock/report', {
      title: 'Laporan Stok Opname',
      user: req.session.username,
      data,
      start,
      end,
      errors,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalData: total,
      formatDateOnlyIndo
    });
  } catch (err) { next(err); }
};

// Fitur 5 - export PDF
const exportPDF = async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.redirect('/inventory/stock/report?error=Periode harus diisi');

    const [data] = await db.query(
      `SELECT it.*, i.name as item_name, i.code as item_code, i.unit
       FROM inventory_transactions it
       JOIN items i ON it.item_id = i.id
       WHERE it.type = 'ADJUSTMENT' AND it.transaction_date BETWEEN ? AND ?
       ORDER BY it.transaction_date DESC, it.id DESC`,
      [start, end]
    );

    const doc = new PDFDocument({ margin: 50, size: 'A4', layout: 'landscape' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-stok-${start}-${end}.pdf"`);
    doc.pipe(res);

    const pageW = doc.page.width;
    const margin = 50;
    const contentW = pageW - margin * 2;

    // ── Header ──────────────────────────────────────────────
    doc.fontSize(16).font('Helvetica-Bold')
       .text('LAPORAN STOK OPNAME', margin, 50, { align: 'center', width: contentW });
    doc.fontSize(10).font('Helvetica')
       .text('Fakultas Teknologi Informasi - Universitas Andalas', margin, 72, { align: 'center', width: contentW });
    doc.fontSize(10)
       .text(`Periode: ${formatDateOnlyIndo(start)}  s/d  ${formatDateOnlyIndo(end)}`, margin, 88, { align: 'center', width: contentW });

    // Garis bawah header
    doc.moveTo(margin, 105).lineTo(pageW - margin, 105).strokeColor('#cccccc').lineWidth(1).stroke();
    doc.strokeColor('#000000');

    // ── Definisi kolom tabel ─────────────────────────────────
    // [label, x, width, align]
    const cols = [
      { label: 'No',           x: margin,       w: 28,  align: 'center' },
      { label: 'Tanggal',      x: margin + 28,  w: 95,  align: 'left'   },
      { label: 'Kode Barang',  x: margin + 123, w: 75,  align: 'left'   },
      { label: 'Nama Barang',  x: margin + 198, w: 175, align: 'left'   },
      { label: 'Selisih',      x: margin + 373, w: 55,  align: 'center' },
      { label: 'Keterangan',   x: margin + 428, w: contentW - 378, align: 'left' },
    ];

    // ── Header row tabel ─────────────────────────────────────
    let rowY = 115;
    const rowH = 16;
    const headerH = 20;

    doc.rect(margin, rowY, contentW, headerH).fillAndStroke('#f3f4f6', '#e5e7eb');
    doc.fillColor('#374151').fontSize(8).font('Helvetica-Bold');
    cols.forEach(col => {
      doc.text(col.label, col.x + 3, rowY + 6, { width: col.w - 6, align: col.align, lineBreak: false });
    });
    doc.fillColor('#000000');
    rowY += headerH;

    // Garis bawah header tabel
    doc.moveTo(margin, rowY).lineTo(pageW - margin, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();

    // ── Data rows ────────────────────────────────────────────
    doc.font('Helvetica').fontSize(8);
    data.forEach((row, idx) => {
      if (rowY > doc.page.height - 70) {
        doc.addPage({ layout: 'landscape' });
        rowY = 50;
        // Repeat header
        doc.rect(margin, rowY, contentW, headerH).fillAndStroke('#f3f4f6', '#e5e7eb');
        doc.fillColor('#374151').fontSize(8).font('Helvetica-Bold');
        cols.forEach(col => {
          doc.text(col.label, col.x + 3, rowY + 6, { width: col.w - 6, align: col.align, lineBreak: false });
        });
        doc.fillColor('#000000').font('Helvetica');
        rowY += headerH;
        doc.moveTo(margin, rowY).lineTo(pageW - margin, rowY).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
      }

      // Row background on alternate rows
      if (idx % 2 === 1) {
        doc.rect(margin, rowY, contentW, rowH).fill('#f9fafb');
      }
      doc.fillColor('#111827');

      const txDate = formatDateOnlyIndo(row.transaction_date);
      const qty = (row.quantity > 0 ? '+' : '') + row.quantity + ' ' + (row.unit || '');
      const keterangan = (row.notes || '-').substring(0, 40);

      const values = [
        String(idx + 1),
        txDate,
        row.item_code || '-',
        row.item_name || '-',
        qty,
        keterangan
      ];

      cols.forEach((col, ci) => {
        doc.text(values[ci], col.x + 3, rowY + 4, { width: col.w - 6, align: col.align, lineBreak: false });
      });

      // Garis bawah baris
      rowY += rowH;
      doc.moveTo(margin, rowY).lineTo(pageW - margin, rowY).strokeColor('#f3f4f6').lineWidth(0.3).stroke();
    });

    // ── Footer ────────────────────────────────────────────────
    doc.moveTo(margin, rowY + 8).lineTo(pageW - margin, rowY + 8).strokeColor('#cccccc').lineWidth(1).stroke();
    doc.fontSize(8).fillColor('#6b7280').font('Helvetica')
       .text(`Total: ${data.length} transaksi opname`, margin, rowY + 12, { align: 'right', width: contentW })
       .text(`Dicetak: ${formatDateOnlyIndo(new Date())}  |  Facultyware — Logistik & Inventori FTI UNAND`, margin, rowY + 24, { align: 'left', width: contentW });
    doc.end();
  } catch (err) { next(err); }
};

// Fitur 5 - export Excel
const exportExcel = async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.redirect('/inventory/stock/report?error=Periode harus diisi');

    const [data] = await db.query(
      `SELECT it.*, i.name as item_name, i.code as item_code, i.unit
       FROM inventory_transactions it
       JOIN items i ON it.item_id = i.id
       WHERE it.type = 'ADJUSTMENT' AND it.transaction_date BETWEEN ? AND ?
       ORDER BY it.transaction_date DESC, it.id DESC`,
      [start, end]
    );

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Laporan Stok Opname');

    sheet.mergeCells('A1:G1');
    sheet.getCell('A1').value = 'Laporan Stok Opname';
    sheet.getCell('A1').font = { bold: true, size: 14 };
    sheet.getCell('A1').alignment = { horizontal: 'center' };

    sheet.mergeCells('A2:G2');
    sheet.getCell('A2').value = `Periode: ${start} s/d ${end}`;
    sheet.getCell('A2').alignment = { horizontal: 'center' };

    sheet.addRow([]);

    sheet.addRow(['No', 'Kode Barang', 'Nama Barang', 'Tanggal', 'Selisih', 'Satuan', 'Keterangan']);
    sheet.getRow(4).font = { bold: true };
    sheet.columns = [
      { key: 'no', width: 5 },
      { key: 'code', width: 15 },
      { key: 'name', width: 30 },
      { key: 'date', width: 15 },
      { key: 'qty', width: 10 },
      { key: 'unit', width: 10 },
      { key: 'notes', width: 40 },
    ];

    data.forEach((row, i) => {
      sheet.addRow([
        i + 1,
        row.item_code,
        row.item_name,
        formatDateOnlyIndo(row.transaction_date),
        row.quantity,
        row.unit,
        row.notes || '-'
      ]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-stok-${start}-${end}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
};

function formatDateIndo(dateStr) {
  const date = new Date(dateStr);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();
  
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  
  return `${dayName}, ${day} ${monthName} ${year} (${hours}:${minutes})`;
}

function formatDateOnlyIndo(dateStr) {
  const date = new Date(dateStr);
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const monthName = months[date.getMonth()];
  const year = date.getFullYear();
  
  return `${dayName}, ${day} ${monthName} ${year}`;
}

// Fitur 6 - riwayat laporan
const reportHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM inventory_transactions WHERE type = 'report'`
    );
    const [logs] = await db.query(
      `SELECT it.*, i.name as item_name FROM inventory_transactions it
       LEFT JOIN items i ON it.item_id = i.id
       WHERE it.type = 'report'
       ORDER BY it.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.render('inventory/stock/report-history', {
      title: 'Riwayat Laporan',
      user: req.session.username,
      logs,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalData: total,
      formatDateIndo
    });
  } catch (err) { next(err); }
};

// REST API
const apiList = async (req, res, next) => {
  try {
    const search = req.query.search || '';
    const filter = req.query.filter || '';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    let where = '(i.name LIKE ? OR i.code LIKE ?)';
    let params = [`%${search}%`, `%${search}%`];
    if (filter === 'low') {
      where += ' AND COALESCE(inv.quantity, 0) < i.minimal_quantity AND i.minimal_quantity >= 0';
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id WHERE ${where}`, params
    );
    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock FROM items i
       LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${where} ORDER BY i.code ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

const apiTransactions = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) as total FROM inventory_transactions WHERE item_id = ?', [req.params.id]
    );
    const [rows] = await db.query(
      `SELECT * FROM inventory_transactions WHERE item_id = ?
       ORDER BY transaction_date DESC LIMIT ? OFFSET ?`,
      [req.params.id, limit, offset]
    );
    res.json({ success: true, data: rows, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) { next(err); }
};

module.exports = { index, history, adjustmentForm, adjustment, report, exportPDF, exportExcel, reportHistory, apiList, apiTransactions };
