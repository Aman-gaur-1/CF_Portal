import { NextResponse } from "next/server"

export async function POST(request) {
  try {
    const { username, password } = await request.json()
    const teachers = JSON.parse(process.env.TEACHER_CREDENTIALS || "{}")
    if (teachers[username] && teachers[username] === password)
      return NextResponse.json({ success: true, name: username })
    return NextResponse.json({ success: false }, { status: 401 })
  } catch (e) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}