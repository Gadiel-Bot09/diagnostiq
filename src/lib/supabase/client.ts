import { createBrowserClient } from '@supabase/ssr'

// Client-side helper (browser components — safe for Client Components)
export const createClient = () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!url || !key) {
        console.error("Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
    
    return createBrowserClient(url!, key!);
}

export type Database = any // Add generated types here if available


