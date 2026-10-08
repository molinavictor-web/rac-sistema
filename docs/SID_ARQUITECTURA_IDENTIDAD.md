# SID — Decisión de arquitectura e identidad institucional

**Fecha:** 2026-10-07  
**Estado:** decisión de diseño aprobada por el responsable; no autoriza despliegue ni cambios de producción.

## Marca paraguas
**SID — Sistema Integrado Digital.** Familia extensible de soluciones sectoriales (por ejemplo, Educación, Educación Universitaria, Obras Públicas y Alcaldías). Los nombres de otras soluciones son posibilidades futuras, no productos implementados.

## Soluciones definidas
### SID-Educación
Solución para procesos del Ministerio de Educación. Agrupa inicialmente:
- RAC (Registro de Asignación de Cargos).
- Supervisión Educativa, departamento ministerial.

### SID-FEDE
Solución con **identidad visual y administrativa propia** para FEDE, organismo autónomo adscrito al Ministerio de Educación. Debe poder evolucionar hacia operación técnica independiente, pero **no se separa de la aplicación actual en esta fase**.

## Lineamientos de diseño
- Coherencia de familia: logotipo matriz SID, convenciones de navegación, accesibilidad y componentes compartidos.
- Identidad distinguible de SID-FEDE: encabezado, denominación, colores de acento y navegación sectorial propios, por definir en diseño.
- La independencia administrativa futura requiere una política explícita de roles, acceso a datos y responsabilidades; **no se presume implementada** por el cambio visual.
- No cambiar por ahora nombres de rutas, tablas, credenciales, despliegues ni dominio. El nombre de la rama y el repositorio pueden mantenerse.
- Evitar que la identidad visual sugiera que FEDE es un departamento de SID-Educación.

## Secuencia segura
1. Completar auditoría de permisos y pruebas de alcance de los módulos existentes.
2. Diseñar propuestas de identidad visual SID, SID-Educación y SID-FEDE para aprobación.
3. Implementar componentes visuales únicamente en desarrollo, sin afectar lógica ni integraciones.
4. Evaluar separación técnica de FEDE en un proyecto posterior, con análisis de datos, usuarios e integraciones.
5. No desplegar nada en producción sin pruebas y autorización explícita.

## Contexto histórico
El espacio de ChatGPT se denomina **PROYECTO SIGE** y la rama de trabajo es `feature/sige-permisos-fase1`. SIGE permanece como nombre técnico histórico durante la transición; la identidad de producto acordada es **SID**.
