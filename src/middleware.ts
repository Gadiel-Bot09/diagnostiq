import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export async function middleware(req: NextRequest) {
    let res = NextResponse.next({ request: req })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return req.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value))
                    res = NextResponse.next({ request: req })
                    cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
                },
            },
        }
    )

    // Use getUser for reliable auth in Edge middleware
    const { data: { user } } = await supabase.auth.getUser()

    const url = req.nextUrl.clone()
    const isSuperAdminRoute = url.pathname.startsWith('/superadmin')
    const isAppRoute = url.pathname.startsWith('/app') && url.pathname !== '/app/login'
    const isPortalRoute = url.pathname.startsWith('/portal') && url.pathname !== '/portal/login'

    // --- Not logged in ---
    if (!user) {
        if (isAppRoute) {
            url.pathname = '/app/login'
            return NextResponse.redirect(url)
        }
        if (isPortalRoute) {
            url.pathname = '/portal/login'
            return NextResponse.redirect(url)
        }
        if (isSuperAdminRoute) {
            url.pathname = '/app/login'
            return NextResponse.redirect(url)
        }
        return res
    }

    // --- Logged in: protect routes by role ---
    // 1st try: read role from profiles table
    const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()

    // 2nd try: fallback to user_metadata
    const role = profile?.role ?? user.user_metadata?.role

    if (isSuperAdminRoute) {
        if (role !== 'SUPER_ADMIN') {
            url.pathname = '/app/dashboard'
            return NextResponse.redirect(url)
        }
    }

    if (isAppRoute) {
        if (role === 'DOCTOR') {
            url.pathname = '/doctor'
            return NextResponse.redirect(url)
        }
    }

    return res
}

export const config = {
    matcher: ['/app/:path*', '/portal/:path*', '/superadmin/:path*', '/'],
}
