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

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<any | null>(null)
    const [profile, setProfile] = useState<any | null>(null)
    const [lab, setLab] = useState<any | null>(null)
    const [permissions, setPermissions] = useState<Permission[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const supabase = useMemo(() => createClient(), [])
    const isMountedRef = useRef(true)

    const loadPermissions = useCallback(async (forcedUser?: any) => {
        try {
            setIsLoading(true)

            let authUser = forcedUser
            if (!authUser) {
                const { data } = await supabase.auth.getUser()
                authUser = data?.user || null
            }

            if (!authUser) {
                if (isMountedRef.current) {
                    setUser(null)
                    setProfile(null)
                    setLab(null)
                    setPermissions([])
                    setIsLoading(false)
                }
                return
            }

            if (isMountedRef.current) {
                setUser(authUser)
            }

            // Get profile
            const { data: profileData, error: profileError } = await supabase
                .from("profiles")
                .select("id, full_name, role, lab_id, is_active")
                .eq("id", authUser.id)
                .single()

            if (!isMountedRef.current) return

            if (profileError || !profileData) {
                setProfile(null)
                setLab(null)
                setPermissions([])
                setIsLoading(false)
                return
            }

            setProfile(profileData)

            // Get Lab info
            if (profileData.lab_id) {
                const { data: labData } = await supabase
                    .from("labs")
                    .select("id, name, slug, logo_url")
                    .eq("id", profileData.lab_id)
                    .single()
                
                if (isMountedRef.current) {
                    setLab(labData || null)
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
                const { data: assignments } = await supabase
                    .from("staff_role_assignments")
                    .select("custom_role_id")
                    .eq("profile_id", authUser.id)
                    .eq("lab_id", profileData.lab_id)
                    .maybeSingle()

                if (assignments?.custom_role_id) {
                    const { data: rolePerms } = await supabase
                        .from("role_permissions")
                        .select("module, action")
                        .eq("role_id", assignments.custom_role_id)

                    if (isMountedRef.current) {
                        setPermissions(rolePerms || [])
                    }
                } else {
                    if (isMountedRef.current) {
                        setPermissions([])
                    }
                }
            } else {
                if (isMountedRef.current) {
                    setPermissions([])
                }
            }
        } catch (err) {
            console.error("Error loading permissions:", err)
        } finally {
            if (isMountedRef.current) {
                setIsLoading(false)
            }
        }
    }, [supabase])

    useEffect(() => {
        isMountedRef.current = true

        // 1. Initial fetch
        loadPermissions()

        // 2. Auth state subscription: reacts to SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
            if (!isMountedRef.current) return

            if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
                if (session?.user) {
                    await loadPermissions(session.user)
                }
            } else if (event === "SIGNED_OUT") {
                setUser(null)
                setProfile(null)
                setLab(null)
                setPermissions([])
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
        await loadPermissions()
    }, [loadPermissions])

    return (
        <PermissionsContext.Provider value={{ user, profile, lab, permissions, isLoading, hasPermission, refreshPermissions }}>
            {children}
        </PermissionsContext.Provider>
    )
}

export const usePermissions = () => useContext(PermissionsContext)
