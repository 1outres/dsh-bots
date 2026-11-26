import { IconChevronLeft } from "../icons"

export function BackRow({ label, onBack }: { readonly label: string; onBack(): void }) {
  return (
    <button type="button" className="dshb-ui-back" onClick={onBack} data-dshb-page-back="">
      <IconChevronLeft size={14} />
      {label}
    </button>
  )
}
