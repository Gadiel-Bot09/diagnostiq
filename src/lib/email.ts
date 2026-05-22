import { Resend } from 'resend';

// Only initialize if we have a key (prevents build errors if not set yet)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM_EMAIL = 'DiagnostiQ <noreply@mail.sinuhub.com>';

export async function sendWelcomeEmail(toEmail: string, patientName: string, labName: string) {
    if (!resend) {
        console.warn("RESEND_API_KEY no configurada. Saltando envío de correo de bienvenida.");
        return;
    }

    const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-w-md; margin: 0 auto; background-color: #f8fafc; padding: 40px 20px;">
        <div style="background-color: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); max-width: 500px; margin: 0 auto; border-top: 6px solid #4f46e5;">
            <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #4f46e5; margin: 0; font-size: 28px; font-weight: 800; letter-spacing: -1px;">DiagnostiQ</h1>
                <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Portal de Pacientes</p>
            </div>
            
            <h2 style="color: #0f172a; font-size: 20px; margin-bottom: 20px;">Hola, ${patientName}</h2>
            
            <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                El laboratorio <strong>${labName}</strong> te ha dado de alta en nuestro sistema para que puedas consultar y descargar tus resultados médicos de forma segura.
            </p>
            
            <div style="text-align: center; margin: 35px 0;">
                <a href="https://diagnostiq.sinuhub.com/portal/login" 
                   style="background-color: #4f46e5; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                    Acceder a mi Portal
                </a>
            </div>
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">
                Para ingresar, utiliza este correo electrónico (<strong>${toEmail}</strong>) y tu <strong>Número de Documento</strong> de identidad como contraseña inicial.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
            
            <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5;">
                Este es un mensaje automático. Por favor no respondas a este correo.<br/>
                Protegemos tus datos médicos con cifrado de extremo a extremo.
            </p>
        </div>
    </div>
    `;

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: toEmail,
            subject: `Bienvenido a DiagnostiQ - Acceso de ${labName}`,
            html: html,
        });
    } catch (error) {
        console.error("Error enviando email de bienvenida:", error);
    }
}

export async function sendNewResultsEmail(toEmail: string, patientName: string, labName: string, orderNumber: string) {
    if (!resend) {
        console.warn("RESEND_API_KEY no configurada. Saltando envío de correo de resultados.");
        return;
    }

    const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-w-md; margin: 0 auto; background-color: #f8fafc; padding: 40px 20px;">
        <div style="background-color: #ffffff; border-radius: 16px; padding: 40px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1); max-width: 500px; margin: 0 auto; border-top: 6px solid #10b981;">
            <div style="text-align: center; margin-bottom: 30px;">
                <div style="background-color: #d1fae5; color: #10b981; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 15px auto; font-size: 30px;">
                    📋
                </div>
                <h1 style="color: #0f172a; margin: 0; font-size: 24px; font-weight: 800;">¡Tus resultados están listos!</h1>
            </div>
            
            <h2 style="color: #0f172a; font-size: 18px; margin-bottom: 20px;">Hola, ${patientName}</h2>
            
            <p style="color: #334155; font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                El laboratorio <strong>${labName}</strong> ha subido los informes finales de tu orden médica <strong>#${orderNumber}</strong>.
            </p>
            
            <div style="text-align: center; margin: 35px 0;">
                <a href="https://diagnostiq.sinuhub.com/portal/login" 
                   style="background-color: #10b981; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
                    Ver y Descargar Resultados
                </a>
            </div>
            
            <p style="color: #64748b; font-size: 14px; line-height: 1.6; background-color: #f1f5f9; padding: 15px; border-radius: 8px; text-align: center;">
                💡 Recuerda consultar siempre con tu médico tratante para la correcta interpretación clínica de tus exámenes.
            </p>
            
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
            
            <p style="color: #94a3b8; font-size: 12px; text-align: center; line-height: 1.5;">
                DiagnostiQ Portal de Pacientes<br/>
                Este es un enlace seguro y temporal. Por privacidad, no enviamos adjuntos por correo.
            </p>
        </div>
    </div>
    `;

    try {
        await resend.emails.send({
            from: FROM_EMAIL,
            to: toEmail,
            subject: `Tus resultados médicos de ${labName} están listos`,
            html: html,
        });
    } catch (error) {
        console.error("Error enviando email de resultados:", error);
    }
}
