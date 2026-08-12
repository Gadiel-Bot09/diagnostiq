-- Fix: Allow lab staff to read patient_accounts for patients in their lab
-- This is what makes the "Estado Portal" column show the correct status in the patients list
CREATE POLICY "Lab staff can read patient_accounts in their lab" ON public.patient_accounts
    FOR SELECT USING (lab_id = public.get_auth_lab_id());

-- Also allow super admins to read all patient_accounts
CREATE POLICY "Super Admins can read all patient_accounts" ON public.patient_accounts
    FOR SELECT USING (public.get_auth_role() = 'SUPER_ADMIN');
