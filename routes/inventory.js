var express = require('express');
var router = express.Router();
const { isAuthenticated } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/acl');
const itemsController = require('../controllers/inventory/itemsController');
const stockController = require('../controllers/inventory/stockController');

const canManage = checkPermission(['inventory.manage', 'admin', 'manage_assets']);

// ─── DINDA: Master Data Barang ───────────────────────────────
// Rute STATIS dulu sebelum rute dinamis (:id)
// Fitur 1 - list & filter barang
router.get('/items', isAuthenticated, canManage, itemsController.index);
// Fitur 2 - tambah barang
router.get('/items/create', isAuthenticated, canManage, itemsController.createForm);
router.post('/items/create', isAuthenticated, canManage, itemsController.store);
// Fitur 5 - ekspor & impor massal (statis, harus di atas /items/:id)
router.get('/items/export', isAuthenticated, canManage, itemsController.exportItems);
router.post('/items/import', isAuthenticated, canManage, itemsController.importItems);
// REST API Dinda (statis, harus di atas /items/:id)
router.get('/api/items', isAuthenticated, canManage, itemsController.apiList);
// Rute DINAMIS dengan :id
// Fitur 3 - edit barang
router.get('/items/:id/edit', isAuthenticated, canManage, itemsController.editForm);
router.post('/items/:id/edit', isAuthenticated, canManage, itemsController.update);
// Fitur 4 - nonaktifkan / aktifkan kembali
router.post('/items/:id/deactivate', isAuthenticated, canManage, itemsController.deactivate);
router.post('/items/:id/activate', isAuthenticated, canManage, itemsController.activate);
// Fitur 6 - QR Code
router.get('/items/:id/qrcode', isAuthenticated, canManage, itemsController.qrcode);

// ─── LOUDYSA: Stok & Laporan ────────────────────────────────
// Fitur 1 - daftar stok terkini
router.get('/stock', isAuthenticated, canManage, stockController.index);
// Rute STATIS laporan (harus di atas /stock/:id)
// Fitur 4 - laporan per periode
router.get('/stock/report', isAuthenticated, canManage, stockController.report);
// Fitur 6 - riwayat laporan
router.get('/stock/report/history', isAuthenticated, canManage, stockController.reportHistory);
// Fitur 5 - export PDF & Excel
router.get('/stock/report/export/pdf', isAuthenticated, canManage, stockController.exportPDF);
router.get('/stock/report/export/excel', isAuthenticated, canManage, stockController.exportExcel);
// REST API Loudysa (statis)
router.get('/api/stock', isAuthenticated, canManage, stockController.apiList);
// Rute DINAMIS dengan :id
// Fitur 2 - riwayat stok per barang
router.get('/stock/:id/history', isAuthenticated, canManage, stockController.history);
// Fitur 3 - form & proses adjustment
router.get('/stock/:id/adjustment', isAuthenticated, canManage, stockController.adjustmentForm);
router.post('/stock/:id/adjustment', isAuthenticated, canManage, stockController.adjustment);
router.get('/api/stock/:id/transactions', isAuthenticated, canManage, stockController.apiTransactions);

module.exports = router;
