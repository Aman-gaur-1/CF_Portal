export default function Spinner({ size = "sm" }) {
  const s = size === "lg" ? "w-10 h-10 border-4" : "w-5 h-5 border-2"
  return <div className={s + " border-[var(--primary)] border-t-transparent rounded-full spinner inline-block"} />
}