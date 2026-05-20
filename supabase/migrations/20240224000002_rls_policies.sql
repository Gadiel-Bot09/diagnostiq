-- ENABLE RLS ON ALL TABLES
ALTER TABLE public.labs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patient_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.result_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

-- HELPER FUNCTIONS FOR RLS
CREATE OR REPLACE FUNCTION public.get_auth_role()
RETURNS public.user_role AS $$
    SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_auth_lab_id()
RETURNS UUID AS $$
    SELECT lab_id FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

-- LABS POLICIES
CREATE POLICY "Super Admins can do everything on labs" ON public.labs
    FOR ALL USING (public.get_auth_role() = 'SUPER_ADMIN');

CREATE POLICY "Lab staff can see their own lab info" ON public.labs
    FOR SELECT USING (id = public.get_auth_lab_id());

-- PROFILES POLICIES
CREATE POLICY "Users can see their own profile" ON public.profiles
    FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (id = auth.uid());

CREATE POLICY "Lab admins can see all profiles in their lab" ON public.profiles
    FOR SELECT USING (lab_id = public.get_auth_lab_id());

-- PATIENTS POLICIES
CREATE POLICY "Lab staff can CRUD patients in their lab" ON public.patients
    FOR ALL USING (lab_id = public.get_auth_lab_id());

CREATE POLICY "Patients can see their own record" ON public.patients
    FOR SELECT USING (
        id IN (SELECT patient_id FROM public.patient_accounts WHERE user_id = auth.uid())
    );

-- ORDERS POLICIES
CREATE POLICY "Lab staff can CRUD orders in their lab" ON public.orders
    FOR ALL USING (lab_id = public.get_auth_lab_id());

CREATE POLICY "Patients can see their own orders" ON public.orders
    FOR SELECT USING (
        patient_id IN (SELECT patient_id FROM public.patient_accounts WHERE user_id = auth.uid())
    );

-- RESULT FILES POLICIES
CREATE POLICY "Lab staff can CRUD result files in their lab" ON public.result_files
    FOR ALL USING (lab_id = public.get_auth_lab_id());

CREATE POLICY "Patients can see their own result files" ON public.result_files
    FOR SELECT USING (
        patient_id IN (SELECT patient_id FROM public.patient_accounts WHERE user_id = auth.uid())
    );

-- AUDIT EVENTS POLICIES
CREATE POLICY "Lab admins can see their lab audit events" ON public.audit_events
    FOR SELECT USING (lab_id = public.get_auth_lab_id() AND public.get_auth_role() = 'LAB_ADMIN');

CREATE POLICY "System can insert audit events" ON public.audit_events
    FOR INSERT WITH CHECK (true); -- Usually inserted from edge functions/triggers

-- STORAGE POLICIES (Conceptual - to be applied in Supabase Storage UI or via SQL if supported by provider)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('diagnostiq-results', 'diagnostiq-results', false);

-- Policy for downloading results
-- CREATE POLICY "Allow patients to download their own results"
-- ON storage.objects FOR SELECT
-- USING (
--   bucket_id = 'diagnostiq-results' AND
--   (storage.foldername(name))[1]::uuid IN (
--     SELECT lab_id FROM public.patient_accounts WHERE user_id = auth.uid()
--   ) AND
--   (storage.foldername(name))[2]::uuid IN (
--     SELECT patient_id FROM public.patient_accounts WHERE user_id = auth.uid()
--   )
-- );
