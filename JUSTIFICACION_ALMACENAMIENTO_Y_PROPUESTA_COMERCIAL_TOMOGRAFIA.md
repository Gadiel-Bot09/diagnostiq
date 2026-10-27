# Justificación Técnica de Almacenamiento y Propuesta Comercial: Implementación de Visor de Tomografías en DiagnostiQ

> **Destinatario:** Dirección General / Gerencia Médica / Junta Directiva  
> **Sistema:** Plataforma DiagnostiQ  
> **Módulo:** Visor Web de Tomografía 3D (DICOM) sin Instalación  
> **Objetivo del Documento:** Presentar el impacto real en almacenamiento, el retorno de inversión (ROI) y la justificación económica de la tarifa a cobrar por el desarrollo y mantenimiento del nuevo módulo.

---

## 1. Resumen Ejecutivo y Propuesta de Valor

Actualmente, **DiagnostiQ** opera eficientemente como un portal de entrega de resultados clínicos y de laboratorio en formato PDF. 

La incorporación de **Tomografía Axial Computarizada (TAC / CBCT)** eleva a DiagnostiQ de un "portal de entrega de documentos" a un **Sistema PACS Web de Imagenología Médica** de última generación.

### El Problema que la Entidad Resuelve Hoy con Esta Implementación:
1. **Eliminación del CD/DVD y memorias USB:** Los computadores modernos ya no traen unidad de CD. La clínica gasta dinero en discos, quemadores o memorias USB que frecuentemente se dañan o extravían.
2. **Cero fricción para el paciente:** El paciente no tiene que descargar 500 MB, ni descomprimir archivos raros, ni instalar programas ejecutables de Windows que son bloqueados por antivirus.
3. **Acceso móvil real (iPhone y Android):** El paciente y el médico remitente pueden evaluar la tomografía desde un smartphone o tablet inmediatamente en la consulta.
4. **Herramienta para el Odontólogo / Especialista:** Permite al cirujano o implantólogo medir en milímetros directamente en pantalla y cambiar ventanas de contraste óseo, o descargar el archivo DICOM limpio para su software de diseño quirúrgico (Exocad, NemoCast, BlueSkyPlan).

---

## 2. Análisis Técnico del Aumento en Almacenamiento

### 2.1. Comparativa de Peso: Laboratorio Convencional vs. Tomografía

| Tipo de Estudio | Archivo Típico | Peso Promedio | Equivalencia |
| :--- | :--- | :--- | :--- |
| **Examen de Laboratorio / Informe Radiológico** | 1 archivo PDF | **0.3 MB – 1.5 MB** | 1x (Base) |
| **Tomografía Cruda con Visor de Escritorio** | 384 cortes `.dcm` + Visor Galileo | **459.5 MB** | **~450 veces** un PDF |
| **Tomografía Optimizada DiagnostiQ** | 384 cortes `.dcm` en ZIP (Sin visor de escritorio) | **127.3 MB** | **~120 veces** un PDF |

> [!IMPORTANT]
> **La Optimización de DiagnostiQ:**  
> Gracias a que el visor se ejecutará en la web, se descarta el software instalador de Windows (`VISOR GALILEO`), reduciendo el consumo de disco de **459.5 MB a 127.3 MB por paciente**. Esto representa un **ahorro permanente del 72%** en almacenamiento y ancho de banda.

---

### 2.2. Proyección de Consumo de Espacio según Volumen de Estudios

A continuación se detalla el crecimiento mensual y acumulado en el almacenamiento de MinIO / S3 según el volumen de pacientes que atienda el centro de imágenes:

| Volumen Mensual de Tomografías | Espacio Nuevo por Mes | Espacio Acumulado en 6 Meses | Espacio Acumulado en 1 Año |
| :--- | :--- | :--- | :--- |
| **50 tomografías / mes** | 6.36 GB | 38.16 GB | **76.3 GB** |
| **100 tomografías / mes** | 12.73 GB | 76.38 GB | **152.7 GB** |
| **200 tomografías / mes** | 25.46 GB | 152.76 GB | **305.5 GB** |
| **500 tomografías / mes** | 63.65 GB | 381.90 GB | **763.8 GB** |

---

### 2.3. Costos Reales de Infraestructura Cloud para DiagnostiQ

El almacenamiento de objetos en la nube (MinIO en servidor privado, AWS S3 o Cloudflare R2) tiene costos muy accesibles por gigabyte:

- **Tarifa promedio de Storage Cloud:** \$0.015 USD a \$0.023 USD por GB al mes.
- **Costo de 100 tomografías (12.7 GB):** Apenas **\$0.25 USD a \$0.35 USD mensuales**.
- **Costo de 1,000 tomografías acumuladas (~127 GB):** Apenas **\$2.00 USD a \$2.90 USD mensuales**.

