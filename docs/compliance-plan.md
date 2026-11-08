# Plan de Implementación — Compliance (ARK Cash Register)

**Objetivo:** Cerrar gaps de compliance (LFPDPPP, SAT/CFDI, AML/PLD, PCI, seguridad, operación) sobre la base existente (auth soberano, ledger, CoDi/Pey).

---

## 1. Alcance y prioridades

| Prioridad | Área | Entregable |
|---|---|---|
| P0 | LFPDPPP (consentimiento, ARCO, retención) | Endpoints + UI + políticas |
| P0 | Seguridad (MFA, CSP, CSRF, binding sesión) | Middleware + auth extendido |
| P1 | SAT/CFDI | Módulo de facturación |
| P1 | AML/PLD | KYC + monitoreo + reportes |
| P2 | Operación (backups, DR, DPAs, accesibilidad) | Docs + automatización |

---

## 2. Fase 0 — Fundamentos de datos (½ día)

- [ ] Migración `0004_compliance.sql`:
  - `consent_records (id, user_id, version, accepted_at, ip, user_agent)`
  - `arco_requests (id, user_id, type, status, requested_at, resolved_at, notes)`
  - `data_retention_policies (entity, retention_days, purge_after)`
  - `privacy_notice_versions (version, content_hash, published_at)`
- [ ] Seed de versión inicial del aviso de privacidad y términos.
- [ ] Variables: `PRIVACY_NOTICE_VERSION`, `TERMS_VERSION`, `DATA_RETENTION_DAYS`.

## 3. Fase 1 — Consentimiento y ARCO (2 días)

### 3.1 Consentimiento versionado
- [ ] En `/api/auth/register`: requerir `acceptTerms: true, acceptPrivacy: true` + `termsVersion`, `privacyVersion`. Guardar en `consent_records`.
- [ ] Endpoint `GET /api/legal/versions` → versiones vigentes.
- [ ] Bloquear registro si versiones no coinciden.
- [ ] Re-prompt de consentimiento si versión cambió (flag en `/me`).

### 3.2 Endpoints ARCO (`/api/privacy/*`, autenticados)
- [ ] `POST /api/privacy/export` → genera JSON con todos los datos del usuario (descarga). Audit log.
- [ ] `POST /api/privacy/rectify` → actualiza datos permitidos (nombre, email con re-verificación).
- [ ] `POST /api/privacy/cancel` → marca cuenta para eliminación; soft-delete + anonimización tras 30 días.
- [ ] `POST /api/privacy/oppose` → opt-out de finalidades secundarias (marketing/analytics).
- [ ] `GET /api/privacy/requests` → historial de solicitudes del usuario.
- [ ] Admin: `GET /api/internal/privacy-requests` (StayPuft) para gestión.

### 3.3 UI
- [ ] Checkbox de aceptación en `register.html` (deshabilita submit hasta marcar).
- [ ] Sección "Privacidad y datos" en perfil: exportar, rectificar, cancelar, oponerse.
- [ ] Página `/privacy-rights.html` con formulario ARCO.

## 4. Fase 2 — Seguridad avanzada (2 días)

- [ ] MFA (TOTP) — fase 2a:
  - Migración: `user_mfa (user_id, secret_encrypted, enabled, backup_codes_hash)`.
  - Endpoints: `/api/auth/mfa/setup`, `/verify`, `/disable`.
  - Login requiere segundo factor si MFA habilitado.
  - Librería TOTP propia (HMAC-SHA1, RFC 6238) — sin deps.
- [ ] Verificación de contraseñas filtradas (HIBP k-anonymity) — opcional, solo si red disponible; fail-open.
- [ ] CSP estricto en middleware (nonce por request, `default-src 'self'`).
- [ ] CSRF: doble submit cookie + validación en mutaciones cookie-based (`X-CSRF-Token`).
- [ ] Binding de sesión: validar `user_agent` hash + IP subnet en refresh; revocar si cambia.
- [ ] Headers: `Permissions-Policy`, `X-Frame-Options: DENY`, `Content-Security-Policy`.
- [ ] Rate limiting distribuido ya en KV; añadir CAPTCHA (Turnstile de Cloudflare) en login/register tras N fallos.

