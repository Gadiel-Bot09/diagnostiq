"use client"

import { useState, useEffect } from "react"
import { AlertTriangle, Key, Loader2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

export function PasswordChangeBanner() {
    const [isVisible, setIsVisible] = useState(false)
    const [isDialogOpen, setIsDialogOpen] = useState(false)
    const [newPassword, setNewPassword] = useState("")
    const [isLoading, setIsLoading] = useState(false)
    const supabase = createClient()
    const { toast } = useToast()

    useEffect(() => {
        const checkUser = async () => {
            const { data: { user } } = await supabase.auth.getUser()
            if (user && user.user_metadata?.password_changed === false) {
                setIsVisible(true)
            }
        }
        checkUser()
    }, [supabase])

    const handlePasswordChange = async () => {
        if (newPassword.length < 6) {
            toast({
                variant: "destructive",
                title: "Contraseña muy corta",
                description: "La nueva contraseña debe tener al menos 6 caracteres.",
            })
            return
        }

        setIsLoading(true)
        
        const { error } = await supabase.auth.updateUser({
            password: newPassword,
            data: { password_changed: true }
        })

        if (error) {
            toast({
                variant: "destructive",
                title: "Error al actualizar",
                description: error.message,
            })
            setIsLoading(false)
            return
        }

        toast({
            title: "Contraseña actualizada",
            description: "Tu contraseña ha sido cambiada exitosamente.",
        })
        
        setIsVisible(false)
        setIsDialogOpen(false)
        setIsLoading(false)
    }

    if (!isVisible) return null

    return (
        <>
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-md shadow-sm">
                <div className="flex">
                    <div className="flex-shrink-0">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                    </div>
                    <div className="ml-3 flex-1 md:flex md:justify-between items-center">
                        <p className="text-sm text-amber-800">
                            <strong>Seguridad:</strong> Te sugerimos cambiar tu contraseña inicial (N° de documento) por una más segura.
                        </p>
                        <p className="mt-3 text-sm md:mt-0 md:ml-6">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="bg-white text-amber-700 border-amber-300 hover:bg-amber-100"
                                onClick={() => setIsDialogOpen(true)}
                            >
                                <Key className="w-4 h-4 mr-2" />
                                Cambiar ahora
                            </Button>
                        </p>
                    </div>
                </div>
            </div>

            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Cambiar Contraseña</DialogTitle>
                        <DialogDescription>
                            Ingresa tu nueva contraseña. Asegúrate de usar algo que recuerdes fácilmente.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="new-password">Nueva Contraseña</Label>
                            <Input 
                                id="new-password" 
                                type="password" 
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Mínimo 6 caracteres"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isLoading}>
                            Cancelar
                        </Button>
                        <Button onClick={handlePasswordChange} disabled={isLoading}>
                            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Actualizar Contraseña
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
