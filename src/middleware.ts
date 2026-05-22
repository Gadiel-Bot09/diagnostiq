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

    const {
        data: { session },
    } = await supabase.auth.getSession()

    const url = req.nextUrl.clone()
    const isSuperAdminRoute = url.pathname.startsWith('/superadmin')
    const isAppRoute = url.pathname.startsWith('/app') && url.pathname !== '/app/login'
    const isPortalRoute = url.pathname.startsWith('/portal') && url.pathname !== '/portal/login'

    // --- Not logged in ---
    if (!session) {
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

    // --- Logged in: protect /superadmin/* by role ---
    if (isSuperAdminRoute) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .single()

        if (!profile || profile.role !== 'SUPER_ADMIN') {
            // Non-superadmin tries to access superadmin panel → redirect to their dashboard
            url.pathname = '/app/dashboard'
            return NextResponse.redirect(url)
        }
    }

    return res
}

export const config = {
    matcher: ['/app/:path*', '/portal/:path*', '/superadmin/:path*', '/'],
}
