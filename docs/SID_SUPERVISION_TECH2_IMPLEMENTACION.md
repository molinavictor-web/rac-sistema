# SID Tech 2.0 — Supervisión Educativa

**Estado:** guardado en rama de desarrollo; sin prueba visual ni funcional ejecutada; no desplegado.

## Alcance implementado
- Se activó el tema `sid-tech-supervision` en diez páginas: `resumen`, `estadisticas`, `alertas`, `planteles`, `consolidado`, `municipales`, `circuitales`, `circuitos`, `directores` y `mi-plantel`.
- Se añadió `public/css/sid-supervision-tech.css`, cargado al final del `head` de cada página para priorizar los estilos visuales sin reemplazar CSS histórico.
- `public/js/nav.js` presenta la marca SID · Supervisión, el encabezado SID-Educación y el logotipo Tech 2.0 solo en las páginas opt-in.
- El resumen conserva su API `/api/supervision/resumen`, cifras calculadas y enlaces existentes; se estilizaron hero, tarjetas y navegación.
- La página `mi-plantel` conserva su JavaScript y formularios de matrícula, con controles de alcance territorial en el backend sin modificar.

## No modificado
- Rutas API, autenticación, permisos, restricciones de director/plantel y acceso por rol.
- Esquema o datos de Supabase, integraciones Google, variables de entorno, Render, rama `main` y producción.
- JavaScript funcional de los diez módulos.

## Pruebas pendientes antes de considerar terminado
1. Verificar carga de cada pantalla con roles `admin` y `supervision`.
2. Verificar `mi-plantel` con `director`, incluyendo registro de matrícula **solo en su propio plantel** y denegación de otro plantel.
3. Comprobar menú móvil: apertura, cierre X, clic fuera, Escape, usuario/rol y cerrar sesión.
4. Revisar tablas, formularios, modales, estadísticas, alertas y desplazamiento en 360, 768 y 1440 px.
5. Ejecutar pruebas automatizadas de permisos y comprobar GitHub Actions.
6. Comparar visualmente contra referencia SID Tech 2.0 aprobada y corregir diferencias.

**Regla:** ningún cambio en producción sin pruebas satisfactorias y autorización previa explícita.

## Avance adicional: login y componentes
- Login de Supervisión rediseñado en `public/supervision/login.html` con composición SID Tech 2.0, fondo ilustrado local y formulario responsive.
- Conservados los identificadores de formulario y el script `public/js/supervision-login.js` sin alterar autenticación ni redirecciones.
- Estilos internos de tablas, filtros, formularios y modales agregados en `public/css/sid-supervision-tech.css`.
- Validación pendiente: login por rol, credenciales inválidas, navegación móvil, matrícula del director, modales, contraste y regresión de permisos.
- No se ha ejecutado prueba visual o funcional ni despliegue.
