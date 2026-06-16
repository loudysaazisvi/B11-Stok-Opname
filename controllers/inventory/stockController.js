const db = require('../../lib/db');

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

module.exports = { index, history };
