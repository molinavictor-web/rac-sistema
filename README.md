# Sistema RAC

Backend para gestionar y validar el RAC (Registro de Asignación de Carga)
contra la nómina del Ministerio de Educación y el catálogo maestro de
planteles.

## Qué valida

1. **Cédula**: toda cédula cargada al RAC debe existir en `personal_ministerio`.
   Si no existe -> alerta `no_existe_ministerio` (posible asignación sin
   aprobación del Ministerio). Cédulas repetidas en el RAC son válidas
   (un profesor puede tener varios turnos/planteles).
2. **Plantel**: el código de plantel (COD DEA) debe existir en el catálogo
   maestro `planteles`. Si no existe -> alerta `plantel_no_existe`.
3. **Horas**: académicas y administrativas no pueden superar 168h/semana.

Toda esta lógica está probada con datos reales -- ver `/areas/rac.md` en
la memoria del proyecto para el detalle completo de cómo se llegó a este
diseño.

## Estructura

```
src/
  server.js          # entrypoint Express
  db/
    pool.js           # conexión a Postgres + helper de transacción auditada
    schema.sql         # esquema completo (tablas, triggers de auditoría)
  services/
    validacion.js      # las 3 reglas de validación
  middleware/
    auth.js             # JWT + control de rol/municipio
  routes/
    auth.js             # login
    rac.js               # CRUD del RAC (incluye traslados vía PATCH)
    cargas.js            # subir Excel del municipio -> valida -> guarda alertas
    alertas.js           # bandeja de alertas para el operador
    planteles.js         # catálogo maestro de planteles
scripts/
  migrate.js            # aplica schema.sql a la base de datos
  importar_planteles.js # carga el CSV real de planteles (973 registros)
```

## Levantar en local

```bash
npm install
cp .env.example .env
# editar .env con tu DATABASE_URL local

npm run migrate                                    # crea las tablas
node scripts/importar_planteles.js planteles.csv   # carga el catálogo de planteles
npm run dev                                          # arranca con reinicio automático
```

## Desplegar en Render

1. Sube este repo a GitHub.
2. En Render, click "New" → "Blueprint" y apunta al repo -- `render.yaml`
   ya define el web service y la base de datos juntos, conectados.
3. Una vez desplegado, corre la migración una sola vez desde el Shell de
   Render (pestaña "Shell" del servicio web):
   ```bash
   npm run migrate
   ```
4. Sube el CSV de planteles al servicio (o pégalo temporalmente) y corre:
   ```bash
   node scripts/importar_planteles.js planteles.csv
   ```
5. Crea el primer usuario admin manualmente (todavía no hay endpoint de
   registro -- es intencional, los usuarios los crea un admin):
   ```sql
   -- desde el Shell de la base de datos en Render:
   INSERT INTO usuarios (nombre, email, password_hash, rol)
   VALUES ('Tu Nombre', 'tu@email.com', '<hash generado con bcrypt>', 'admin');
   ```

## Pendiente / próximos pasos

- Endpoint para cargar la data completa de `personal_ministerio` (900k+
  filas) -- por su tamaño probablemente conviene un proceso batch aparte
  en vez de subirlo por el mismo endpoint de Excel.
- Frontend (aún no construido).
- Endpoint de creación de usuarios (hoy se hace a mano por SQL).
- Refinar el mapeo de columnas en `cargas.js` a medida que veamos más
  variedad real de los Excel de cada municipio.
