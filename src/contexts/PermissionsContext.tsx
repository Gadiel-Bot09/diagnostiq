"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"

type Permission = {
    module: string
    action: string
}

type PermissionsContextType = {
    user: any | null
    profile: any | null
    lab: any | null
    permissions: Permission[]
    isLoading: boolean
    hasPermission: (module: string, action: string) => boolean
}

const PermissionsContext = createContext<PermissionsContextType>({
    user: null,
    profile: null,
    lab: null,
    permissions: [],
    isLoading: true,
    hasPermission: () => false,
})

export function PermissionsProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<any | null>(null)
    const [profile, setProfile] = useState<any | null>(null)
    const [lab, setLab] = useState<any | null>(null)
    const [permissions, setPermissions] = useState<Permission[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const supabase = createClient()

    useEffect(() => {
        let isMounted = true

        const loadPermissions = async () => {
            try {
                const { data: { user } } = await supabase.auth.getUser()
                if (!user) {
                    if (isMounted) setIsLoading(false)
                    return
                }

                if (isMounted) setUser(user)

                // Get profile
                const { data: profileData, error: profileError } = await supabase
                    .from("profiles")
                    .select("id, full_name, role, lab_id, is_active")
                    .eq("id", user.id)
                    .single()

                if (profileError || !profileData) {
                    if (isMounted) setIsLoading(false)
                    return
                }

                if (isMounted) setProfile(profileData)

                // Get Lab info
                if (profileData.lab_id) {
                    const { data: labData } = await supabase
                        .from("labs")
                        .select("id, name, slug, logo_url")
                        .eq("id", profileData.lab_id)
                        .single()
                    
                    if (isMounted && labData) setLab(labData)
                }

                // Get Permissions
                if (profileData.role === "SUPER_ADMIN" || profileData.role === "LAB_ADMIN") {
                    // Admins have all permissions implicitly, but we can set a flag or just handle it in hasPermission
                    if (isMounted) setPermissions([{ module: "*", action: "*" }])
                } else if (profileData.role === "LAB_STAFF") {
                    // Fetch custom role assignments
                    const { data: assignments } = await supabase
                        .from("staff_role_assignments")
                        .select("custom_role_id")
                        .eq("profile_id", user.id)
                        .eq("lab_id", profileData.lab_id)
                        .single()

                    if (assignments?.custom_role_id) {
                        const { data: rolePerms } = await supabase
                            .from("role_permissions")
                            .select("module, action")
                            .eq("role_id", assignments.custom_role_id)

                        if (isMounted && rolePerms) {
                            setPermissions(rolePerms)
                        }
                    }
                }
            } catch (err) {
                console.error("Error loading permissions:", err)
            } finally {
                if (isMounted) setIsLoading(false)
            }
        }

        loadPermissions()

        return () => {
            isMounted = false
        }
    }, [])

    const hasPermission = (module: string, action: string) => {
        if (!profile) return false
        if (profile.role === "SUPER_ADMIN" || profile.role === "LAB_ADMIN") return true
        
        return permissions.some(p => p.module === module && p.action === action)
    }

    return (
        <PermissionsContext.Provider value={{ user, profile, lab, permissions, isLoading, hasPermission }}>
            {children}
        </PermissionsContext.Provider>
    )
}

export const usePermissions = () => useContext(PermissionsContext)
