-- Modificar tabla labs
ALTER TABLE public.labs ADD COLUMN status TEXT DEFAULT 'ACTIVE' NOT NULL;
ALTER TABLE public.labs ADD COLUMN slug TEXT UNIQUE;
ALTER TABLE public.labs ADD COLUMN email TEXT;
ALTER TABLE public.labs ADD COLUMN logo_url TEXT;
ALTER TABLE public.labs ADD COLUMN plan TEXT DEFAULT 'FREE';

-- Modificar tabla profiles
ALTER TABLE public.profiles ADD COLUMN is_active BOOLEAN DEFAULT true NOT NULL;
ALTER TABLE public.profiles ADD COLUMN avatar_url TEXT;

-- Modificar tabla tests (Catálogo aislado por tenant)
-- Nota: Si ya hay datos en tests sin lab_id, esto podría fallar si se hace NOT NULL directamente.
-- Por ahora lo agregamos permitiendo nulos temporalmente o lo dejamos que borre en cascada.
ALTER TABLE public.tests ADD COLUMN lab_id UUID REFERENCES public.labs(id) ON DELETE CASCADE;
-- Eliminar la restricción de código único global si existe
ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_code_key;
-- Agregar la restricción de código único por laboratorio
ALTER TABLE public.tests ADD CONSTRAINT tests_code_lab_unique UNIQUE(lab_id, code);

-- RLS para tests actualizada
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Lab staff can CRUD tests in their lab" ON public.tests;
CREATE POLICY "Lab staff can CRUD tests in their lab" ON public.tests
    FOR ALL USING (lab_id = public.get_auth_lab_id());


-- Tabla custom_roles
CREATE TABLE public.custom_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(lab_id, name)
);

-- Tabla role_permissions
CREATE TABLE public.role_permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  module TEXT NOT NULL,  -- 'orders', 'patients', 'results', 'reports', 'staff', 'settings', 'audit'
  action TEXT NOT NULL,  -- 'view', 'create', 'edit', 'delete', 'upload', 'export', 'invite', etc.
  UNIQUE(role_id, module, action)
);

-- Tabla staff_role_assignments
CREATE TABLE public.staff_role_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
  custom_role_id UUID NOT NULL REFERENCES public.custom_roles(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE(profile_id, lab_id)
);

-- Habilitar RLS en las nuevas tablas
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_role_assignments ENABLE ROW LEVEL SECURITY;

-- Políticas para custom_roles
CREATE POLICY "Lab admins can CRUD custom roles" ON public.custom_roles
    FOR ALL USING (lab_id = public.get_auth_lab_id() AND public.get_auth_role() = 'LAB_ADMIN');

CREATE POLICY "Lab staff can view custom roles" ON public.custom_roles
    FOR SELECT USING (lab_id = public.get_auth_lab_id());

-- Políticas para role_permissions
CREATE POLICY "Lab admins can CRUD role permissions" ON public.role_permissions
    FOR ALL USING (
        role_id IN (SELECT id FROM public.custom_roles WHERE lab_id = public.get_auth_lab_id())
        AND public.get_auth_role() = 'LAB_ADMIN'
    );

CREATE POLICY "Lab staff can view role permissions" ON public.role_permissions
    FOR SELECT USING (
        role_id IN (SELECT id FROM public.custom_roles WHERE lab_id = public.get_auth_lab_id())
    );

-- Políticas para staff_role_assignments
CREATE POLICY "Lab admins can CRUD staff role assignments" ON public.staff_role_assignments
    FOR ALL USING (lab_id = public.get_auth_lab_id() AND public.get_auth_role() = 'LAB_ADMIN');

CREATE POLICY "Lab staff can view staff role assignments" ON public.staff_role_assignments
    FOR SELECT USING (lab_id = public.get_auth_lab_id());


-- Función helper para verificar permisos
CREATE OR REPLACE FUNCTION public.has_permission(p_module TEXT, p_action TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    v_role public.user_role;
    v_has_perm BOOLEAN;
BEGIN
    -- Obtener el rol base del usuario actual
    SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid();
    
    -- SUPER_ADMIN o LAB_ADMIN siempre tienen permiso total (o se puede restringir según necesidades)
    IF v_role IN ('SUPER_ADMIN', 'LAB_ADMIN') THEN
        RETURN TRUE;
    END IF;

    -- Si es LAB_STAFF, revisar sus permisos asignados
    IF v_role = 'LAB_STAFF' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.staff_role_assignments sra
            JOIN public.role_permissions rp ON rp.role_id = sra.custom_role_id
            WHERE sra.profile_id = auth.uid()
              AND rp.module = p_module
              AND rp.action = p_action
        ) INTO v_has_perm;
        
        RETURN v_has_perm;
    END IF;

    -- Cualquier otro rol (ej. PATIENT) no tiene permisos en esta lógica modular
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
