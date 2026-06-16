import { AdminLayout } from "@/components/layout/AdminLayout"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { UsersList } from "@/components/users/UsersList"
import { RolesList } from "@/components/users/RolesList"
import { Users, ShieldCheck } from "lucide-react"

export default function UsersPage() {
    return (
        <AdminLayout>
            <div className="space-y-6">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Usuarios y Roles</h1>
                    <p className="text-muted-foreground mt-1">Administra el acceso y los permisos de tu equipo de trabajo.</p>
                </div>

                <Tabs defaultValue="users" className="space-y-6">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="users" className="gap-2 px-6">
                            <Users className="h-4 w-4" /> Personal
                        </TabsTrigger>
                        <TabsTrigger value="roles" className="gap-2 px-6">
                            <ShieldCheck className="h-4 w-4" /> Roles y Permisos
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="users" className="border-none p-0">
                        <UsersList />
                    </TabsContent>

                    <TabsContent value="roles" className="border-none p-0">
                        <RolesList />
                    </TabsContent>
                </Tabs>
            </div>
        </AdminLayout>
    )
}
