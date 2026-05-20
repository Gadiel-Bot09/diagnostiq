-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ROLES: PATIENT, LAB_ADMIN, LAB_STAFF, SUPER_ADMIN
CREATE TYPE public.user_role AS ENUM ('PATIENT', 'LAB_ADMIN', 'LAB_STAFF', 'SUPER_ADMIN');

-- LABS
CREATE TABLE public.labs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    tax_id TEXT UNIQUE NOT NULL, -- NIT/Tax ID
    address TEXT,
    phone TEXT,
    branding_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- PROFILES (Linked to Auth Users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role public.user_role NOT NULL DEFAULT 'PATIENT',
    lab_id UUID REFERENCES public.labs(id) ON DELETE SET NULL,
    full_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- PATIENTS
CREATE TABLE public.patients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL, -- CC, TI, CE, PA, etc.
    document_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    dob DATE,
    sex TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(lab_id, document_type, document_number)
);

-- PATIENT ACCOUNTS (Link auth user to patient record in a specific lab)
CREATE TABLE public.patient_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(user_id, lab_id)
);

-- TESTS CATALOG
CREATE TABLE public.tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    category TEXT,
    units TEXT,
    reference_range TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- ORDERS
CREATE TABLE public.orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    order_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSING, COMPLETED, CANCELLED
    ordered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    UNIQUE(lab_id, order_number)
);

-- ORDER TESTS (Specific tests in an order)
CREATE TABLE public.order_tests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    test_id UUID NOT NULL REFERENCES public.tests(id),
    status TEXT NOT NULL DEFAULT 'PENDING',
    result_summary_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- RESULT FILES (PDF Metadata)
CREATE TABLE public.result_files (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    storage_bucket TEXT NOT NULL DEFAULT 'diagnostiq-results',
    storage_path TEXT NOT NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/pdf',
    size_bytes BIGINT NOT NULL,
    sha256 TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    uploaded_by UUID REFERENCES auth.users(id),
    uploaded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- AUDIT EVENTS
CREATE TABLE public.audit_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID REFERENCES public.labs(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES auth.users(id),
    actor_role public.user_role,
    action TEXT NOT NULL, -- LOGIN, UPLOAD, VIEW, DOWNLOAD, DELETE, etc.
    entity_type TEXT NOT NULL,
    entity_id UUID,
    ip TEXT,
    user_agent TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- INVITATIONS
CREATE TABLE public.invitations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES public.labs(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role public.user_role NOT NULL DEFAULT 'LAB_STAFF',
    token TEXT UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- FUNCTIONS
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- TRIGGERS
CREATE TRIGGER set_updated_at_labs BEFORE UPDATE ON public.labs FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_profiles BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_patients BEFORE UPDATE ON public.patients FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER set_updated_at_orders BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
