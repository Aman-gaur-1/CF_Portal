export default function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <div className="rounded-xl p-4 mt-2" style={{background:"rgba(255,107,107,0.08)",border:"1px solid rgba(255,107,107,0.3)"}}>
      <p className="text-sm mb-3" style={{color:"var(--text-secondary)"}}>{message}</p>
      <div className="flex gap-2">
        <button className="btn btn-danger btn-sm" onClick={onConfirm}>Yes, Delete</button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}