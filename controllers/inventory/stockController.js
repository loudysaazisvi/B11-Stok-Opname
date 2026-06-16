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
  if (body.reference && body.reference.length > 255)
    errors.push('Nomor referensi maksimal 255 karakter');
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

    const [items] = await db.query(
      `SELECT i.*, COALESCE(inv.quantity, 0) as stock
       FROM items i LEFT JOIN inventories inv ON i.id = inv.item_id
       WHERE ${where}
       ORDER BY i.name ASC LIMIT ? OFFSET ?`,
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
      totalData: total
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
    const { quantity, notes, reference } = req.body;
    const newQty = Number(quantity);
    const [[currentRow]] = await db.query(
      'SELECT COALESCE(quantity, 0) as qty FROM inventories WHERE item_id = ?', [req.params.id]
    );
    const currentQty = currentRow ? currentRow.qty : 0;
    const selisih = newQty - currentQty;

    await db.query(
      `INSERT INTO inventory_transactions (item_id, type, quantity, transaction_date, reference, notes, created_at, updated_at)
       VALUES (?, 'ADJUSTMENT', ?, CURDATE(), ?, ?, NOW(), NOW())`,
      [req.params.id, selisih, reference || null, notes.trim()]
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
           ORDER BY it.transaction_date DESC LIMIT ? OFFSET ?`,
          [start, end, limit, offset]
        );
        data = rows;
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
      totalData: total
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
       ORDER BY it.transaction_date DESC`,
      [start, end]
    );

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-stok-${start}-${end}.pdf"`);
    doc.pipe(res);

    doc.fontSize(16).font('Helvetica-Bold').text('Laporan Stok Opname', { align: 'center' });
    doc.fontSize(11).font('Helvetica').text(`Periode: ${start} s/d ${end}`, { align: 'center' });
    doc.moveDown();

    // Header tabel
    const colX = [40, 60, 200, 280, 330, 400, 490];
    const headers = ['No', 'Kode', 'Nama Barang', 'Tanggal', 'Selisih', 'Referensi', 'Keterangan'];
    doc.fontSize(9).font('Helvetica-Bold');
    headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { width: colX[i+1] - colX[i] || 100, lineBreak: false }));
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(560, doc.y).stroke();
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    data.forEach((row, idx) => {
      const y = doc.y;
      if (y > 750) { doc.addPage(); }
      const cols = [
        String(idx + 1),
        row.item_code,
        row.item_name,
        String(row.transaction_date).substring(0, 10),
        (row.quantity > 0 ? '+' : '') + row.quantity + ' ' + row.unit,
        row.reference || '-',
        row.notes || '-'
      ];
      cols.forEach((c, i) => doc.text(c, colX[i], doc.y, { width: (colX[i+1] || 560) - colX[i], lineBreak: false }));
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(9).text(`Total: ${data.length} transaksi`, { align: 'right' });
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
       ORDER BY it.transaction_date DESC`,
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

    sheet.addRow(['No', 'Kode Barang', 'Nama Barang', 'Tanggal', 'Selisih', 'Satuan', 'Referensi', 'Keterangan']);
    sheet.getRow(4).font = { bold: true };
    sheet.columns = [
      { key: 'no', width: 5 },
      { key: 'code', width: 15 },
      { key: 'name', width: 30 },
      { key: 'date', width: 15 },
      { key: 'qty', width: 10 },
      { key: 'unit', width: 10 },
      { key: 'ref', width: 20 },
      { key: 'notes', width: 30 },
    ];

    data.forEach((row, i) => {
      sheet.addRow([
        i + 1,
        row.item_code,
        row.item_name,
        String(row.transaction_date).substring(0, 10),
        row.quantity,
        row.unit,
        row.reference || '-',
        row.notes || '-'
      ]);
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="laporan-stok-${start}-${end}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
};

// Fitur 6 - riwayat laporan
const reportHistory = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) as total FROM inventory_transactions WHERE type = 'REPORT'`
    );
    const [logs] = await db.query(
      `SELECT it.*, i.name as item_name FROM inventory_transactions it
       LEFT JOIN items i ON it.item_id = i.id
       WHERE it.type = 'REPORT'
       ORDER BY it.created_at DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    res.render('inventory/stock/report-history', {
      title: 'Riwayat Laporan',
      user: req.session.username,
      logs,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      totalData: total
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
       WHERE ${where} ORDER BY i.name ASC LIMIT ? OFFSET ?`,
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
