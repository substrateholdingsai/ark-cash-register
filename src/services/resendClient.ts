// Cliente REST para Resend (solo transporte de email). Sin SDK de terceros.
// API: POST https://api.resend.com/emails

export interface ResendSendParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class ResendClient {
  constructor(private apiKey: string, private from: string) {
    if (!apiKey) throw new Error('RESEND_API_KEY is required');
    if (!from) throw new Error('RESEND_FROM_EMAIL is required');
  }

  async sendEmail(params: ResendSendParams): Promise<{ id: string }> {
    const { to, subject, html, text } = params;
    let lastErr: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ from: this.from, to: [to], subject, html, text })
        });
        if (res.ok) {
          const data: any = await res.json().catch(() => ({}));
          return { id: data?.id || '' };
        }
        if (res.status >= 500) {
          lastErr = new Error(`Resend ${res.status}`);
        } else {
          const body = await res.text().catch(() => '');
          throw new Error(`Resend error ${res.status}: ${body}`);
        }
      } catch (err: any) {
        lastErr = err;
        if (err?.message?.startsWith('Resend error')) throw err;
      }
      // backoff
      await new Promise((r) => setTimeout(r, 200 * Math.pow(2, attempt)));
    }
    throw lastErr || new Error('Resend send failed');
  }
}

// ---------- Plantillas ----------

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function verificationEmailHtml(link: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f5f7fa;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e2e8f0;">
    <h2 style="color:#002B7F;margin:0 0 12px;">Confirma tu cuenta</h2>
    <p style="color:#334155;line-height:1.5;">Gracias por registrarte en Ark Cash Register. Para activar tu cuenta, confirma tu correo haciendo clic en el siguiente botón:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#002B7F;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Confirmar correo</a>
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.5;">Si el botón no funciona, copia y pega este enlace en tu navegador:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
    <p style="color:#64748b;font-size:13px;">Este enlace expira en 24 horas. Si no creaste esta cuenta, ignora este mensaje.</p>
  </div></body></html>`;
}

export function verificationEmailText(link: string): string {
  return `Confirma tu cuenta en Ark Cash Register.\n\nAbre este enlace para activar tu cuenta (expira en 24 horas):\n${link}\n\nSi no creaste esta cuenta, ignora este mensaje.`;
}

export function resetPasswordEmailHtml(link: string): string {
  return `<!DOCTYPE html><html><body style="font-family:Inter,Arial,sans-serif;background:#f5f7fa;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:32px;border:1px solid #e2e8f0;">
    <h2 style="color:#002B7F;margin:0 0 12px;">Restablece tu contraseña</h2>
    <p style="color:#334155;line-height:1.5;">Recibimos una solicitud para restablecer la contraseña de tu cuenta. Haz clic en el siguiente botón:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(link)}" style="display:inline-block;background:#002B7F;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">Restablecer contraseña</a>
    </p>
    <p style="color:#64748b;font-size:13px;line-height:1.5;">Si el botón no funciona, copia y pega este enlace:<br><span style="word-break:break-all;">${escapeHtml(link)}</span></p>
    <p style="color:#64748b;font-size:13px;">Este enlace expira en 1 hora y solo puede usarse una vez. Si no solicitaste este cambio, ignora este mensaje y tu contraseña permanecerá igual.</p>
  </div></body></html>`;
}

export function resetPasswordEmailText(link: string): string {
  return `Restablece tu contraseña en Ark Cash Register.\n\nAbre este enlace (expira en 1 hora, un solo uso):\n${link}\n\nSi no solicitaste este cambio, ignora este mensaje.`;
}
