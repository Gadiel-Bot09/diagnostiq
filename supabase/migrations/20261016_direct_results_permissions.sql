-- Migration: Separate and explicitly configure 'direct_results' (Resultados Directos) permissions
-- Ensures default/admin roles have access, while custom staff roles require explicit assignment in Roles and Permissions.

-- 1. Ensure all default Administrator roles have 'direct_results' permissions
INSERT INTO public.role_permissions (role_id, module, action)
SELECT cr.id, 'direct_results', act.action
FROM public.custom_roles cr
CROSS JOIN (
    VALUES ('view'), ('create'), ('edit'), ('delete'), ('upload')
) AS act(action)
WHERE cr.is_default = true OR cr.name ILIKE '%admin%'
ON CONFLICT (role_id, module, action) DO NOTHING;
