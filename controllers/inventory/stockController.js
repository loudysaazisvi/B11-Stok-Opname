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

module.exports = { index };
