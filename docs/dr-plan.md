# Plan de Recuperación ante Desastres (DR) — Ark Cash Register

**Objetivo:** Garantizar continuidad del servicio de caja registradora y datos fiscales/contables.

## 1. Alcance
- Worker Cloudflare, D1 (ark_caja_db), KV, R2 (facturas/backups).
- Dependencias externas: Pey (cobros), Facturapi (CFDI), Resend (email).

## 2. Objetivos
- RTO: 4 horas (restaurar servicio operativo).
- RPO: 24 horas (pérdida máxima de datos).

## 3. Backups
- D1: snapshot diario a R2 (`backups/d1-snapshot-*.json`) vía scheduled + manual `/api/internal/backup/run`.
- Facturas XML/PDF: R2 (inmutable, versionado).
- Código: repositorio Git (fuera de este workspace; mantener remoto).
- Configuración: `wrangler.toml` + secrets documentados.

## 4. Procedimiento de restore
1. Crear D1 y KV nuevos en Cloudflare.
2. Ejecutar migraciones 0001-0006.
3. Restaurar snapshot: script `scripts/restore_d1.py` (pendiente) o importar JSON manualmente a tablas.
4. Re-vincular bindings en `wrangler.toml` y secrets.
5. Desplegar worker (`npm run deploy`).
6. Validar `/api/health` y prueba de cobro $1.

## 5. Escenarios
- Caída de Worker: redeploy desde repo.
- Corrupción D1: restore desde último snapshot R2.
- Pérdida de R2: re-timbrar facturas desde Facturapi (uuids en D1).
- Caída de Pey/Facturapi: operar en modo degradado (sin cobros nuevos, consulta de historial local).

## 6. Pruebas
- Restore drill trimestral.
- Verificar integridad de backups (checksum).

## 7. Contactos
- Responsable técnico: equipo ARK.
- Proveedores: Cloudflare Support, Pey, Facturapi.
