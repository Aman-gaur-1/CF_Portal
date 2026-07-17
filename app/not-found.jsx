import ErrorState from "@/components/ui/ErrorState"

export default function NotFound() {
  return (
    <ErrorState
      status="404"
      title="Page not found"
      message="The page you are looking for does not exist or may have moved."
    />
  )
}
