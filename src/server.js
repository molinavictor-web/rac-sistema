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
const racCompletoRoutes = require('./routes/racCompleto');
const mantenimientoRoutes = require('./routes/mantenimiento');
const credencialesRoutes = require('./routes/credenciales');
const mapeoCodigosPlantelRoutes = require('./routes/mapeoCodigosPlantel');
const depurarArchivoRoutes = require('./routes/depurarArchivo');
const plantelesConsultaRoutes = require('./routes/plantelesConsulta');
const directorioDirectoresRoutes = require('./routes/directorioDirectores');
const app = express();

// Helmet por defecto trae una Content-Security-Policy que bloquea cosas que
// el frontend SÍ necesita:
//  - img-src 'self' data:  -> bloquea la foto de fachada, que se muestra
//    como blob: (URL.createObjectURL) en planteles-consulta.js. Hay que
//    agregar blob: a mano.
//  - frame-src 'self'      -> bloquearía el <iframe> de Google Maps que se
//    usa para mostrar la ubicación del plantel (maps.google.com).
//  - style-src / font-src  -> el <head> de planteles-consulta.html (y demás
//    páginas) cargan la tipografía desde fonts.googleapis.com /
//    fonts.gstatic.com.
// Se parte de los valores por defecto de Helmet (getDefaultDirectives) y
// solo se amplían estas cuatro directivas, para no perder el resto de las
// protecciones que ya trae por defecto.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"],
        "frame-src": ["'self'", "https://www.google.com"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
      },
    },
  })
);
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
app.use('/api/rac', racCompletoRoutes);
app.use('/api/mantenimiento', mantenimientoRoutes);
app.use('/api/credenciales', credencialesRoutes.router);
app.use('/', credencialesRoutes.publico);
app.use('/api/mapeo-codigos-plantel', mapeoCodigosPlantelRoutes);
app.use('/api/rac', depurarArchivoRoutes);
app.use('/api/planteles-consulta', plantelesConsultaRoutes);
app.use('/api/directorio-directores', directorioDirectoresRoutes);
// Manejador de errores genérico -- evita que un error suelto tumbe el proceso
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Error interno del servidor." });
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`RAC backend escuchando en el puerto ${PORT}`);
});
