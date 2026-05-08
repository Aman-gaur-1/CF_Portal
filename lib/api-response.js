import { NextResponse } from "next/server"

export function ok(data = {}) {
  return NextResponse.json(data)
}

export function badRequest(message) {
  return NextResponse.json({ success: false, error: message }, { status: 400 })
}

export function unauthorized() {
  return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
}

export function serverError(error) {
  return NextResponse.json({ success: false, error: error?.message || "Server error" }, { status: 500 })
}
