const db = require('../../lib/db');

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

module.exports = { index, history, adjustmentForm, adjustment };
