import { createBrowserClient } from '@supabase/ssr'

// Client-side helper (browser components — safe for Client Components)
export const createClient = () =>
    createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

export type Database = any // Add generated types here if available


