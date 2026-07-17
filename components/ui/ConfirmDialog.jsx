export default function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="confirm-dialog">
      <p>{message}</p>
      <div className="flex gap-2">
        <button className="btn btn-danger btn-sm" onClick={onConfirm}>Yes, Delete</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
