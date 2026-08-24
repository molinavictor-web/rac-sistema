require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const racRoutes = require("./routes/rac");
const usuariosRoutes = require("./routes/usuarios");
const cargasRoutes = require("./routes/cargas");
const alertasRoutes = require("./routes/alertas");
const plantelesRoutes = require("./routes/planteles");
const personalMinisterioRoutes = require("./routes/personalMinisterio");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(require("path").join(__dirname, "../public"))); 
app.get("/api/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/rac", racRoutes);
app.use("/api/usuarios", usuariosRoutes);
app.use("/api/cargas", cargasRoutes);
app.use("/api/alertas", alertasRoutes);
app.use("/api/planteles", plantelesRoutes);
app.use("/api/personal-ministerio", personalMinisterioRoutes);

// Manejador de errores genérico -- evita que un error suelto tumbe el proceso
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RAC backend escuchando en el puerto ${PORT}`);
});
