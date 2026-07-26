-- Migration: Add 'qr' (Códigos QR Portales) module permissions to all default Administrador custom roles in existing labs
-- Por defecto solo estará habilitado para el rol de administrador en cada laboratorio.

INSERT INTO public.role_permissions (role_id, module, action)
SELECT cr.id, 'qr', act.action
FROM public.custom_roles cr
CROSS JOIN (
    VALUES ('view'), ('create'), ('edit'), ('delete'), ('upload'), ('export'), ('invite')
) AS act(action)
WHERE cr.is_default = true OR cr.name ILIKE '%admin%'
ON CONFLICT (role_id, module, action) DO NOTHING;
