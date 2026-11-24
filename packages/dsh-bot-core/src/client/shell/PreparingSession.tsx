/** Drawn in place of the conversation while a blank bot session is being prepared. */
export function PreparingSession({ message }: { readonly message: string }) {
  return (
    <div className="dshb-shell-placeholder" data-dshb-shell-preparing="">
      <p role="status">{message}</p>
    </div>
  )
}