> [!TIP]
> **Conclusión de Infraestructura:**  
> El costo de los discos o del almacenamiento en la nube es **marginal** (menos de \$5 a \$10 USD al mes incluso con miles de estudios). El verdadero valor y el motivo del cobro a la entidad no es el "costo del disco duro", sino la **propiedad intelectual, el desarrollo del motor de renderizado 3D web, la seguridad, la disponibilidad y el ahorro masivo de insumos físicos para la entidad**.

---

## 3. Retorno de Inversión (ROI) para la Entidad: El Argumento de Negociación

Para justificar el precio ante la gerencia o los socios de la entidad, es vital mostrarles **cuánto dinero están perdiendo hoy** con el modelo tradicional:

### 3.1. Costos Actuales de la Entidad (Modelo Tradicional con CD / USB)

Por cada 100 tomografías entregadas en formato físico:
1. **Costo de insumos físicos (CD/DVD imprimible + Estuche o Sobre institucional):**
   - \$0.60 USD a \$1.00 USD por disco.
   - En 100 estudios = **\$60 – \$100 USD**.
2. **Memorias USB (cuando el paciente o clínica exige USB):**
   - Si entregan apenas 20 memorias USB al mes a \$4.00 USD c/u = **\$80 USD**.
3. **Desgaste de quemadores y tinta de impresión térmica de discos:**
   - Estimado mensual: **\$30 – \$50 USD**.
4. **Tiempo operativo de auxiliares:**
   - Quemar un disco de 500 MB, verificarlo e imprimir la etiqueta tarda entre **10 y 15 minutos por paciente**. En 100 estudios son más de **20 horas de trabajo del personal** dedicadas exclusivamente a quemar discos.
5. **Costo de quejas y soporte:**
   - Pacientes que regresan al centro diciendo: *"Doctor, mi portátil no tiene bandeja de CD"* o *"No me abre en mi Mac"*. El centro debe dedicar tiempo o volver a quemar el estudio.

> **Gasto mensual actual de la entidad en insumos físicos:**  
> Entre **\$150 USD y \$300 USD mensuales** por cada 100 tomografías (sin contar el tiempo del personal).

### 3.2. Ahorro Inmediato con DiagnostiQ:
Al tener el visor web en DiagnostiQ:
- El costo de insumos físicos pasa a **\$0**.
- El personal sube el archivo en 30 segundos en lugar de esperar 15 minutos quemando discos.
- **La implementación en DiagnostiQ se autofinancia con el ahorro de CDs y memorias USB en pocos meses.**

---

## 4. Cuánto Cobrar: Estructura de Precios Sugerida

Se recomienda una estructura comercial de **dos niveles**: un cobro único por el desarrollo e integración, más un componente recurrente (mensual o por estudio) para cubrir almacenamiento, mantenimiento y soporte.

---

### MODELO RECOMENDADO: Implementación Única + Fee Mensual de Mantenimiento y Almacenamiento

#### 1. Tarifa de Implementación y Desarrollo (Pago Único / Setup Fee)
Cubre el diseño, arquitectura, programación del visor DICOM, integración con MinIO/Supabase, pruebas con equipos radiológicos y puesta en marcha:

- **Precio Sugerido en Mercado Latinoamericano:** **\$1,200 – \$2,500 USD**  
  *(o su equivalente en moneda local, ej. en Colombia: \$5,000,000 – \$10,000,000 COP)*.
- **Rango Conservador / Entidad Pequeña:** **\$800 – \$1,200 USD** (\$3,500,000 – \$5,000,000 COP).
- **Rango Premium / Red de Clínicas o Centro Radiológico Mediano:** **\$1,800 – \$3,000 USD** (\$7,500,000 – \$12,000,000 COP).

