-- SIGE Fase 1: migración aditiva, ejecutar SOLO tras respaldo y revisión.
-- No cambia usuarios.rol ni borra usuarios existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS sige_roles (
  id BIGSERIAL PRIMARY KEY,
  codigo VARCHAR(60) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE TABLE IF NOT EXISTS sige_permisos (
  codigo VARCHAR(100) PRIMARY KEY,
  modulo VARCHAR(30) NOT NULL CHECK (modulo IN ('rac','supervision','fede','core')),
  descripcion TEXT
);
CREATE TABLE IF NOT EXISTS sige_rol_permisos (
  rol_id BIGINT NOT NULL REFERENCES sige_roles(id) ON DELETE CASCADE,
  permiso_codigo VARCHAR(100) NOT NULL REFERENCES sige_permisos(codigo) ON DELETE CASCADE,
  PRIMARY KEY (rol_id, permiso_codigo)
);
CREATE TABLE IF NOT EXISTS sige_usuario_roles (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  rol_id BIGINT NOT NULL REFERENCES sige_roles(id) ON DELETE CASCADE,
  asignado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, rol_id)
);
INSERT INTO sige_roles(codigo,nombre) VALUES
 ('admin','Administrador'),('operador','Operador RAC'),
 ('encargado_municipio','Encargado municipal RAC'),
 ('operador_credenciales','Operador de credenciales'),
 ('operador_plantel','Operador Planteles FEDE'),
 ('supervision','Supervisión educativa'),('director','Director de plantel')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO sige_permisos(codigo,modulo,descripcion) VALUES
 ('rac.ver','rac','Consultar RAC'),('rac.operar','rac','Operar RAC'),
 ('supervision.ver','supervision','Consultar supervisión'),
 ('supervision.operar','supervision','Operar supervisión'),
 ('fede.ver','fede','Consultar Planteles FEDE'),
 ('fede.operar','fede','Operar Planteles FEDE'),
 ('usuarios.administrar','core','Administrar usuarios')
ON CONFLICT (codigo) DO NOTHING;
INSERT INTO sige_rol_permisos(rol_id,permiso_codigo)
SELECT r.id,p.codigo FROM sige_roles r JOIN sige_permisos p ON
 (r.codigo='admin')
 OR (r.codigo IN ('operador','encargado_municipio') AND p.codigo IN ('rac.ver','rac.operar'))
 OR (r.codigo='operador_credenciales' AND p.codigo='rac.ver')
 OR (r.codigo='operador_plantel' AND p.codigo IN ('fede.ver','fede.operar'))
 OR (r.codigo='supervision' AND p.codigo IN ('supervision.ver','supervision.operar'))
 OR (r.codigo='director' AND p.codigo='supervision.ver')
ON CONFLICT DO NOTHING;
INSERT INTO sige_usuario_roles(usuario_id,rol_id)
SELECT u.id,r.id FROM usuarios u JOIN sige_roles r ON r.codigo=u.rol
ON CONFLICT DO NOTHING;
COMMIT;
