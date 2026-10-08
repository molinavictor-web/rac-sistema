# SID — Guía de identidad visual v0.1

**Estado:** línea gráfica y colores base aprobados por el responsable el 8 de octubre de 2026. Documento de diseño; no autoriza despliegue.

## Marca matriz
SID — Sistema Integrado Digital. La identidad común debe facilitar reconocimiento entre plataformas sectoriales sin borrar su autonomía institucional.

## Colores base aprobados
| Plataforma | Principal | Secundario | Fondo sugerido | Texto sugerido |
|---|---|---|---|---|
| SID-Educación | `#0D47A1` | `#1976D2` | `#E3F2FD` | `#455A64` |
| SID-FEDE | `#2E7D32` | `#43A047` | `#E8F5E9` | `#37474F` |

Los colores de fondo y texto son propuestas técnicas sujetas a pruebas de contraste y accesibilidad; los colores principales y secundarios son la línea gráfica aprobada.

## Arquitectura de marca
- **SID-Educación:** RAC y Supervisión Educativa, esta última como departamento del Ministerio de Educación.
- **SID-FEDE:** identidad propia para FEDE, organismo autónomo adscrito al Ministerio. Su operación técnica sigue dentro de la aplicación existente durante esta fase.
- Mantener componentes compartidos (tipografía, iconografía, tablas, formularios, botones, navegación responsive), variando encabezado, denominación y acentos cromáticos por plataforma.
- Los ejemplos visuales son maquetas conceptuales; sus nombres de personas, cargos, estadísticas y funcionalidades futuras no son datos reales ni especificaciones aprobadas.

## Reglas de implementación
1. No alterar autenticación, autorización, reglas territoriales ni integraciones de Google.
2. No cambiar rutas, esquemas de datos o configuraciones productivas por ajustes visuales.
3. Trabajar en `feature/sige-permisos-fase1`, con revisión visual en escritorio y móvil.
4. Probar accesibilidad, contraste, menú móvil, rol visible, cierre de sesión y regresiones.
5. No fusionar ni desplegar sin pruebas satisfactorias y autorización explícita.

## Próximos entregables
- Tokens CSS reutilizables para SID-Educación y SID-FEDE.
- Prototipos de encabezado, menú lateral, tarjetas y tablas.
- Adaptación progresiva de pantallas existentes sin pérdida de funcionalidades.
