import { createClient } from "@supabase/supabase-js"

export const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder_key',
    {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    }
)

/**
 * Searches Supabase Auth users by email address with pagination support.
 */
export async function findAuthUserByEmail(email: string) {
    if (!email) return null
    const cleanEmail = email.trim().toLowerCase()
    let page = 1
    const perPage = 1000
    while (true) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
        if (error || !data?.users || data.users.length === 0) break
        const found = data.users.find(u => u.email?.trim().toLowerCase() === cleanEmail)
        if (found) return found
        if (data.users.length < perPage) break
        page++
    }
    return null
}

