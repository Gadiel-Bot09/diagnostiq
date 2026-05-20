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

    // 1. If not logged in and trying to access protected routes
    if (!session) {
        if (url.pathname.startsWith('/app') && url.pathname !== '/app/login') {
            url.pathname = '/app/login'
            return NextResponse.redirect(url)
        }
        if (url.pathname.startsWith('/portal') && url.pathname !== '/portal/login') {
            url.pathname = '/portal/login'
            return NextResponse.redirect(url)
        }
        return res
    }

    // Optional: Redirect from root to appropriate dashboard
    if (url.pathname === '/') {
        return res
    }

    return res
}

export const config = {
    matcher: ['/app/:path*', '/portal/:path*', '/'],
}

