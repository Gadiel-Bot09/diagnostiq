export interface DocumentTypeOption {
    value: string
    label: string
}

export const DOCUMENT_TYPES: DocumentTypeOption[] = [
    { value: "CC", label: "Cédula de Ciudadanía (CC)" },
    { value: "TI", label: "Tarjeta de Identidad (TI)" },
    { value: "CE", label: "Cédula de Extranjería (CE)" },
    { value: "RC", label: "Registro Civil (RC)" },
    { value: "PA", label: "Pasaporte (PA)" },
    { value: "PEP", label: "Permiso Especial de Permanencia (PEP)" },
]

export function getDocumentTypeLabel(value?: string | null): string {
    if (!value) return ""
    const found = DOCUMENT_TYPES.find((d) => d.value === value)
    return found ? found.label : value
}
