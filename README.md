# DiagnostiQ - Clinical Laboratory SaaS

DiagnostiQ is a high-security, multi-tenant platform designed for clinical laboratories to manage patient results and provide a secure access portal.

## Technologies

- **Frontend**: Next.js 14 (App Router), TypeScript, Tailwind CSS, Shadcn/UI.
- **Backend/Auth**: Supabase (Postgres, Auth, RLS, Storage).
- **Communication**: Resend (Email Notifications).
- **State Management**: TanStack Query v5.

## Project Structure

- `src/app/app`: Laboratory Administrative Panel.
- `src/app/portal`: Patient Results Portal.
- `supabase/migrations`: Database schema, types, and RLS policies.
- `supabase/functions`: Edge Functions for secure operations (Signed URLs, Notifications).

## Setup Guide

### 1. Supabase Initialization
1. Create a new project in Supabase.
2. Run the migrations located in `supabase/migrations/` in the SQL Editor.
3. Create a **Private** Storage Bucket named `diagnostiq-results`.

### 2. Environment Variables
Create a `.env.local` file with the following:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
RESEND_API_KEY=your_resend_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 3. Deploy Edge Functions
Deploy the functions using the Supabase CLI:
```bash
supabase functions deploy create-signed-url
supabase functions deploy send-notification
supabase functions deploy upload-finalize
```

## Security Checklist
- [x] RLS enabled on all sensitive tables.
- [x] Private Storage bucket for PDFs.
- [x] Short-lived (5 min) Signed URLs for downloads.
- [x] Complete Audit Trail for sensitive actions.
- [x] Multi-tenant isolation via `lab_id` checks.
