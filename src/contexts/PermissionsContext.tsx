"use client"

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, useRef } from "react"
import { createClient } from "@/lib/supabase/client"

export type Permission = {
    module: string
    action: string
}

export type PermissionsContextType = {
    user: any | null
    profile: any | null
    lab: any | null
    permissions: Permission[]
    isLoading: boolean
    hasPermission: (module: string, action: string) => boolean
    refreshPermissions: () => Promise<void>
}

const PermissionsContext = createContext<PermissionsContextType>({
    user: null,
    profile: null,
    lab: null,
    permissions: [],
    isLoading: true,
    hasPermission: () => false,
    refreshPermissions: async () => {},
})

// Helper for timeout to prevent deadlocks or hanging requests
function withTimeout<T>(promise: PromiseLike<T>, ms = 8000): Promise<T> {
    return Promise.race([
        Promise.resolve(promise),
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
        ),
    ])
}

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<any | null>(null)
    const [profile, setProfile] = useState<any | null>(null)
    const [lab, setLab] = useState<any | null>(null)
    const [permissions, setPermissions] = useState<Permission[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const supabase = useMemo(() => createClient(), [])
    const isMountedRef = useRef(true)
    const profileRef = useRef<any | null>(null)
    const loadedUserIdRef = useRef<string | null>(null)
    const inFlightRef = useRef(false)

    // Keep profileRef in sync with state
    useEffect(() => {
        profileRef.current = profile
    }, [profile])

    const loadPermissions = useCallback(async (forcedUser?: any, forceRefresh = false) => {
        // Prevent concurrent overlapping requests
        if (inFlightRef.current && !forceRefresh) return
        inFlightRef.current = true

        try {
            // Only set isLoading(true) if we don't already have profile data in memory
            // This prevents the sidebar from flashing/turning into skeletons during background sync
            if (!profileRef.current) {
                setIsLoading(true)
            }

            let authUser = forcedUser
            if (!authUser) {
                const { data } = await withTimeout(supabase.auth.getUser())
                authUser = data?.user || null
            }

            if (!authUser) {
                if (isMountedRef.current) {
                    setUser(null)
                    setProfile(null)
                    setLab(null)
                    setPermissions([])
                    loadedUserIdRef.current = null
                    setIsLoading(false)
                }
                return
            }

            // If we already loaded this user's profile and permissions and this isn't a forced refresh, no need to re-query
            if (
                !forceRefresh &&
                loadedUserIdRef.current === authUser.id &&
                profileRef.current !== null
            ) {
                if (isMountedRef.current) {
                    setIsLoading(false)
                }
                return
            }

            if (isMountedRef.current) {
                setUser(authUser)
            }

            // Get profile with timeout protection
            const { data: profileData, error: profileError } = await withTimeout(
                supabase
                    .from("profiles")
                    .select("id, full_name, role, lab_id, is_active")
                    .eq("id", authUser.id)
                    .single()
            )

            if (!isMountedRef.current) return

            if (profileError || !profileData) {
                // If user already had a profile, don't wipe it out on a transient network glitch
                if (!profileRef.current) {
                    setProfile(null)
                    setLab(null)
                    setPermissions([])
                }
                setIsLoading(false)
                return
            }

            setProfile(profileData)
            loadedUserIdRef.current = authUser.id

            // Get Lab info
            if (profileData.lab_id) {
                try {
                    const { data: labData } = await withTimeout(
                        supabase
                            .from("labs")
                            .select("id, name, slug, logo_url")
                            .eq("id", profileData.lab_id)
                            .single()
                    )
                    if (isMountedRef.current) {
                        setLab(labData || null)
                    }
                } catch {
                    // Retain existing lab if query failed
                }
            } else {
                if (isMountedRef.current) {
                    setLab(null)
                }
            }

            // Get Permissions
            if (profileData.role === "SUPER_ADMIN" || profileData.role === "LAB_ADMIN") {
                if (isMountedRef.current) {
                    setPermissions([{ module: "*", action: "*" }])
                }
            } else if (profileData.role === "LAB_STAFF") {
                try {
                    const { data: assignments } = await withTimeout(
                        supabase
                            .from("staff_role_assignments")
                            .select("custom_role_id")
                            .eq("profile_id", authUser.id)
                            .eq("lab_id", profileData.lab_id)
                            .maybeSingle()
                    )

                    if (assignments?.custom_role_id) {
                        const { data: rolePerms } = await withTimeout(
                            supabase
                                .from("role_permissions")
                                .select("module, action")
                                .eq("role_id", assignments.custom_role_id)
                        )

                        if (isMountedRef.current) {
                            setPermissions(rolePerms || [])
                        }
                    } else {
                        if (isMountedRef.current) {
                            setPermissions([])
                        }
                    }
                } catch {
                    // Retain existing permissions if query failed
                }
            } else {
                if (isMountedRef.current) {
                    setPermissions([])
                }
            }
        } catch (err) {
            console.error("Error loading permissions:", err)
        } finally {
            inFlightRef.current = false
            if (isMountedRef.current) {
                setIsLoading(false)
            }
        }
    }, [supabase])

    useEffect(() => {
        isMountedRef.current = true

        // 1. Initial fetch
        loadPermissions()

        // 2. Auth state subscription
        // CRITICAL: We DO NOT react to TOKEN_REFRESHED. A token refresh happens every hour automatically
        // in the background and does NOT change the user's role or permissions.
        // We only react to SIGNED_IN (new session) and SIGNED_OUT.
        // Also, defer the call with setTimeout to avoid Supabase auth mutex deadlock.
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            if (!isMountedRef.current) return

            if (event === "SIGNED_IN") {
                // If it's a new or different user, schedule load outside the auth callback lock
                if (session?.user && session.user.id !== loadedUserIdRef.current) {
                    setTimeout(() => {
                        if (isMountedRef.current) {
                            loadPermissions(session.user, true)
                        }
                    }, 0)
                }
            } else if (event === "USER_UPDATED") {
                // User profile updated in auth metadata
                if (session?.user) {
                    setTimeout(() => {
                        if (isMountedRef.current) {
                            loadPermissions(session.user, true)
                        }
                    }, 0)
                }
            } else if (event === "SIGNED_OUT") {
                setUser(null)
                setProfile(null)
                setLab(null)
                setPermissions([])
                loadedUserIdRef.current = null
                setIsLoading(false)
            }
        })

        return () => {
            isMountedRef.current = false
            subscription.unsubscribe()
        }
    }, [loadPermissions, supabase])

    const hasPermission = useCallback((module: string, action: string) => {
        if (!profile) return false
        if (profile.role === "SUPER_ADMIN" || profile.role === "LAB_ADMIN") return true
        
        return permissions.some(p => 
            (p.module === "*" || p.module === module) && 
            (p.action === "*" || p.action === action)
        )
    }, [profile, permissions])

    const refreshPermissions = useCallback(async () => {
        await loadPermissions(undefined, true)
    }, [loadPermissions])

    return (
        <PermissionsContext.Provider value={{ user, profile, lab, permissions, isLoading, hasPermission, refreshPermissions }}>
            {children}
        </PermissionsContext.Provider>
    )
}

export const usePermissions = () => useContext(PermissionsContext)
