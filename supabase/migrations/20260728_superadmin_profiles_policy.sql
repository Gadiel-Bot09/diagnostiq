-- SUPER ADMIN: Permitir ver todos los perfiles de todos los laboratorios
CREATE POLICY "Super Admins can see all profiles" ON public.profiles
    FOR SELECT USING (public.get_auth_role() = 'SUPER_ADMIN');
