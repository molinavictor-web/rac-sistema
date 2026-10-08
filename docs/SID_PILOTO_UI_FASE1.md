# SID Tech 2.0 — piloto de interfaz, fase 1

**Estado: implementado en rama de desarrollo; NO probado visualmente ni desplegado.**

## Alcance implementado
- `public/css/sid-tech-v1.css`: estilos SID Tech 2.0 aislados por la clase `sid-tech-educacion`, colores azul institucional y componentes de dashboard.
- `public/dashboard.html`: carga la hoja nueva después de los estilos existentes y activa el tema solo en el dashboard.
- `public/js/nav.js`: marca SID-Educación en encabezado y sidebar **solo si** la página es el dashboard piloto; resto de las pantallas mantiene su marca previa.
- `public/js/dashboard.js`: **sin cambios**; se preservan las peticiones existentes a RAC, planteles y alertas, y sus indicadores.

## FEDE
La identidad verde SID-FEDE está aprobada como diseño, **no implementada aún en las pantallas existentes**. Se revisará el comportamiento real de `planteles-consulta.html` y sus flujos Drive/Sheets antes de tocar su interfaz.

## Validación obligatoria antes de extender
1. Probar dashboard como admin, operador, encargado_municipio, operador_credenciales y operador_plantel.
2. Comprobar menú móvil (abrir, cerrar con X, clic fuera, Escape), usuario, rol y cerrar sesión.
3. Confirmar que alertas, planteles y RAC cargan cifras reales y sin errores; nunca usar métricas ficticias de maquetas.
4. Revisar escritorio, tablet, móvil, contraste y accesibilidad.
5. Ejecutar regresión de permisos y CI; **no se ha ejecutado como parte de este commit**.
6. Solicitar aprobación explícita antes de cualquier despliegue.

**Prohibido:** alterar `main`, producción Render/Supabase, roles, rutas, tokens, OAuth, Drive o Sheets sin pruebas y autorización.
