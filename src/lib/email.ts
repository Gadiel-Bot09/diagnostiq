import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = 'DiagnostiQ <noreply@mail.sinuhub.com>';

export async function sendWelcomeEmail(toEmail: string, patientName: string, labName: string) {
    if (!resend) { console.warn("RESEND_API_KEY no configurada."); return; }
    const html = `
    <div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;">
      <div style="background:#fff;border-radius:16px;padding:40px;max-width:500px;margin:0 auto;border-top:6px solid #4f46e5;">
        <div style="text-align:center;margin-bottom:30px;">
          <h1 style="color:#4f46e5;margin:0;font-size:28px;font-weight:800;">DiagnostiQ</h1>
          <p style="color:#64748b;font-size:14px;margin-top:5px;">Portal de Pacientes</p>
        </div>
        <h2 style="color:#0f172a;font-size:20px;">Hola, ${patientName}</h2>
        <p style="color:#334155;font-size:16px;line-height:1.6;">
          El laboratorio <strong>${labName}</strong> te ha dado de alta en nuestro sistema para que puedas consultar y descargar tus resultados médicos de forma segura.
        </p>
        <div style="text-align:center;margin:35px 0;">
          <a href="https://diagnostiq.sinuhub.com/portal/login" style="background:#4f46e5;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Acceder a mi Portal</a>
        </div>
        <p style="color:#334155;font-size:15px;line-height:1.6;">
          Para ingresar, utiliza este correo (<strong>${toEmail}</strong>) y tu <strong>Número de Documento</strong> como contraseña inicial.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;"/>
        <p style="color:#94a3b8;font-size:12px;text-align:center;">Este es un mensaje automático. Protegemos tus datos con cifrado de extremo a extremo.</p>
      </div>
    </div>`;
    try {
        await resend.emails.send({ from: FROM_EMAIL, to: toEmail, subject: `Bienvenido a DiagnostiQ - Acceso de ${labName}`, html });
    } catch (e) { console.error("Error email bienvenida:", e); }
}

export async function sendNewResultsEmail(toEmail: string, patientName: string, labName: string, orderNumber: string) {
    if (!resend) { console.warn("RESEND_API_KEY no configurada."); return; }
    const html = `
    <div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;">
      <div style="background:#fff;border-radius:16px;padding:40px;max-width:500px;margin:0 auto;border-top:6px solid #10b981;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="background:#d1fae5;width:60px;height:60px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:30px;margin-bottom:15px;">📋</div>
          <h1 style="color:#0f172a;margin:0;font-size:24px;font-weight:800;">¡Tus resultados están listos!</h1>
        </div>
        <h2 style="color:#0f172a;font-size:18px;">Hola, ${patientName}</h2>
        <p style="color:#334155;font-size:16px;line-height:1.6;">
          El laboratorio <strong>${labName}</strong> ha subido los informes finales de tu orden <strong>#${orderNumber}</strong>.
        </p>
        <div style="text-align:center;margin:35px 0;">
          <a href="https://diagnostiq.sinuhub.com/portal/login" style="background:#10b981;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:16px;display:inline-block;">Ver y Descargar Resultados</a>
        </div>
        <p style="color:#64748b;font-size:14px;line-height:1.6;background:#f1f5f9;padding:15px;border-radius:8px;text-align:center;">💡 Consulta siempre con tu médico tratante para la interpretación de tus exámenes.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;"/>
        <p style="color:#94a3b8;font-size:12px;text-align:center;">DiagnostiQ Portal de Pacientes. Por privacidad, no enviamos adjuntos por correo.</p>
      </div>
    </div>`;
    try {
        await resend.emails.send({ from: FROM_EMAIL, to: toEmail, subject: `Tus resultados médicos de ${labName} están listos`, html });
    } catch (e) { console.error("Error email resultados:", e); }
}

export async function sendDirectResultsEmail(
    toEmail: string,
    patientName: string,
    labName: string,
    examName: string,
    isNewPatient: boolean
) {
    if (!resend) { console.warn("RESEND_API_KEY no configurada."); return; }

    const credBlock = isNewPatient ? `
        <div style="background:#eef2ff;border-left:4px solid #6366f1;padding:16px 20px;border-radius:8px;margin:20px 0;">
          <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#3730a3;">🔐 Tus Credenciales de Acceso</p>
          <p style="margin:4px 0;font-size:14px;color:#334155;">📧 <strong>Usuario:</strong> ${toEmail}</p>
          <p style="margin:4px 0;font-size:14px;color:#334155;">🔑 <strong>Contraseña inicial:</strong> Tu número de documento</p>
          <p style="margin:8px 0 0 0;font-size:12px;color:#64748b;">Podrás cambiar tu contraseña después de iniciar sesión.</p>
        </div>` : '';

    const html = `
    <div style="font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px;">
      <div style="background:#fff;border-radius:16px;padding:40px;max-width:520px;margin:0 auto;border-top:6px solid #6366f1;">
        <div style="text-align:center;margin-bottom:30px;">
          <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);width:64px;height:64px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;font-size:32px;margin-bottom:16px;">🧪</div>
          <h1 style="color:#0f172a;margin:0;font-size:24px;font-weight:800;">Resultados Disponibles</h1>
          <p style="color:#64748b;font-size:14px;margin:6px 0 0 0;">DiagnostiQ — Portal Médico Seguro</p>
        </div>
        <p style="color:#334155;font-size:16px;line-height:1.6;">Hola, <strong>${patientName}</strong></p>
        <p style="color:#334155;font-size:15px;line-height:1.6;">El laboratorio <strong>${labName}</strong> ha cargado tus resultados de:</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:16px 20px;text-align:center;margin:16px 0;">
          <p style="margin:0;font-size:18px;font-weight:700;color:#15803d;">📄 ${examName}</p>
        </div>
        ${credBlock}
        <div style="text-align:center;margin:30px 0;">
          <a href="https://diagnostiq.sinuhub.com/portal/login" style="background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;padding:15px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:16px;display:inline-block;">📥 Ver y Descargar mis Resultados</a>
        </div>
        <p style="color:#64748b;font-size:13px;background:#fffbeb;border:1px solid #fde68a;padding:14px;border-radius:8px;text-align:center;">⚕️ <strong>Importante:</strong> Consulta siempre con tu médico tratante para la correcta interpretación de tus resultados.</p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:30px 0;"/>
        <p style="color:#94a3b8;font-size:11px;text-align:center;line-height:1.6;">DiagnostiQ · Portal de Resultados Médicos<br/>Tus datos están protegidos con cifrado de grado médico.</p>
      </div>
    </div>`;

    try {
        await resend.emails.send({ from: FROM_EMAIL, to: toEmail, subject: `🧪 Tus resultados de "${examName}" están listos — ${labName}`, html });
    } catch (e) { console.error("Error email resultados directos:", e); }
}
