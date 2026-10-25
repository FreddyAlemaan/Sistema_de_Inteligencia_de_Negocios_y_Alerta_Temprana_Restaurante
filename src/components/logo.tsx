import { cn } from '@/lib/utils'

// Aleta de ballena: el logo de Vila Baleia, redibujado en vector.
export const ALETA =
  'M26 61 C28.5 53 29.8 45 30 40 C23.5 39.3 14.8 36.6 9.5 30.5 C6.8 27.6 5 24.2 3.5 19.5 C10 22.5 18 24 24 25.2 C28 26 30.8 28.6 32 32 C33.2 28.6 36 26 40 25.2 C46 24 54 22.5 60.5 19.5 C59 24.2 57.2 27.6 54.5 30.5 C49.2 36.6 40.5 39.3 34 40 C34.2 45 35.5 53 38 61 Z'

/** Círculo claro con la aleta en el azul de la empresa. */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full bg-[#f4ead8] text-[#2f56b0]',
        className,
      )}
    >
      <svg viewBox="2 16 60 47" className="w-[72%]" fill="currentColor" aria-hidden="true">
        <path d={ALETA} />
      </svg>
    </span>
  )
}
