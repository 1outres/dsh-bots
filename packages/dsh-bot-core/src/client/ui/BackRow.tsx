import { IconChevronLeft } from "../icons"

/** The way back from a detail page, named after the page it returns to (‹ Connectors). */
export function BackRow({ label, onBack }: { readonly label: string; onBack(): void }) {
  return (
    <button type="button" className="dshb-ui-back" onClick={onBack} data-dshb-page-back="">
      <IconChevronLeft size={14} />
      {label}
    </button>
  )
}
