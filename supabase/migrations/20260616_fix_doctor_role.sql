-- Migración: Fix Doctor Role & Users Module

-- 1. Agregar el rol 'DOCTOR' al enum user_role
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'DOCTOR';

-- 2. Agregar la columna de especialidad a la tabla profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS specialty TEXT;

-- 3. Asegurar que las políticas de perfiles permitan al médico ver su propio perfil (por si acaso no existe)
-- Las políticas existentes (ver y actualizar propio perfil) ya cubren DOCTOR asumiendo que usan auth.uid() = id
