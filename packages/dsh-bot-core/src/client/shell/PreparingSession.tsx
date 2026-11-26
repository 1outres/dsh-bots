export function PreparingSession({ message }: { readonly message: string }) {
  return (
    <div className="dshb-shell-placeholder" data-dshb-shell-preparing="">
      <p role="status">{message}</p>
    </div>
  )
}