**Qué incluye para justificar este valor:**
- Modificación del esquema de base de datos en Supabase para soporte de estudios volumétricos.
- Ampliación y validación del cargador por lotes ([ResultUploader.tsx](file:///C:/Users/RICAR/Escritorio/AppWeb/DiagnostiQ/src/components/ResultUploader.tsx)) para paquetes DICOM.
- Implementación del motor de visualización web médica (`DWV` / `Cornerstone`) integrado de forma nativa en React 19.
- Herramientas clínicas: Slider de cortes (384 capas), control de ventana Hounsfield (brillo y contraste óseo/tejido blando), zoom interactivo, paneo y calibración de regla de medición en milímetros para implantología.
- Portal del paciente multidispositivo (PC, Mac, iPhone, Android).
- Opción de descarga del archivo DICOM bruto empaquetado para odontólogos especialistas.
- Capacitación al personal del laboratorio para la preparación y cargue de los archivos sin visor de escritorio.

---

#### 2. Esquema Recurrente de Almacenamiento y Mantenimiento

Para cubrir el consumo incremental de disco en MinIO/S3, copias de seguridad de las tomografías y soporte continuo:

##### Alternativa A: Ajuste de Mensualidad por Paquete de Volumen (Recomendada)
Incrementar la mensualidad actual que la entidad paga por el software DiagnostiQ según un plan de estudios:

| Plan | Límite de Tomografías / Mes | Adicional a la Mensualidad |
| :--- | :--- | :--- |
| **Plan Básico Imagenología** | Hasta 50 tomografías / mes | **+\$50 – \$80 USD / mes** (~$200,000 – $320,000 COP) |
| **Plan Estándar Imagenología** | Hasta 150 tomografías / mes | **+\$100 – \$150 USD / mes** (~$400,000 – $600,000 COP) |
| **Plan Pro / Centro de Radiología** | Hasta 300 tomografías / mes | **+\$200 – \$280 USD / mes** (~$800,000 – $1,150,000 COP) |
| **Estudio adicional fuera de paquete** | Por cada tomografía extra | **\$0.80 – \$1.20 USD / estudio** |

##### Alternativa B: Cobro por Estudio Procesado (Pay-Per-Study)
Si la entidad prefiere no atarse a un costo fijo alto:
- **Valor por tomografía cargada:** **\$1.00 a \$1.50 USD por estudio** (aprox. \$4,000 a \$6,000 COP).
- **Justificación:** Cobrarle al paciente o a la clínica \$1.50 USD por alojar su tomografía en la nube con visor interactivo de por vida es sumamente económico (la clínica habitualmente cobra entre \$35 y \$90 USD por realizar una tomografía dental o maxilofacial).

---

## 5. Comparativa con el Mercado (Benchmark)

Si la entidad intentara contratar esta solución con proveedores externos de PACS en la nube:

| Proveedor / Solución | Costo de Implementación / Setup | Costo Mensual Recurrente | Desventajas frente a DiagnostiQ |
| :--- | :--- | :--- | :--- |
| **Plataformas PACS en la Nube Comerciales** (Ambra Health, RamSoft, PostDICOM) | \$2,500 – \$5,000 USD | \$300 – \$800 USD/mes + cobro por estudio | Es un sistema externo separado. Los pacientes tendrían dos contraseñas distintas: una para laboratorios en DiagnostiQ y otra para tomografías. |
| **Servidores PACS Propios Tradicionales** | \$3,000 – \$7,000 USD (Servidor físico + licencias) | Costos de luz, mantenimiento de servidor y soporte IT local | Requiere computadores dedicados y no están optimizados para visualización rápida en celulares de pacientes. |
| **Módulo Integrado en DiagnostiQ** | **\$1,200 – \$2,000 USD (Único)** | **\$80 – \$150 USD/mes** | **Solución 100% unificada:** El paciente entra con su mismo usuario y contraseña de DiagnostiQ y ve sus análisis de sangre y su tomografía 3D en el mismo lugar bajo la marca de la entidad. |

---

## 6. Guía Rápida para la Reunión de Presentación a la Entidad

Cuando presentes esta propuesta a los directivos de la entidad, enfócate en estos tres mensajes clave:

1. **"Es una inversión que se paga sola":**  
   Demuéstrales que lo que van a dejar de gastar en CDs, empaques, memorias USB y tiempo del personal de recepción pagará completamente la inversión en menos de 6 a 9 meses.
2. **"Resolución definitiva de quejas de pacientes y médicos":**  
   Hoy en día la mayoría de portátiles modernos (MacBook, laptops delgadas) no leen CDs. DiagnostiQ les dará una ventaja competitiva frente a otros centros de diagnóstico: el odontólogo podrá ver la tomografía en su iPad en segundos.
3. **"Optimización inteligente de almacenamiento":**  
   Explícales que el desarrollo incluye un motor de optimización que reduce el tamaño del estudio de 460 MB a 127 MB, evitando saturar el servidor y manteniendo los costos de operación sumamente bajos.

---

## 7. Resumen de la Cotización Sugerida para Presentar

```
══════════════════════════════════════════════════════════════════════════
PROPUESTA DE MÓDULO DE IMAGENOLOGÍA MÉDICA WEB (TOMOGRAFÍA 3D / DICOM)
══════════════════════════════════════════════════════════════════════════

1. DESARROLLO, INTEGRACIÓN Y DESPLIEGUE (PAGO ÚNICO):
   • Integración de motor de visualización web médica (cero instalación)
   • Herramientas de diagnóstico: navegación de cortes, contraste óseo y regla milimétrica
   • Adaptación de base de datos Supabase y módulo de carga por lotes
   • Interfaz multidispositivo (Móvil, Tablet, Computador)
   • Inversión Única: $1,500 USD (o equivalente en moneda local)

2. PLAN DE ALMACENAMIENTO SEGURO Y MANTENIMIENTO (MENSUAL):
   • Plan Base (Hasta 100 tomografías mensuales + soporte continuo): +$100 USD / mes
   • Incluye almacenamiento redundante en MinIO / S3, copias de respaldo y ancho de banda.
   • Tomografía adicional fuera de paquete: $1.00 USD c/u.

AHORRO ESTIMADO PARA LA ENTIDAD:
   • Ahorro directo en insumos de CD/USB: ~$120 a $250 USD / mes.
   • Retorno de la inversión (ROI): 6 a 8 meses.
══════════════════════════════════════════════════════════════════════════
```
