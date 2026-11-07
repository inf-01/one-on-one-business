/* ============================================================
   ONE ON ONE BUSINESS — Miembros dinámicos (sin nombres fijos)
   Cada perfil registrado recibe un color estable (índice en la lista).
   Los 2 primeros conservan los colores históricos (indigo / sky).
   ============================================================ */

import type { Profile } from './types';

/** Normaliza para comparar sin tildes/mayúsculas ("José" ≡ "Jose" ≡ "JOSE"). */
export function foldName(s: string): string {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Clase CSS estable para un display_name dentro de una lista. */
export function memberClass(name: string, list: string[]): string {
  const key = foldName(name);
  const i = list.findIndex(n => foldName(n) === key);
  if (i < 0) return 'member-0';
  if (i === 0) return 'jose';
  if (i === 1) return 'luis';
  return 'member-' + (i % 8);
}

/** Lista de nombres desde perfiles. */
export function memberNames(profiles: Profile[]): string[] {
  return profiles.map(p => p.display_name).filter(Boolean);
}

/** Acorta el nombre para chips (máx. 10 caracteres visibles). */
export function shortName(name: string): string {
  const s = String(name || '').trim();
  return s.length > 12 ? s.slice(0, 11) + '…' : s.toUpperCase();
}
