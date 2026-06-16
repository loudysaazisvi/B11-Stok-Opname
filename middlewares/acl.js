const db = require("../lib/db");

const checkPermission = (requiredPermissions) => {
  return async (req, res, next) => {
    if (!req.session.userId) {
      return res.status(401).redirect('/login');
    }

    const permissionsArray = Array.isArray(requiredPermissions)
      ? requiredPermissions
      : [requiredPermissions];

    try {
      const [rows] = await db.query(`
        SELECT DISTINCT p.name
        FROM permissions p
        JOIN role_has_permissions rhp ON p.id = rhp.permission_id
        JOIN model_has_roles mhr ON rhp.role_id = mhr.role_id
        WHERE mhr.model_id = ?
          AND mhr.model_type = 'App\\\\Models\\\\User'
          AND p.name IN (?)
      `, [req.session.userId, permissionsArray]);

      if (rows.length > 0) return next();

      return res.status(403).render("error", {
        message: "Forbidden: Anda tidak memiliki akses ke halaman ini.",
        error: { status: 403, stack: "" }
      });
    } catch (err) {
      next(err);
    }
  };
};

module.exports = { checkPermission };