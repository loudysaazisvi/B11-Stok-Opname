const bcrypt = require("bcryptjs");
const db = require("../lib/db");

const index = (req, res) => {
  if (req.session.userId) {
    return res.redirect("/inventory/stock");
  }
  res.redirect("/login");
};

const home = (req, res) => {
  res.render("home", { title: "Home", user: req.session.username });
};

const loginPage = (req, res) => {
  if (req.session.userId) return res.redirect("/inventory/stock");
  res.render("login", { title: "Login", error: null });
};

const login = async (req, res, next) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE email = ? OR name = ?", [username, username]);

    if (rows.length === 0) {
      return res.render("login", { title: "Login", error: "Username atau password salah" });
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.render("login", { title: "Login", error: "Username atau password salah" });
    }

    // Ambil roles user dari model_has_roles
    const [roles] = await db.query(`
      SELECT r.name FROM roles r
      JOIN model_has_roles mhr ON r.id = mhr.role_id
      WHERE mhr.model_id = ? AND mhr.model_type = 'App\\\\Models\\\\User'
    `, [user.id]);

    req.session.userId = user.id;
    req.session.username = user.name;
    req.session.roles = roles.map(r => r.name);

    req.session.save((err) => {
      if (err) return next(err);
      res.redirect("/inventory/stock");
    });
  } catch (err) {
    next(err);
  }
};

const logout = (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.redirect("/login");
  });
};

module.exports = { index, home, loginPage, login, logout };