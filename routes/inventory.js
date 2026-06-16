var express = require('express');
var router = express.Router();
const { isAuthenticated } = require('../middlewares/auth');
const { checkPermission } = require('../middlewares/acl');
const stockController = require('../controllers/inventory/stockController');

const canManage = checkPermission(['inventory.manage', 'admin', 'manage_assets']);

// ─── LOUDYSA: Stok & Laporan ────────────────────────────────
// Fitur 1 - daftar stok terkini
router.get('/stock', isAuthenticated, canManage, stockController.index);
// Fitur 4 - laporan per periode
router.get('/stock/report', isAuthenticated, canManage, stockController.report);
// Fitur 6 - riwayat laporan
router.get('/stock/report/history', isAuthenticated, canManage, stockController.reportHistory);
// Fitur 2 - riwayat stok per barang
router.get('/stock/:id/history', isAuthenticated, canManage, stockController.history);
// Fitur 3 - form & proses adjustment
router.get('/stock/:id/adjustment', isAuthenticated, canManage, stockController.adjustmentForm);
router.post('/stock/:id/adjustment', isAuthenticated, canManage, stockController.adjustment);
// Fitur 5 - export PDF & Excel
router.get('/stock/report/export/pdf', isAuthenticated, canManage, stockController.exportPDF);
router.get('/stock/report/export/excel', isAuthenticated, canManage, stockController.exportExcel);
// REST API Loudysa
router.get('/api/stock', isAuthenticated, canManage, stockController.apiList);
router.get('/api/stock/:id/transactions', isAuthenticated, canManage, stockController.apiTransactions);

module.exports = router;
