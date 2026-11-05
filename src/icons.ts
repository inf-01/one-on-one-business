/* ============================================================
   ONE ON ONE BUSINESS — Iconos SVG corporativos
   Trazo 1.5px sobre viewBox 16×16, siempre en currentColor
   (el color lo gobierna CSS según estado/tema).
   ============================================================ */

export type IconName =
  | 'sun'
  | 'moon'
  | 'bell'
  | 'bellOff'
  | 'download'
  | 'upload'
  | 'doc'
  | 'chart'
  | 'trash';

const SVG_OPEN =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

const PATHS: Record<IconName, string> = {
  /* Sol: disco + 8 rayos */
  sun:
    '<circle cx="8" cy="8" r="3"/>' +
    '<path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/>',

  /* Luna: creciente */
  moon: '<path d="M8 2a4 4 0 0 0 6 6 6 6 0 1 1-6-6Z"/>',

  /* Campana */
  bell:
    '<path d="M4 5.3a4 4 0 0 1 8 0c0 4.7 2 6 2 6H2s2-1.3 2-6"/>' +
    '<path d="M6.9 14a1.3 1.3 0 0 0 2.2 0"/>',

  /* Campana apagada (tacha) */
  bellOff:
    '<path d="M4 5.3a4 4 0 0 1 8 0c0 4.7 2 6 2 6H2s2-1.3 2-6"/>' +
    '<path d="M6.9 14a1.3 1.3 0 0 0 2.2 0"/>' +
    '<path d="M2 2l12 12"/>',

  /* Exportar (descargar) */
  download:
    '<path d="M8 2.5v7"/>' +
    '<path d="M5 7l3 3 3-3"/>' +
    '<path d="M2.5 13.5h11"/>',

  /* Importar (subir) */
  upload:
    '<path d="M8 9.5v-7"/>' +
    '<path d="M5 5.5l3-3 3 3"/>' +
    '<path d="M2.5 13.5h11"/>',

  /* Documento de minuta */
  doc:
    '<path d="M4 1.8h5l3 3v9.4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2.8a1 1 0 0 1 1-1Z"/>' +
    '<path d="M9 1.8v3h3"/>' +
    '<path d="M5.5 8.5h5M5.5 11h5M5.5 13.5h3"/>',

  /* Gráfica de barras (dashboard) */
  chart:
    '<path d="M2.5 13.5h11"/>' +
    '<path d="M5 11.5V8.5"/><path d="M8 11.5V6"/><path d="M11 11.5V3.5"/>',

  /* Papelera (eliminar documento) */
  trash:
    '<path d="M2.5 4.5h11"/>' +
    '<path d="M6 4.5V3.2a.6.6 0 0 1 .6-.6h2.8a.6.6 0 0 1 .6.6v1.3"/>' +
    '<path d="M4 4.5l.55 8.05a1 1 0 0 0 1 .95h4.9a1 1 0 0 0 1-.95L12 4.5"/>' +
    '<path d="M6.4 7.2v3.9M9.6 7.2v3.9"/>'
};

/** Marcas SVG completas por nombre de icono. */
export const ICONS: Record<IconName, string> = Object.fromEntries(
  (Object.keys(PATHS) as IconName[]).map(name => [name, SVG_OPEN + PATHS[name] + '</svg>'])
) as Record<IconName, string>;

/** Dibuja un icono dentro de un elemento (innerHTML de SVG). */
export function drawIcon(el: HTMLElement, name: IconName): void {
  el.innerHTML = ICONS[name];
}