## 5. Fase 3 — Retención y purga (1 día)

- [ ] Job programado (cron de Cloudflare o `scheduled` handler) que purga:
  - Sesiones revocadas/expiradas > 30 días.
  - Tokens consumidos/expirados > 7 días.
  - Audit logs > política (1 año operativo, 5 años fiscal, 10 años PLD).
  - Cuentas soft-deleted tras 30 días → anonimizar (email → `deleted_<id>@anon`, borrar PII).
- [ ] Tabla `purge_log` para auditoría de purgas.
- [ ] Endpoint admin `POST /api/internal/purge/run` (StayPuft) para ejecución manual.

## 6. Fase 4 — SAT/CFDI (3-4 días)

- [ ] Migración: `invoices (id, merchant_id, payment_id, uuid, xml, pdf_url, status, issued_at)`, `fiscal_profiles (merchant_id, rfc, regimen, cp, uso_cfdi)`.
- [ ] Integración con PAC (ej. Facturama/SW) vía REST — cliente propio (sin SDK).
- [ ] Endpoint `POST /api/invoice/issue` (desde pago o corte).
- [ ] Generación de CFDI 4.0 XML + timbrado.
- [ ] Cancelación de CFDI con motivo.
- [ ] Almacenamiento de XML en R2 (binding nuevo) + metadata en D1.
- [ ] Retención 5 años (política de retención).
- [ ] UI: datos fiscales en onboarding de merchant; botón "Facturar" en historial.

## 7. Fase 5 — AML/PLD (3 días)

- [ ] KYC de comercio: RFC, CURP (persona física), acta constitutiva, comprobante domicilio, UBO.
- [ ] Migración: `kyc_documents`, `beneficial_owners`, `risk_scores`.
- [ ] Monitoreo de transacciones: reglas (monto > umbral, frecuencia, patrones).
- [ ] Generación de reportes de operaciones inusuales/sospechosas (ROS) en formato UIF.
- [ ] Retención 10 años.
- [ ] Screening PEP/listas (OFAC/ONU/UIF) — consulta a listas públicas o servicio; documentar.

## 8. Fase 6 — Operación y gobernanza (2 días)

- [ ] Backups automáticos D1 (export diario a R2) + prueba de restore.
- [ ] Plan de DR documentado (RTO/RPO).
- [ ] DPAs firmados con Pey, Cloudflare, Resend (docs legales).
- [ ] Documento de transferencia internacional (Cloudflare US) + mecanismos.
- [ ] Accesibilidad WCAG 2.1 AA en páginas públicas.
- [ ] Designación de DPO/encargado (documento).
- [ ] Plan de respuesta a incidentes (runbook) + notificación a usuarios/autoridad en 72h.
- [ ] Pentest / revisión de seguridad externa.
- [ ] Checklist de release con sign-off de compliance.

## 9. Criterios de aceptación

1. Registro requiere consentimiento versionado; ARCO endpoints funcionales.
2. MFA opcional pero funcional; CSP/CSRF aplicados.
3. Purga automatizada y auditada.
4. CFDI emitible y almacenado 5 años.
5. Monitoreo PLD con alertas y ROS exportable.
6. Backups y DR probados.
7. `npm run typecheck && npm test` pasan; docs actualizados.

## 10. Estimación total

~15-18 días de desarrollo, en 6 fases. P0+P1 en ~7 días cubren lo crítico para operar legalmente.

---

## 11. Referencias

- `docs/auth-plan.md` — auth soberano.
- `docs/map.md` — mapa del proyecto.
- LFPDPPP, CFDI 4.0, Ley Antilavado (LFPIORPI), PCI-DSS SAQ-A (Pey custodia PAN).
